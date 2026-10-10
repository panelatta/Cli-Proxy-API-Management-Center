export interface UsageQuotaWindow {
  id: string;
  usedPercent: number;
  windowSeconds: number;
  resetAt: number;
}

export interface UsageQuotaAccount {
  id: string;
  provider: string;
  name: string;
  observedAt: number;
  windows: UsageQuotaWindow[];
}

export interface UsageQuotaRecord {
  apiKey: string;
  accountId: string;
  requestedAt: number;
  completedAt: number;
  tokens: number;
  windows: UsageQuotaWindow[];
}

export interface UsageQuotaHistory {
  accounts: UsageQuotaAccount[];
  records: UsageQuotaRecord[];
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const instant = (value: unknown) => Date.parse(text(value));
const index = (value: unknown) => (typeof value === 'number' ? String(value) : text(value));

function windows(value: unknown): UsageQuotaWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = object(item);
    const id = text(raw.id);
    const usedPercent = raw.used_percent;
    const windowSeconds = raw.window_seconds;
    const resetAt = instant(raw.reset_at);
    if (
      !id ||
      typeof usedPercent !== 'number' ||
      !Number.isFinite(usedPercent) ||
      usedPercent < 0 ||
      usedPercent > 100 ||
      typeof windowSeconds !== 'number' ||
      !Number.isFinite(windowSeconds) ||
      windowSeconds <= 0 ||
      !Number.isFinite(resetAt) ||
      resetAt <= 0
    )
      return [];
    return [{ id, usedPercent, windowSeconds, resetAt }];
  });
}

// Read wire fields once, keeping quota parsing out of presentation and aggregation.
export function normalizeUsageQuota(value: unknown): UsageQuotaHistory {
  const usage = object(value);
  const accounts = new Map<string, UsageQuotaAccount>();
  if (Array.isArray(usage.oauth_accounts)) {
    for (const item of usage.oauth_accounts) {
      const raw = object(item);
      const id = index(raw.auth_index);
      if (!id) continue;
      accounts.set(id, {
        id,
        name: text(raw.name) || id,
        provider: text(raw.provider),
        observedAt: instant(raw.observed_at),
        windows: windows(raw.windows),
      });
    }
  }
  const records: UsageQuotaRecord[] = [];
  for (const [apiKey, api] of Object.entries(object(usage.apis))) {
    for (const model of Object.values(object(object(api).models))) {
      const details = object(model).details;
      if (!Array.isArray(details)) continue;
      for (const item of details) {
        const raw = object(item);
        const accountId = index(raw.auth_index);
        if (
          !accountId ||
          (raw.auth_type !== 'oauth' && (raw.auth_type || !accounts.has(accountId)))
        )
          continue;
        const requestedAt = instant(raw.timestamp);
        if (!Number.isFinite(requestedAt)) continue;
        const latency =
          typeof raw.latency_ms === 'number' && raw.latency_ms >= 0 ? raw.latency_ms : 0;
        const completed = instant(raw.completed_at);
        const completedAt =
          Number.isFinite(completed) && completed >= requestedAt
            ? completed
            : requestedAt + latency;
        const observedWindows = windows(raw.quota_windows);
        const tokens = object(raw.tokens).total_tokens;
        records.push({
          apiKey,
          accountId,
          requestedAt,
          completedAt,
          tokens: typeof tokens === 'number' && Number.isFinite(tokens) ? Math.max(0, tokens) : 0,
          windows: observedWindows,
        });
        const existing = accounts.get(accountId);
        if (!existing) {
          accounts.set(accountId, {
            id: accountId,
            name: accountId,
            provider: text(raw.provider),
            observedAt: completedAt,
            windows: observedWindows,
          });
        } else if (
          observedWindows.length &&
          (!Number.isFinite(existing.observedAt) || completedAt > existing.observedAt)
        ) {
          existing.observedAt = completedAt;
          existing.windows = observedWindows;
        }
      }
    }
  }
  return { accounts: [...accounts.values()], records };
}
