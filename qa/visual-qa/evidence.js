'use strict';
// Evidence collection for a QA run: environment snapshot, process-table
// snapshots (survivor proof), fixture hashing (mutation guard), and the
// RESULTS.md/results.json/environment.json run-directory shape described in
// docs/WINDOWS_NATIVE_QA_PLAN.md Sec.8. Platform-generic: `tasklist` on
// Windows, `ps` everywhere else.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function captureEnvironment(extra = {}) {
  let electronVersion = null;
  try { electronVersion = require('electron/package.json').version; } catch { /* not resolvable from this context */ }
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: extra.repoRoot || process.cwd(),
      encoding: 'utf8',
    }).trim();
  } catch { /* git not available or not a repo */ }
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    electronVersion,
    commit,
    capturedAt: new Date().toISOString(),
    ...extra,
  };
}

// tasklist on Windows, ps on everything else -- for before/after survivor proof.
function snapshotProcesses() {
  try {
    if (process.platform === 'win32') return execFileSync('tasklist', [], { encoding: 'utf8' });
    return execFileSync('ps', ['-eo', 'pid,ppid,comm'], { encoding: 'utf8' });
  } catch (err) {
    return `<snapshot failed: ${err.message}>`;
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Recursively hash every file under each root; returns { "relative/path": sha256, ... }.
// Used to prove committed fixtures were not mutated by a QA run (plan Sec.3/Sec.8).
function hashFixtures(roots) {
  const manifest = {};
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const p = stack.pop();
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        for (const entry of fs.readdirSync(p)) stack.push(path.join(p, entry));
      } else if (st.isFile()) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        manifest[rel] = hashFile(p);
      }
    }
  }
  return manifest;
}

function diffFixtureHashes(before, after) {
  const changed = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] !== after[k]) changed.push({ file: k, before: before[k] || null, after: after[k] || null });
  }
  return changed;
}

function renderResultsMd({ title, environment, changed, verdict, notes }) {
  const lines = [];
  lines.push(`# ${title || 'Windows Visual QA Run'}`);
  lines.push('');
  lines.push(`**Verdict: ${verdict}**`);
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(environment, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Fixture integrity');
  lines.push('');
  if (changed && changed.length) {
    lines.push('**FIXTURE MUTATION DETECTED -- this run must not be ingested:**');
    for (const c of changed) lines.push(`- \`${c.file}\`: ${c.before} -> ${c.after}`);
  } else {
    lines.push('No committed fixture hashes changed.');
  }
  lines.push('');
  if (notes) {
    lines.push('## Notes');
    lines.push('');
    lines.push(notes);
    lines.push('');
  }
  return lines.join('\n');
}

// Writes the full evidence run directory: RESULTS.md, results.json,
// environment.json, processes-before/after.txt, fixture-hashes-before/after.json.
// Returns { verdict, fixtureChanges } so the caller can set its own exit code.
function writeRunEvidence(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'environment.json'), JSON.stringify(data.environment, null, 2));
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(data.results, null, 2));
  if (data.processesBefore != null) fs.writeFileSync(path.join(dir, 'processes-before.txt'), data.processesBefore);
  if (data.processesAfter != null) fs.writeFileSync(path.join(dir, 'processes-after.txt'), data.processesAfter);
  if (data.console != null) fs.writeFileSync(path.join(dir, 'console.log'), data.console);
  if (data.stderr != null) fs.writeFileSync(path.join(dir, 'stderr.log'), data.stderr);
  if (data.fixtureHashesBefore) fs.writeFileSync(path.join(dir, 'fixture-hashes-before.json'), JSON.stringify(data.fixtureHashesBefore, null, 2));
  if (data.fixtureHashesAfter) fs.writeFileSync(path.join(dir, 'fixture-hashes-after.json'), JSON.stringify(data.fixtureHashesAfter, null, 2));

  const changed = (data.fixtureHashesBefore && data.fixtureHashesAfter)
    ? diffFixtureHashes(data.fixtureHashesBefore, data.fixtureHashesAfter)
    : [];
  const verdict = data.verdict || (changed.length || (data.results && data.results.failed) ? 'NO-GO' : 'GO');
  fs.writeFileSync(path.join(dir, 'RESULTS.md'), renderResultsMd({ ...data, changed, verdict }));
  return { verdict, fixtureChanges: changed };
}

module.exports = {
  captureEnvironment,
  snapshotProcesses,
  hashFile,
  hashFixtures,
  diffFixtureHashes,
  writeRunEvidence,
};
