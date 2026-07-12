'use strict';
// A stateful World Project session: holds the currently-open project (root +
// detected primary candidates), runs scans, and enforces the refresh-safety
// rules from the Phase 4A spec:
//   * exactly one scan at a time (overlapping scans are refused, not queued),
//   * a superseding scan token so a stale in-flight result can be ignored,
//   * the last successful scan stays available if a later scan errors.
//
// The actual scan function is injected (project-loader.scanProject by default),
// so this is unit-testable without a filesystem or Electron.

const loader = require('./project-loader');

class ProjectSession {
  constructor(deps = {}) {
    this.scanFn = deps.scanProject || loader.scanProject;
    this.root = null;
    this.primary = null;
    this.candidates = [];
    this.ambiguous = false;
    this.empty = false;
    this.last = null;        // last successful scan result
    this._scanning = false;
    this._token = 0;         // increments each scan; used to detect supersession
  }

  // Adopt a detection result (from project-loader.detectPrimaries or a direct
  // single-file open). Clears any previous scan.
  open({ root, primary = null, candidates = [], ambiguous = false, empty = false }) {
    this.root = root;
    this.primary = primary;
    this.candidates = candidates;
    this.ambiguous = ambiguous;
    this.empty = empty;
    this.last = null;
    return this.describe();
  }

  // Pick one of the detected candidates as the primary (validated against the
  // candidate list so a caller can't point the scan at an arbitrary path).
  choosePrimary(primaryPath) {
    const match = this.candidates.find((c) => c.path === primaryPath);
    if (!match) { const e = new Error('primary is not among the detected candidates'); e.code = 'EBADPRIMARY'; throw e; }
    this.primary = match.path;
    this.ambiguous = false;
    return this.describe();
  }

  describe() {
    return {
      root: this.root,
      primary: this.primary,
      candidates: this.candidates,
      ambiguous: this.ambiguous,
      empty: this.empty,
      scanning: this._scanning,
    };
  }

  isOpen() { return !!this.root; }

  async scan(opts = {}) {
    if (!this.primary) { const e = new Error('no primary world selected'); e.code = 'ENOPRIMARY'; throw e; }
    if (this._scanning) { const e = new Error('a scan is already in progress'); e.code = 'EBUSY'; throw e; }
    this._scanning = true;
    const token = ++this._token;
    try {
      const result = await this.scanFn({ root: this.root, primary: this.primary }, opts);
      // A newer scan started and finished first -> this one is stale; keep the
      // newer result and report supersession rather than clobbering it.
      if (token !== this._token) return { ...result, superseded: true };
      this.last = result;
      return result;
    } catch (err) {
      // Keep the last good result visible on a transient failure.
      if (this.last) return { ...this.last, stale: true, error: String((err && err.message) || err) };
      throw err;
    } finally {
      if (token === this._token) this._scanning = false;
    }
  }
}

module.exports = { ProjectSession };
