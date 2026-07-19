import test from 'node:test';
import assert from 'node:assert/strict';
import { isRunStale, latestExpectedRunAt } from '../src/schedule.js';

test('weekend schedule expects the latest 09:27 Taipei run', () => {
  const now = new Date('2026-07-19T03:18:00.000Z'); // Sunday 11:18 in Taipei
  assert.equal(latestExpectedRunAt(now).toISOString(), '2026-07-19T01:27:00.000Z');
  assert.equal(isRunStale('2026-07-18T17:10:00.000Z', now), true);
});

test('fresh weekend data is not marked stale', () => {
  const now = new Date('2026-07-19T03:18:00.000Z');
  assert.equal(isRunStale('2026-07-19T01:30:00.000Z', now), false);
});

test('grace period avoids warning while a scheduled scrape can still be running', () => {
  const now = new Date('2026-07-20T01:50:00.000Z'); // Monday 09:50 in Taipei
  assert.equal(isRunStale('2026-07-19T11:30:00.000Z', now), false);
});
