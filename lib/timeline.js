/**
 * Restart timeline: parse the helper log into per-restart phases so the UI can
 * answer "which restart, how long did it take, and which plugins came back up".
 *
 * Everything here is pure string/object work so it is unit-testable.
 */

/** Line shapes written by restart-helper.cjs. */
const START = /^\[([^\]]+)\] start helper pid \d+ shell \d+ host \d+ trigger (\S+)/;
const KILLED = /^\[([^\]]+)\] kill signalled pid \d+/;
const LAUNCHED = /^\[([^\]]+)\] launch replacement pid (\d+)/;
const DONE = /^\[([^\]]+)\] done (ok|failed)\b/;

const ms = iso => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Parse helper log text into restart attempts, oldest first.
 *
 * Each attempt carries the timestamps the helper actually wrote, so phase
 * durations are measured, not derived from a clock the caller has to trust.
 *
 * @param {string} text helper log contents
 * @returns {Array<{startedAt: string, trigger: string, killedAt: string|null,
 *   launchedAt: string|null, doneAt: string|null, ok: boolean|null,
 *   replacementPid: number|null,
 *   durations: {stopMs: number|null, launchMs: number|null, totalMs: number|null}}>}
 */
export function parseRestartLog(text) {
  if (typeof text !== 'string' || !text) return [];
  const attempts = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const start = START.exec(line);
    if (start) {
      current = { startedAt: start[1], trigger: start[2], killedAt: null, launchedAt: null, doneAt: null, ok: null, replacementPid: null, durations: {} };
      attempts.push(current);
      continue;
    }
    if (!current) continue;
    const killed = KILLED.exec(line);
    if (killed && !current.killedAt) { current.killedAt = killed[1]; continue; }
    const launched = LAUNCHED.exec(line);
    if (launched) { current.launchedAt = launched[1]; current.replacementPid = Number(launched[2]) || null; continue; }
    const done = DONE.exec(line);
    if (done) { current.doneAt = done[1]; current.ok = done[2] === 'ok'; }
  }
  for (const attempt of attempts) {
    const startMs = ms(attempt.startedAt);
    const killMs = ms(attempt.killedAt);
    const launchMs = ms(attempt.launchedAt);
    const doneMs = ms(attempt.doneAt);
    attempt.durations = {
      stopMs: startMs !== null && killMs !== null ? Math.max(0, killMs - startMs) : null,
      launchMs: killMs !== null && launchMs !== null ? Math.max(0, launchMs - killMs) : null,
      totalMs: startMs !== null && doneMs !== null ? Math.max(0, doneMs - startMs) : null,
    };
  }
  return attempts;
}

/**
 * Newest attempt first, capped. Sorts by the parsed timestamp rather than file
 * order so a rotated or hand-edited log still reads chronologically.
 */
export function recentRestarts(text, limit = 10) {
  const attempts = parseRestartLog(text);
  const ordered = attempts
    .map((attempt, index) => ({ attempt, index, at: ms(attempt.startedAt) }))
    .sort((a, b) => {
      if (a.at !== null && b.at !== null && a.at !== b.at) return b.at - a.at;
      return b.index - a.index;
    })
    .map(row => row.attempt);
  return ordered.slice(0, Math.max(1, limit));
}

/**
 * Average measured total for completed attempts, or null when none finished.
 * @param {Array<{durations?: {totalMs?: number|null}}>} attempts
 * @returns {{count: number, avgMs: number|null, maxMs: number|null}}
 */
export function restartStats(attempts) {
  const totals = (Array.isArray(attempts) ? attempts : [])
    .map(a => a && a.durations ? a.durations.totalMs : null)
    .filter(v => typeof v === 'number' && v >= 0);
  if (!totals.length) return { count: 0, avgMs: null, maxMs: null };
  const sum = totals.reduce((acc, v) => acc + v, 0);
  return { count: totals.length, avgMs: Math.round(sum / totals.length), maxMs: Math.max(...totals) };
}

/**
 * Split an elapsed millisecond count into the phase buckets the UI shows.
 * @param {{stopMs?: number|null, launchMs?: number|null, totalMs?: number|null}} durations
 * @returns {{stopMs: number|null, launchMs: number|null, totalMs: number|null}}
 */
export function phaseBreakdown(durations) {
  const value = durations && typeof durations === 'object' ? durations : {};
  const pick = key => (typeof value[key] === 'number' && value[key] >= 0 ? Math.round(value[key]) : null);
  return { stopMs: pick('stopMs'), launchMs: pick('launchMs'), totalMs: pick('totalMs') };
}

/**
 * Duration between the restart request and the host that replaced it.
 * Used when the helper log is unavailable (recovered state, rotated logs).
 * @param {string|null} requestedAt ISO timestamp of the request
 * @param {string|null} bootedAt ISO timestamp when the new host started
 * @returns {number|null} milliseconds, or null when either side is unknown
 */
export function bootDuration(requestedAt, bootedAt) {
  const from = ms(requestedAt);
  const to = ms(bootedAt);
  if (from === null || to === null || to < from) return null;
  return to - from;
}

/**
 * Merge helper-log phases with the boot gap into one report row.
 *
 * @param {object} input
 * @param {string|null} [input.requestedAt] when the user asked for the restart
 * @param {string|null} [input.bootedAt] when the replacing host started
 * @param {{stopMs?: number|null, launchMs?: number|null, totalMs?: number|null}} [input.phases]
 * @param {string|null} [input.trigger]
 * @param {boolean|null} [input.ok]
 * @param {string|null} [input.log]
 * @returns {{requestedAt: string|null, bootedAt: string|null, trigger: string|null,
 *   ok: boolean|null, log: string|null, phases: object, bootMs: number|null, totalMs: number|null}}
 */
export function restartSummary({ requestedAt = null, bootedAt = null, phases = null, trigger = null, ok = null, log = null } = {}) {
  const measured = phaseBreakdown(phases);
  const gap = bootDuration(requestedAt, bootedAt);
  return {
    requestedAt,
    bootedAt,
    trigger,
    ok,
    log,
    phases: measured,
    bootMs: gap,
    totalMs: measured.totalMs !== null ? measured.totalMs : gap,
  };
}
