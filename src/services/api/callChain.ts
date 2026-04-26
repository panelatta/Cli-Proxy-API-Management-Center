import { apiClient } from './client';

const CALL_CHAIN_EXPORT_TIMEOUT_MS = 120 * 1000;

export interface CallChainExportQuery {
  session_id?: string;
  request_id?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  include_errors?: boolean;
  include_raw?: boolean;
  summary?: boolean;
}

export interface CallChainExportPayload {
  version: number;
  exported_at: string;
  log_directory: string;
  request_log_enabled: boolean;
  filters: CallChainExportFilters;
  session_count: number;
  request_count: number;
  matched_file_count: number;
  sessions: CallChainSession[];
  warnings?: string[];
}

export interface CallChainExportFilters {
  session_id?: string;
  request_id?: string;
  query?: string;
  from?: string;
  to?: string;
  limit: number;
  include_errors: boolean;
  include_raw: boolean;
  summary?: boolean;
}

export interface CallChainSession {
  id: string;
  started_at?: string;
  ended_at?: string;
  identifiers?: Record<string, string[]>;
  requests: CallChainRequest[];
}

export interface CallChainRequest {
  request_id?: string;
  file: string;
  size: number;
  modified_at?: string;
  timestamp?: string;
  url?: string;
  method?: string;
  status?: number;
  transport?: {
    downstream?: string;
    upstream?: string;
  };
  model?: string;
  identifiers?: Record<string, string[]>;
  user_inputs?: CallChainEvent[];
  model_outputs?: CallChainEvent[];
  reasoning?: CallChainEvent[];
  tool_calls?: CallChainEvent[];
  tool_results?: CallChainEvent[];
  http?: CallChainHTTPTrace;
  raw_sections?: Array<{ title: string; content: string }>;
  summary?: CallChainRequestSummary;
}

export interface CallChainRequestSummary {
  user_input_count: number;
  model_output_count: number;
  reasoning_count: number;
  tool_call_count: number;
  tool_result_count: number;
  upstream_request_count: number;
  upstream_response_count: number;
  websocket_event_count: number;
  api_websocket_event_count: number;
  raw_section_count: number;
  downstream_request_bytes: number;
  downstream_response_bytes: number;
  upstream_request_bytes: number;
  upstream_response_bytes: number;
}

export interface CallChainEvent {
  source?: string;
  path?: string;
  type?: string;
  role?: string;
  name?: string;
  call_id?: string;
  text?: string;
  raw?: string;
}

export interface CallChainHTTPTrace {
  downstream_request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string[]>;
    body?: string;
  };
  upstream_requests?: Array<{
    index?: number;
    timestamp?: string;
    url?: string;
    method?: string;
    auth?: string;
    headers?: Record<string, string[]>;
    body?: string;
  }>;
  upstream_responses?: Array<{
    index?: number;
    timestamp?: string;
    status?: number;
    headers?: Record<string, string[]>;
    body?: string;
  }>;
  downstream_response?: {
    index?: number;
    timestamp?: string;
    status?: number;
    headers?: Record<string, string[]>;
    body?: string;
  };
  websocket_timeline?: Array<{
    timestamp?: string;
    event?: string;
    payload?: string;
  }>;
  api_websocket_timeline?: Array<{
    timestamp?: string;
    event?: string;
    payload?: string;
  }>;
}

function compactParams(params: CallChainExportQuery): CallChainExportQuery {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  ) as CallChainExportQuery;
}

export const callChainApi = {
  fetchExport: (params: CallChainExportQuery): Promise<CallChainExportPayload> =>
    apiClient.get('/request-call-chain/export', {
      params: compactParams(params),
      timeout: CALL_CHAIN_EXPORT_TIMEOUT_MS
    }),

  downloadExport: (params: CallChainExportQuery) =>
    apiClient.getRaw('/request-call-chain/export', {
      params: compactParams(params),
      responseType: 'blob',
      timeout: CALL_CHAIN_EXPORT_TIMEOUT_MS
    }),
};
