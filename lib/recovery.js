/** Pure rollback planning and package installation specifications. */
/** Package name shape accepted everywhere (same rule as the activity journal). */
const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

/** Version prefixes that identify a non-registry spec instead of a range. */
const SPEC_PREFIX = /^(?:link|file|portal|workspace|git\+|git:|github:|https?|npm):/i;

const cleanList = value => Array.isArray(value)
  ? value.filter(p => p && PACKAGE_NAME.test(p.name))
    .slice(0, 1000)
    .map(p => ({
      name: p.name,
      version: typeof p.version === 'string' ? p.version.slice(0, 512) : null,
      enabled: typeof p.enabled === 'boolean' ? p.enabled : null,
    }))
  : [];

/**
 * Compare a checkpoint against the current package list.
 *
 * A package counts as changed when its declared version OR its enabled flag
 * differs, because disabling a bundle is the most common reason to roll back.
 *
 * @param {Array<{name: string, version: string|null, enabled?: boolean}>} current installed now
 * @param {Array<{name: string, version: string|null, enabled?: boolean}>} target checkpoint to return to
 * @returns {{remove: string[], install: Array<{name: string, version: string|null}>,
 *   enable: string[], disable: string[], same: number}}
 */
export function planRollback(current, target) {
  const now = new Map(cleanList(current).map(p => [p.name, p]));
  const want = new Map(cleanList(target).map(p => [p.name, p]));
  const remove = [];
  const install = [];
  const enable = [];
  const disable = [];
  let same = 0;
  for (const [name, entry] of now) {
    const wanted = want.get(name);
    if (!wanted) { remove.push(name); continue; }
    if (wanted.version !== entry.version) { install.push({ name, version: wanted.version, ...(wanted.enabled === null ? (entry.enabled === null ? {} : { enabled: entry.enabled }) : { enabled: wanted.enabled }) }); continue; }
    if (wanted.enabled !== null && wanted.enabled !== entry.enabled) { (wanted.enabled ? enable : disable).push(name); continue; }
    same += 1;
  }
  for (const [name, wanted] of want) if (!now.has(name)) install.push({ name, version: wanted.version, ...(wanted.enabled === null ? {} : { enabled: wanted.enabled }) });
  remove.sort();
  install.sort((a, b) => a.name.localeCompare(b.name));
  enable.sort();
  disable.sort();
  return { remove, install, enable, disable, same };
}

/** True when the plan changes nothing. */
export const isNoopPlan = plan => plan.remove.length === 0
  && plan.install.length === 0
  && plan.enable.length === 0
  && plan.disable.length === 0;

/**
 * Spec string for reinstalling one package at a checkpoint version.
 *
 * Registry ranges become `name@range`. Local links, file paths and git specs
 * are passed through unchanged: appending `@version` to them produces a spec
 * that pnpm cannot resolve.
 *
 * @param {{name: string, version: string|null}} entry
 * @returns {string}
 */
export function installSpec(entry) {
  const version = typeof entry.version === 'string' ? entry.version.trim() : '';
  if (!version) return entry.name;
  if (!SPEC_PREFIX.test(version)) return entry.name + '@' + version;
  // Local link and file specs must keep forward slashes: a Windows path with
  // backslashes inside `name@link:...` cannot be parsed by pnpm.
  const local = /^(?:link|file|portal):/i.test(version);
  const spec = local ? version.replace(/\\/g, '/') : version;
  return entry.name + '@' + spec;
}
