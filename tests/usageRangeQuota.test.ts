import { describe, expect, test } from 'bun:test';
import {
  filterUsageByBounds,
  buildHourlySeriesByModel,
  buildHourlyTokenBreakdown,
  buildHourlyCostSeries,
} from '@/utils/usage';
import { getUsageBounds } from '@/features/usage/timeRange';
import { normalizeUsageQuota } from '@/services/api/usageQuota';
import { buildOAuthUsageStats } from '@/features/usage/oauthUsage';

const start = Date.parse('2026-01-01T10:00:00Z');
const reset = start + 5 * 3600000;
const detail = (
  minute: number,
  percent?: number,
  tokens = 100,
  resetAt = reset,
  account = 'oauth-a'
) => ({
  timestamp: new Date(start + minute * 60000).toISOString(),
  completed_at: new Date(start + minute * 60000 + 1000).toISOString(),
  auth_index: account,
  auth_type: 'oauth',
  provider: 'codex',
  failed: false,
  tokens: { total_tokens: tokens, input_tokens: tokens, output_tokens: 0 },
  quota_windows:
    percent === undefined
      ? []
      : [
          {
            id: 'primary',
            used_percent: percent,
            window_seconds: 18000,
            reset_at: new Date(resetAt).toISOString(),
          },
        ],
});
const usage = (a: ReturnType<typeof detail>[], b: ReturnType<typeof detail>[] = []) => ({
  apis: {
    'key-a': { models: { model: { details: a, total_requests: a.length } } },
    'key-b': { models: { model: { details: b, total_requests: b.length } } },
  },
});
const all = { startMs: start, endMs: reset + 10 * 3600000 };

describe('custom usage range', () => {
  test('uses inclusive boundaries and recomputes all totals', () => {
    const source = usage([detail(0), detail(1), { ...detail(2), failed: true }, detail(3)]);
    const filtered = filterUsageByBounds(source, { startMs: start + 60000, endMs: start + 120000 });
    expect(filtered).toMatchObject({
      total_requests: 2,
      success_count: 1,
      failure_count: 1,
      total_tokens: 200,
    });
    expect(filtered.apis['key-a'].models.model.details).toHaveLength(2);
    expect(source.apis['key-a'].models.model.details).toHaveLength(4);
  });
  test('invalid and empty ranges do not display unfiltered totals', () => {
    expect(getUsageBounds('custom', '', '', start)).toBeNull();
    expect(getUsageBounds('custom', '2026-01-02T00:00', '2026-01-01T00:00', start)).toBeNull();
    expect(
      filterUsageByBounds(usage([detail(0)]), { startMs: reset, endMs: reset + 1000 })
    ).toMatchObject({ total_requests: 0 });
  });
  test('historical hourly charts follow the selected end for all metrics', () => {
    const filtered = filterUsageByBounds(usage([detail(0), detail(1)]), {
      startMs: start,
      endMs: start + 3600000,
    });
    expect(
      buildHourlySeriesByModel(filtered, 'requests', 2)
        .dataByModel.get('model')
        ?.reduce((a, b) => a + b, 0)
    ).toBe(2);
    expect(
      buildHourlyTokenBreakdown(filtered, 2).dataByCategory.input.reduce((a, b) => a + b, 0)
    ).toBe(200);
    expect(
      buildHourlyCostSeries(
        filtered,
        { model: { prompt: 1, completion: 1, cache: 1 } },
        2
      ).data.reduce((a, b) => a + b, 0)
    ).toBeCloseTo(0.0002);
  });
});

describe('OAuth quota attribution', () => {
  test('spreads rounded percentage increases over the entire preceding plateau', () => {
    const normalized = normalizeUsageQuota(
      usage([detail(0, 10), detail(1, 10, 300)], [detail(2, 14, 100)])
    );
    const stats = buildOAuthUsageStats(normalized, all);
    expect(stats['key-a'][0].history[0].estimatedPercent).toBe(3);
    expect(stats['key-b'][0].history[0].estimatedPercent).toBe(1);
  });
  test('shares account deltas across keys, including requests without quota signals', () => {
    const normalized = normalizeUsageQuota(
      usage([detail(0, 10), detail(2, 14, 300)], [detail(1, undefined, 100)])
    );
    const stats = buildOAuthUsageStats(normalized, all);
    expect(stats['key-a'][0].history[0].estimatedPercent).toBe(3);
    expect(stats['key-a'][0].history[0].coveredRequests).toBe(1);
    expect(stats['key-b'][0].history[0].estimatedPercent).toBe(1);
    const filtered = buildOAuthUsageStats(normalized, { startMs: start + 120000, endMs: reset });
    expect(filtered['key-a'][0].history[0].estimatedPercent).toBe(3);
    expect(filtered['key-b']).toBeUndefined();
  });
  test('missing baseline remains unknown; observed zero is distinct', () => {
    const unknown = buildOAuthUsageStats(normalizeUsageQuota(usage([detail(0, 10)])), all);
    expect(unknown['key-a'][0].history[0].estimatedPercent).toBeNull();
    const zero = buildOAuthUsageStats(
      normalizeUsageQuota(usage([detail(0, 10), detail(1, 10)])),
      all
    );
    expect(zero['key-a'][0].history[0].estimatedPercent).toBe(0);
    expect(zero['key-a'][0].history[0].coveredRequests).toBe(1);
  });
  test('resets and downward corrections establish a new baseline', () => {
    const stats = buildOAuthUsageStats(
      normalizeUsageQuota(
        usage([
          detail(0, 80),
          detail(1, 20),
          detail(2, 22),
          detail(301, 1, 100, reset + 5 * 3600000),
        ])
      ),
      all
    );
    expect(stats['key-a'][0].history).toHaveLength(2);
    expect(stats['key-a'][0].history[0].estimatedPercent).toBe(2);
    expect(stats['key-a'][0].history[1].estimatedPercent).toBeNull();
  });
  test('account rotation keeps percentages separate and never treats API keys as OAuth', () => {
    const source = usage([
      detail(0, 10),
      detail(1, 12),
      detail(0, 70, 100, reset, 'oauth-b'),
      detail(1, 75, 100, reset, 'oauth-b'),
    ]);
    source.apis['key-b'].models.model.details.push({ ...detail(1, 99), auth_type: 'api_key' });
    const stats = buildOAuthUsageStats(normalizeUsageQuota(source), all);
    expect(stats['key-a'].map((account) => account.history[0].estimatedPercent)).toEqual([2, 5]);
    expect(stats['key-b']).toBeUndefined();
  });
  test('falls back to request count only when all token weights are zero', () => {
    const stats = buildOAuthUsageStats(
      normalizeUsageQuota(usage([detail(0, 10, 0), detail(2, 14, 0)], [detail(1, undefined, 0)])),
      all
    );
    expect(stats['key-a'][0].history[0].estimatedPercent).toBe(2);
    expect(stats['key-b'][0].history[0].estimatedPercent).toBe(2);
  });
  test('legacy history can resolve an OAuth account without inventing quota data', () => {
    const old = { ...detail(0), auth_type: undefined, quota_windows: undefined };
    const normalized = normalizeUsageQuota({
      ...usage([old as unknown as ReturnType<typeof detail>]),
      oauth_accounts: [{ auth_index: 'oauth-a', provider: 'codex', name: 'Account A' }],
    });
    const stats = buildOAuthUsageStats(normalized, all);
    expect(stats['key-a'][0].requests).toBe(1);
    expect(stats['key-a'][0].history).toHaveLength(0);
  });
});
