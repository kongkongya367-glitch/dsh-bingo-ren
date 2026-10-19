import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootDuration,
  parseRestartLog,
  phaseBreakdown,
  recentRestarts,
  restartStats,
  restartSummary,
} from '../lib/timeline.js';

const NL = String.fromCharCode(10);
const log = (...rows) => rows.join(NL);

const GOOD = log(
  '[2026-10-19T08:52:49.309Z] start helper pid 23852 shell 9512 host 18628 trigger button',
  '[2026-10-19T08:52:49.971Z] kill signalled pid 9512',
  '[2026-10-19T08:52:50.250Z] launch replacement pid 30052',
  '[2026-10-19T08:52:52.804Z] done ok replacement pid 30052 verified=false',
);

const FAILED = log(
  '[2026-10-19T09:00:00.000Z] start helper pid 1 shell 2 host 3 trigger new-plugin',
  '[2026-10-19T09:00:00.500Z] kill signalled pid 2',
  '[2026-10-19T09:00:01.000Z] launch replacement pid 123',
  '[2026-10-19T09:00:02.000Z] done failed replacement exited',
);

test('parseRestartLog reads triggers, phases and outcome', () => {
  const [attempt] = parseRestartLog(GOOD);
  assert.equal(attempt.trigger, 'button');
  assert.equal(attempt.replacementPid, 30052);
  assert.equal(attempt.ok, true);
  assert.equal(attempt.durations.stopMs, 662);
  assert.equal(attempt.durations.launchMs, 279);
  assert.equal(attempt.durations.totalMs, 3495);
});

test('parseRestartLog keeps multiple attempts separate', () => {
  const attempts = parseRestartLog(GOOD + NL + FAILED);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].ok, true);
  assert.equal(attempts[1].ok, false);
  assert.equal(attempts[1].trigger, 'new-plugin');
  assert.equal(attempts[1].durations.totalMs, 2000);
});

test('parseRestartLog tolerates garbage and empty input', () => {
  assert.deepEqual(parseRestartLog(''), []);
  assert.deepEqual(parseRestartLog(null), []);
  assert.deepEqual(parseRestartLog('random text' + NL + '[bad]'), []);
  const partial = parseRestartLog('[2026-10-19T09:00:00.000Z] start helper pid 1 shell 2 host 3 trigger shortcut');
  assert.equal(partial.length, 1);
  assert.equal(partial[0].ok, null);
  assert.equal(partial[0].durations.totalMs, null);
  assert.equal(partial[0].durations.stopMs, null);
});

test('recentRestarts returns newest first and honours the limit', () => {
  const text = [GOOD, FAILED, GOOD].join(NL);
  const recent = recentRestarts(text, 2);
  assert.equal(recent.length, 2);
  assert.ok(recent[0].startedAt >= recent[1].startedAt);
});

test('restartStats averages completed attempts only', () => {
  const attempts = parseRestartLog(GOOD + NL + FAILED);
  const stats = restartStats(attempts);
  assert.equal(stats.count, 2);
  assert.equal(stats.maxMs, 3495);
  assert.equal(stats.avgMs, Math.round((3495 + 2000) / 2));
  assert.deepEqual(restartStats([]), { count: 0, avgMs: null, maxMs: null });
  assert.deepEqual(restartStats(null), { count: 0, avgMs: null, maxMs: null });
});

test('phaseBreakdown rounds and rejects negatives', () => {
  assert.deepEqual(phaseBreakdown({ stopMs: 100.6, launchMs: -5, totalMs: 2000.4 }), { stopMs: 101, launchMs: null, totalMs: 2000 });
  assert.deepEqual(phaseBreakdown(null), { stopMs: null, launchMs: null, totalMs: null });
});

test('bootDuration measures the gap and rejects impossible order', () => {
  assert.equal(bootDuration('2026-10-19T08:00:00.000Z', '2026-10-19T08:00:04.500Z'), 4500);
  assert.equal(bootDuration('2026-10-19T08:00:05.000Z', '2026-10-19T08:00:00.000Z'), null);
  assert.equal(bootDuration(null, '2026-10-19T08:00:00.000Z'), null);
  assert.equal(bootDuration('not-a-date', '2026-10-19T08:00:00.000Z'), null);
});

test('restartSummary prefers measured helper phases over the boot gap', () => {
  const summary = restartSummary({
    requestedAt: '2026-10-19T08:52:49.309Z',
    bootedAt: '2026-10-19T08:52:52.804Z',
    phases: { stopMs: 662, launchMs: 279, totalMs: 3495 },
    trigger: 'button',
    ok: true,
    log: 'C:/log.txt',
  });
  assert.equal(summary.totalMs, 3495);
  assert.equal(summary.bootMs, 3495);
  assert.equal(summary.trigger, 'button');
  assert.equal(summary.phases.launchMs, 279);
});

test('restartSummary falls back to the boot gap when the log is gone', () => {
  const summary = restartSummary({ requestedAt: '2026-10-19T08:00:00.000Z', bootedAt: '2026-10-19T08:00:03.000Z' });
  assert.equal(summary.totalMs, 3000);
  assert.equal(summary.phases.totalMs, null);
});
