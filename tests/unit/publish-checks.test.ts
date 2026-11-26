import { describe, expect, it } from 'vitest';
import { nextPendingCheck } from '@/lib/publishing/reconcile';
import { FIRST_CHECK_MS } from '@/lib/publishing/publisher';

describe('confirmation cadence right after the slot', () => {
  const slot = new Date('2026-11-26T10:00:00Z').getTime();
  it('the first check is 90 s after the slot (was 3 min), then every 90 s for the first 30 min', () => {
    expect(FIRST_CHECK_MS).toBe(90_000);
    expect(nextPendingCheck(new Date(slot), slot + 2 * 60_000).getTime() - (slot + 2 * 60_000)).toBe(90_000);
    expect(nextPendingCheck(new Date(slot), slot + 29 * 60_000).getTime() - (slot + 29 * 60_000)).toBe(90_000);
  });
  it('a post still pending after 30 min is checked every 5 min (stays cheap)', () => {
    expect(nextPendingCheck(new Date(slot), slot + 45 * 60_000).getTime() - (slot + 45 * 60_000)).toBe(5 * 60_000);
  });
});
