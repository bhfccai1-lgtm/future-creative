#!/usr/bin/env node
/**
 * Prepares a release in one step:  node scripts/release-prep.mjs 9.2.0 "short title"
 *   - turns «## Unreleased» in CHANGELOG.md into «## 9.2.0 — YYYY-MM-DD (title)» and opens a new empty «## Unreleased»
 *   - sets package.json "version" (the Release workflow checks both before publishing)
 * Then commit, push, wait for the green ✓, and publish the release on GitHub with tag v9.2.0.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const [, , version, ...titleParts] = process.argv;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('usage: node scripts/release-prep.mjs X.Y.Z "title"'); process.exit(1); }
const title = titleParts.join(' ').trim();
const date = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // Bahrain date
const log = readFileSync('CHANGELOG.md', 'utf8');
if (log.includes(`\n## ${version} `) || log.includes(`\n## ${version}\n`)) { console.error(`CHANGELOG.md already has ${version}`); process.exit(1); }
if (!/\n## Unreleased\s*\n/.test(log)) { console.error('CHANGELOG.md has no «## Unreleased» section'); process.exit(1); }
const body = log.split(/\n## Unreleased\s*\n/)[1].split(/\n## /)[0].trim();
if (!body) { console.error('«## Unreleased» is empty — nothing to release'); process.exit(1); }
writeFileSync('CHANGELOG.md', log.replace(/\n## Unreleased\s*\n/, `\n## Unreleased\n\n## ${version} — ${date}${title ? ` (${title})` : ''}\n`));
const pkg = JSON.parse(readFileSync('package.json', 'utf8')); const prev = pkg.version; pkg.version = version;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
try { const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')); lock.version = version; if (lock.packages?.['']) lock.packages[''].version = version; writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`); } catch { /* no lockfile */ }
console.log(`✓ ${prev} → ${version}. Next: git commit -am "Release ${version}" && git push, wait for ci-ok ✓, then publish the release with tag v${version}:`);
console.log(`  https://github.com/bhfccai1-lgtm/future-creative/releases/new?tag=v${version}&target=main&title=v${version}`);
