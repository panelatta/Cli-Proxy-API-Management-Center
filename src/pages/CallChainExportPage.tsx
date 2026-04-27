import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconRefreshCw,
  IconSearch,
  IconSettings,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import {
  callChainApi,
  type CallChainEvent,
  type CallChainExportPayload,
  type CallChainExportQuery,
  type CallChainRequest,
  type CallChainSession,
} from '@/services/api/callChain';
import { configApi } from '@/services/api/config';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import styles from './CallChainExportPage.module.scss';

interface FilterState {
  sessionId: string;
  requestId: string;
  query: string;
  from: string;
  to: string;
  limit: string;
  includeErrors: boolean;
  includeRaw: boolean;
}

type EventKey = 'user_inputs' | 'model_outputs' | 'reasoning' | 'tool_calls' | 'tool_results';
type SummaryKey = keyof NonNullable<CallChainRequest['summary']>;

const DEFAULT_LIMIT = '100';
const MAX_LIMIT = 2000;

const EVENT_COUNT_FIELD: Record<EventKey, SummaryKey> = {
  user_inputs: 'user_input_count',
  model_outputs: 'model_output_count',
  reasoning: 'reasoning_count',
  tool_calls: 'tool_call_count',
  tool_results: 'tool_result_count',
};

const EVENT_LABELS: Record<EventKey, string> = {
  user_inputs: '用户请求',
  model_outputs: '模型输出',
  reasoning: '模型思考',
  tool_calls: '工具调用',
  tool_results: '工具结果',
};

const initialFilters: FilterState = {
  sessionId: '',
  requestId: '',
  query: '',
  from: '',
  to: '',
  limit: DEFAULT_LIMIT,
  includeErrors: true,
  includeRaw: false,
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.parseInt(DEFAULT_LIMIT, 10);
  }
  return Math.min(parsed, MAX_LIMIT);
}

