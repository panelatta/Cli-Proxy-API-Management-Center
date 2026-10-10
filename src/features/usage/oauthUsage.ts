import type { UsageTimeBounds } from '@/utils/usage';
import type {
  UsageQuotaAccount,
  UsageQuotaHistory,
  UsageQuotaRecord,
  UsageQuotaWindow,
} from '@/services/api/usageQuota';

export interface OAuthWindowUsage {
  id: string;
  windowSeconds: number;
  resetAt: number;
  estimatedPercent: number | null;
  coveredRequests: number;
  totalRequests: number;
}

export interface OAuthAccountUsage extends UsageQuotaAccount {
  requests: number;
  tokens: number;
  history: OAuthWindowUsage[];
}

export type OAuthUsageStats = Record<string, OAuthAccountUsage[]>;

interface Observation {
  time: number;
  window: UsageQuotaWindow;
}
interface Cycle {
  window: UsageQuotaWindow;
  allocations: Map<UsageQuotaRecord, number>;
}

// Estimate each observed account-level delta over ALL local requests in the
// interval before filtering by API key or request start time. Filtering first
// would incorrectly assign other keys' consumption to the selected key.
export function buildOAuthUsageStats(
  input: unknown,
  bounds: UsageTimeBounds | null
): OAuthUsageStats {
  if (!bounds || !input) return {};
  const history = input as UsageQuotaHistory;
  if (!Array.isArray(history.accounts) || !Array.isArray(history.records)) return {};
  const result: OAuthUsageStats = {};
  const byAccount = new Map<string, UsageQuotaRecord[]>();
  for (const record of history.records) {
    const records = byAccount.get(record.accountId) ?? [];
    records.push(record);
    byAccount.set(record.accountId, records);
  }
  for (const account of history.accounts) {
    const records = (byAccount.get(account.id) ?? []).sort((a, b) => a.completedAt - b.completedAt);
    const selected = records.filter(
      (record) => record.requestedAt >= bounds.startMs && record.requestedAt <= bounds.endMs
    );
    if (!selected.length) continue;
    const series = new Map<string, Observation[]>();
    for (const record of records) {
      for (const window of record.windows) {
        if (
          record.completedAt > window.resetAt ||
          record.completedAt < window.resetAt - window.windowSeconds * 1000
        )
          continue;
        // Model-specific pools cannot be apportioned across unrelated models.
        if (!['primary', 'secondary', '5h', '7d'].includes(window.id)) continue;
        const key = `${window.id}:${window.windowSeconds}`;
        const observations = series.get(key) ?? [];
        observations.push({ time: record.completedAt, window });
        series.set(key, observations);
      }
    }
    const cycles: Cycle[] = [];
    for (const observations of series.values()) {
      let previous: Observation | undefined;
      let cycle: Cycle | undefined;
      let cursor = 0;
      let pendingCohort: UsageQuotaRecord[] = [];
      for (const observation of observations) {
        const sameCycle =
          previous &&
          Math.abs(previous.window.resetAt - observation.window.resetAt) <= 60000 &&
          observation.time <= previous.window.resetAt;
        if (!sameCycle || !cycle) {
          cycle = { window: observation.window, allocations: new Map() };
          cycles.push(cycle);
          pendingCohort = [];
        }
        const cohort: UsageQuotaRecord[] = [];
        while (cursor < records.length && records[cursor].completedAt <= observation.time) {
          const record = records[cursor++];
          if (previous && record.completedAt > previous.time) cohort.push(record);
        }
        const delta = previous ? observation.window.usedPercent - previous.window.usedPercent : -1;
        if (delta < 0) pendingCohort = [];
        if (
          sameCycle &&
          previous &&
          observation.time > previous.time &&
          delta >= 0 &&
          cohort.length
        ) {
          // Keep a plateau together: rounded 10%, 10%, 11% observations must
          // not assign the entire increase to only the last request/key.
          for (const record of cohort) pendingCohort.push(record);
          const allocationCohort = delta > 0 ? pendingCohort : cohort;
          const totalTokens = allocationCohort.reduce((sum, record) => sum + record.tokens, 0);
          for (const record of allocationCohort) {
            cycle.allocations.set(
              record,
              delta * (totalTokens > 0 ? record.tokens / totalTokens : 1 / allocationCohort.length)
            );
          }
          if (delta > 0) pendingCohort = [];
        }
        previous = observation;
      }
    }
    const keys = new Set(selected.map((record) => record.apiKey));
    for (const apiKey of keys) {
      const keyRecords = selected.filter((record) => record.apiKey === apiKey);
      const row: OAuthAccountUsage = {
        ...account,
        requests: keyRecords.length,
        tokens: keyRecords.reduce((sum, record) => sum + record.tokens, 0),
        history: [],
      };
      for (const cycle of cycles) {
        const { window } = cycle;
        const eligible = keyRecords.filter(
          (record) =>
            cycle.allocations.has(record) ||
            (record.completedAt <= window.resetAt &&
              record.completedAt > window.resetAt - window.windowSeconds * 1000)
        );
        if (!eligible.length) continue;
        let estimated = 0;
        let covered = 0;
        for (const record of eligible) {
          const amount = cycle.allocations.get(record);
          if (amount === undefined) continue;
          estimated += amount;
          covered++;
        }
        row.history.push({
          id: window.id,
          windowSeconds: window.windowSeconds,
          resetAt: window.resetAt,
          estimatedPercent: covered ? estimated : null,
          coveredRequests: covered,
          totalRequests: eligible.length,
        });
      }
      (result[apiKey] ??= []).push(row);
    }
  }
  return result;
}
