import type { UsageTimeBounds, UsageTimeRange } from '@/utils/usage';

export type UsageRange = UsageTimeRange | 'custom';

export function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function getUsageBounds(
  range: UsageRange,
  start: string,
  end: string,
  nowMs: number
): UsageTimeBounds | null {
  if (range === 'custom') {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs
      ? { startMs, endMs }
      : null;
  }
  const hours = { all: 0, '7h': 7, '24h': 24, '7d': 168 }[range];
  return { startMs: range === 'all' ? 0 : nowMs - hours * 3600000, endMs: nowMs };
}