function toRFC3339(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

function formatTime(value?: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function compactText(value?: string, maxLength = 180): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '-';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function firstEventText(events?: CallChainEvent[]): string {
  if (!events) return '';
  for (const event of events) {
    const text = event.text || event.raw || event.name || event.call_id;
    if (text && text.trim()) return text;
  }
  return '';
}

function uniqueModels(session: CallChainSession): string[] {
  return Array.from(
    new Set(
      session.requests
        .map((request) => request.model)
        .filter((model): model is string => Boolean(model))
    )
  );
}

function identifierPreview(identifiers?: Record<string, string[]>): string {
  if (!identifiers) return '-';
  const preferred = [
    'x_session_id',
    'conversation_id',
    'session_id',
    'response_id',
    'previous_response_id',
    'user_id',
  ];
  for (const key of preferred) {
    const values = identifiers[key];
    if (values?.length) return `${key}: ${values[0]}`;
  }
  const first = Object.entries(identifiers).find(([, values]) => values.length > 0);
  return first ? `${first[0]}: ${first[1][0]}` : '-';
}

function getEventCount(request: CallChainRequest, key: EventKey): number {
  return request.summary?.[EVENT_COUNT_FIELD[key]] ?? request[key]?.length ?? 0;
}

function getSessionEventCount(session: CallChainSession, key: EventKey): number {
  return session.requests.reduce((total, request) => total + getEventCount(request, key), 0);
}

function sessionPreview(session: CallChainSession): string {
  const userInput = session.requests
    .map((request) => firstEventText(request.user_inputs))
    .find(Boolean);
  const modelOutput = session.requests
    .map((request) => firstEventText(request.model_outputs))
    .find(Boolean);
  if (userInput && modelOutput)
    return `U: ${compactText(userInput, 80)} / A: ${compactText(modelOutput, 80)}`;
  return compactText(
    userInput || modelOutput || firstEventText(session.requests[0]?.reasoning),
    170
  );
}

function filenameFromDisposition(disposition: string): string | null {
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].replace(/"/g, '').trim());
  } catch {
    return match[1].replace(/"/g, '').trim();
  }
}

function renderEventSummary(request: CallChainRequest, key: EventKey) {
  const events = request[key] || [];
  const total = getEventCount(request, key);
  if (total === 0 && events.length === 0) return null;

  return (
    <div className={styles.eventGroup} key={key}>
      <div className={styles.eventGroupHeader}>
        <span>{EVENT_LABELS[key]}</span>
        <span>{events.length < total ? `${events.length}/${total}` : total}</span>
      </div>
      {events.length > 0 ? (
        <div className={styles.eventList}>
          {events.map((event, index) => (
            <div className={styles.eventItem} key={`${event.source || key}-${event.path || index}`}>
              <div className={styles.eventMeta}>
                {[event.type, event.name, event.call_id].filter(Boolean).join(' / ') ||
                  event.source ||
                  '-'}
              </div>
              <pre>{compactText(event.text || event.raw, 700)}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CallChainExportPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [payload, setPayload] = useState<CallChainExportPayload | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingToggle, setSavingToggle] = useState<'logging' | 'request-log' | null>(null);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const sessions = payload?.sessions ?? [];
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );
  const selectedSessionIndex = useMemo(
    () => sessions.findIndex((session) => session.id === selectedSessionId),
    [sessions, selectedSessionId]
  );

  const buildParams = useCallback(
    (overrides: Partial<FilterState> & { summary?: boolean } = {}): CallChainExportQuery => {
      const merged = { ...filters, ...overrides };
      return {
        session_id: merged.sessionId.trim() || undefined,
        request_id: merged.requestId.trim() || undefined,
        q: merged.query.trim() || undefined,
        from: toRFC3339(merged.from),
        to: toRFC3339(merged.to),
        limit: parseLimit(merged.limit),
        include_errors: merged.includeErrors,
        include_raw: merged.includeRaw,
        summary: overrides.summary,
      };
    },
    [filters]
  );

  const loadSessionsForParams = useCallback(
    async (params: CallChainExportQuery) => {
      if (connectionStatus !== 'connected') {
        setPayload(null);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await callChainApi.fetchExport(params);
        setPayload(data);
        setSelectedSessionId((current) => {
          if (current && data.sessions.some((session) => session.id === current)) {
            return current;
          }
          return data.sessions[0]?.id ?? '';
        });
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setError(message || '加载调用链失败');
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [connectionStatus]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // The login flow already surfaces connection failures.
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void loadSessionsForParams({
      limit: Number.parseInt(DEFAULT_LIMIT, 10),
      include_errors: true,
      include_raw: false,
      summary: true,
    });
  }, [connectionStatus, loadSessionsForParams]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function updateLoggingSetting(kind: 'logging' | 'request-log', value: boolean) {
    setSavingToggle(kind);
    try {
      if (kind === 'logging') {
        await configApi.updateLoggingToFile(value);
        updateConfigValue('logging-to-file', value);
      } else {
        await configApi.updateRequestLog(value);
        updateConfigValue('request-log', value);
      }
      await fetchConfig(undefined, true);
      showNotification(t('notification.update_success', { defaultValue: '更新成功' }), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.update_failed', { defaultValue: '更新失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setSavingToggle(null);
    }
  }

  async function handleLoadSessions() {
    await loadSessionsForParams(buildParams({ summary: true, includeRaw: false }));
  }

  async function handleExport(sessionId?: string) {
    setExporting(true);
    try {
      const params = buildParams({
        summary: false,
        sessionId: sessionId ?? filters.sessionId,
      });
      const response = await callChainApi.downloadExport(params);
      const disposition = String(
        response.headers?.['content-disposition'] ?? response.headers?.['Content-Disposition'] ?? ''
      );
      const filename =
        filenameFromDisposition(disposition) ||
        `request-call-chain-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], { type: 'application/json;charset=utf-8' });
      downloadBlob({ filename, blob });
      showNotification(t('logs.download_success', { defaultValue: '下载成功' }), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed', { defaultValue: '下载失败' })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  }

  function applySessionFilter(session: CallChainSession) {
    updateFilter('sessionId', session.id);
    setSelectedSessionId(session.id);
  }

  function handleSessionRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, sessionId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelectedSessionId(sessionId);
  }

  const totalBodyBytes = useMemo(() => {
    return sessions.reduce((sessionTotal, session) => {
      return (
        sessionTotal +
        session.requests.reduce((requestTotal, request) => {
          const summary = request.summary;
          if (!summary) return requestTotal + request.size;
          return (
            requestTotal +
            summary.downstream_request_bytes +
            summary.downstream_response_bytes +
            summary.upstream_request_bytes +
            summary.upstream_response_bytes
          );
        }, 0)
      );
    }, 0);
  }, [sessions]);

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('call_chain.title', { defaultValue: '调用链导出' })}</h1>

      <div className={styles.content}>
        <Card
          title={
            <span className={styles.cardTitle}>
              <IconSettings size={18} />
              {t('call_chain.logging_settings', { defaultValue: '记录开关' })}
            </span>
          }
        >
          <div className={styles.switchGrid}>
            <div className={styles.switchItem}>
              <ToggleSwitch
                checked={Boolean(config?.loggingToFile)}
                onChange={(value) => void updateLoggingSetting('logging', value)}
                disabled={disableControls || savingToggle !== null}
                ariaLabel="logging-to-file"
                label="logging-to-file"
              />
              <span className={config?.loggingToFile ? styles.stateOn : styles.stateOff}>
                {String(Boolean(config?.loggingToFile))}
              </span>
            </div>
            <div className={styles.switchItem}>
              <ToggleSwitch
                checked={Boolean(config?.requestLog)}
                onChange={(value) => void updateLoggingSetting('request-log', value)}
                disabled={disableControls || savingToggle !== null}
                ariaLabel="request-log"
                label="request-log"
              />
              <span className={config?.requestLog ? styles.stateOn : styles.stateOff}>
                {String(Boolean(config?.requestLog))}
              </span>
            </div>
          </div>
          {!config?.requestLog ? (
            <div className={styles.warningLine}>
              request-log 当前未开启，新请求不会生成完整 HTTP 调用链。
            </div>
          ) : null}
        </Card>

        <Card
          title={
            <span className={styles.cardTitle}>
              <IconSlidersHorizontal size={18} />
              {t('call_chain.filters', { defaultValue: '筛选与导出' })}
            </span>
          }
        >
          <div className={styles.filterGrid}>
            <Input
              label="Session / Conversation ID"
              value={filters.sessionId}
              onChange={(event) => updateFilter('sessionId', event.target.value)}
              placeholder="x-session-id / conversation_id / response-chain"
            />
            <Input
              label="Request ID"
              value={filters.requestId}
              onChange={(event) => updateFilter('requestId', event.target.value)}
              placeholder="request log id"
            />
            <Input
              label="全文搜索"
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="用户问题 / 模型输出 / URL / tool name"
            />
            <Input
              label="Limit"
              value={filters.limit}
              onChange={(event) => updateFilter('limit', event.target.value)}
              type="number"
              min={1}
              max={MAX_LIMIT}
            />
            <Input
              label="From"
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
              type="datetime-local"
            />
            <Input
              label="To"
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
              type="datetime-local"
            />
          </div>

          <div className={styles.optionRow}>
            <ToggleSwitch
              checked={filters.includeErrors}
              onChange={(value) => updateFilter('includeErrors', value)}
              label="include_errors"
            />
            <ToggleSwitch
              checked={filters.includeRaw}
              onChange={(value) => updateFilter('includeRaw', value)}
              label="include_raw"
            />
          </div>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => void handleLoadSessions()}
              disabled={disableControls}
              loading={loading}
            >
              <IconSearch size={16} />
              查看会话
            </Button>
            <Button
              onClick={() => void handleExport()}
              disabled={disableControls}
              loading={exporting}
            >
              <IconDownload size={16} />
              导出当前筛选
            </Button>
          </div>
          {error ? <div className={styles.errorLine}>{error}</div> : null}
        </Card>

        <div className={styles.summaryBar}>
          <div>
            <span>Sessions</span>
            <strong>{payload?.session_count ?? 0}</strong>
          </div>
          <div>
            <span>Requests</span>
            <strong>{payload?.request_count ?? 0}</strong>
          </div>
          <div>
            <span>Files</span>
            <strong>{payload?.matched_file_count ?? 0}</strong>
          </div>
          <div>
            <span>Body Bytes</span>
            <strong>{formatBytes(totalBodyBytes)}</strong>
          </div>
        </div>

        <Card
          className={styles.sessionsCard}
          title={
            <span className={styles.cardTitle}>
              <IconRefreshCw size={18} />
              当前会话
            </span>
          }
          extra={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleLoadSessions()}
              disabled={disableControls}
            >
              <IconRefreshCw size={16} />
            </Button>
          }
        >
          {sessions.length === 0 ? (
            <EmptyState
              title={loading ? '加载中...' : '暂无会话'}
              description={loading ? '' : ' '}
            />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.sessionsTable}>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>时间</th>
                    <th>请求</th>
                    <th>模型</th>
                    <th>内容</th>
                    <th>标识</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const models = uniqueModels(session);
                    const isSelected = selectedSessionId === session.id;
                    return (
                      <tr
                        key={session.id}
                        className={`${styles.sessionRow} ${isSelected ? styles.selectedRow : ''}`.trim()}
                        onClick={() => setSelectedSessionId(session.id)}
                        onKeyDown={(event) => handleSessionRowKeyDown(event, session.id)}
                        tabIndex={0}
                        aria-selected={isSelected}
                      >
                        <td>
                          <div className={styles.sessionCell}>
                            <button
                              type="button"
                              className={styles.sessionLink}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSessionId(session.id);
                              }}
                              title={session.id}
                            >
                              {session.id}
                            </button>
                            {isSelected ? (
                              <span className={styles.selectedBadge}>当前详情</span>
                            ) : null}
                          </div>
                        </td>
                        <td>{formatTime(session.started_at)}</td>
                        <td>
                          <span className={styles.countPill}>{session.requests.length}</span>
                        </td>
                        <td>{models.length ? models.slice(0, 3).join(', ') : '-'}</td>
                        <td className={styles.previewCell}>{sessionPreview(session)}</td>
                        <td className={styles.identifierCell}>
                          {identifierPreview(session.identifiers)}
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSessionId(session.id);
                              }}
                            >
                              查看
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                applySessionFilter(session);
                              }}
                            >
                              筛选
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleExport(session.id);
                              }}
                              disabled={exporting}
                            >
                              导出
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selectedSession ? (
          <Card
            title={
              <span className={styles.detailTitle}>
                <span className={styles.cardTitle}>
                  <IconDownload size={18} />
                  会话详情
                </span>
                <span className={styles.detailSessionId}>
                  #{selectedSessionIndex + 1} / {sessions.length} · {selectedSession.id}
                </span>
              </span>
            }
            extra={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleExport(selectedSession.id)}
                disabled={exporting}
              >
                <IconDownload size={16} />
                导出此会话
              </Button>
            }
          >
            <div className={styles.sessionMeta}>
              <div>
                <span>当前列表</span>
                <strong>
                  #{selectedSessionIndex + 1} / {sessions.length}
                </strong>
              </div>
              <div>
                <span>当前会话 ID</span>
                <strong>{selectedSession.id}</strong>
              </div>
              <div>
                <span>Started</span>
                <strong>{formatTime(selectedSession.started_at)}</strong>
              </div>
              <div>
                <span>Ended</span>
                <strong>{formatTime(selectedSession.ended_at)}</strong>
              </div>
              <div>
                <span>Events</span>
                <strong>
                  U {getSessionEventCount(selectedSession, 'user_inputs')} / A{' '}
                  {getSessionEventCount(selectedSession, 'model_outputs')} / T{' '}
                  {getSessionEventCount(selectedSession, 'tool_calls')}
                </strong>
              </div>
            </div>

            <div className={styles.requestList}>
              {selectedSession.requests.map((request, index) => (
                <div
                  className={styles.requestItem}
                  key={request.request_id || request.file || index}
                >
                  <div className={styles.requestHeader}>
                    <div>
                      <strong>
                        {index + 1}. {request.method || '-'} {request.url || '-'}
                      </strong>
                      <span>{request.request_id || request.file}</span>
                    </div>
                    <div className={styles.requestBadges}>
                      {request.status ? <span>{request.status}</span> : null}
                      {request.model ? <span>{request.model}</span> : null}
                      {request.summary ? (
                        <span>
                          upstream {request.summary.upstream_request_count}/
                          {request.summary.upstream_response_count}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.eventGrid}>
                    {(
                      [
                        'user_inputs',
                        'model_outputs',
                        'reasoning',
                        'tool_calls',
                        'tool_results',
                      ] as EventKey[]
                    ).map((key) => renderEventSummary(request, key))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
