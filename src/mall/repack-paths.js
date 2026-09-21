'use strict';
// Mall Repack path authority (Lane B, B2 correction).
//
// The Mall Repack IPC handler once resolved its paths like this:
//
//     const session   = currentSession;
//     const editPath  = session ? session.editFile : editFile;   // renderer value
//     const targetPath = session ? session.mallPath : mallPath;   // renderer value
//
// With a live session that reads correctly, but the fallback is the whole
// problem: when `currentSession` was null, the RENDERER named both the file
// that was read and the real artifact that was overwritten. A compromised or
// buggy renderer could therefore back up and replace any path the main process
// could reach, with no session ever having been opened. Main must own the
// Repack paths at all times, so there is no fallback -- only a session.
//
// This helper is the single place that decision lives. It is pure: no fs, no
// Electron, no renderer input at all. The caller cannot accidentally pass a
// renderer path through it, because it does not take one.
//
// `session` is the main process's own `currentSession` -- `{ mallPath, editFile }`
// or null.
//
// Returns the session's own `{ mallPath, editFile }`. Throws `ENOSESSION`
// ('No file is open.') when there is no session, BEFORE anything is read,
// backed up, encoded or written.
function activeRepackPaths(session) {
  if (!session || !session.mallPath || !session.editFile) {
    const err = new Error('No file is open.');
    err.code = 'ENOSESSION';
    throw err;
  }
  return { mallPath: session.mallPath, editFile: session.editFile };
}

module.exports = { activeRepackPaths };
