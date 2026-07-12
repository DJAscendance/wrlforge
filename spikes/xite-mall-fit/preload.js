'use strict';
// No API surface is exposed -- the spike loads its fixture via a same-origin
// fetch('fixtures/<name>.wrl') from index.html, not via any privileged Node
// or IPC channel. This file exists only so webPreferences.preload has a
// concrete target; contextIsolation stays enabled with nodeIntegration off.
