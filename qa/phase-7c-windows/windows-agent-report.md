● All processes exited cleanly — no survivors. Full verification complete on real Windows.



&#x20; Summary



&#x20; Installed Node.js 24.18.0 (via winget) and fully tested WRL Forge on this machine:



&#x20; Setup:

&#x20; - Node/npm installed and working

&#x20; - Discovered running npm ci directly on the \\\\host.lan\\Data SMB share breaks — cmd.exe (used by postinstall scripts)

&#x20; can't use a UNC path as its working directory, and I broke the share's node\_modules on my first attempt before

&#x20; realizing this. Cloned the repo locally to C:\\Projects\\wrlforge per the plan's own recommendation, npm ci there

&#x20; completed cleanly (336 packages, real Electron binary downloaded).



&#x20; Testing — found and fixed real bugs, all confirmed on live Windows:

&#x20; 1. npm test/npm run check were fundamentally broken on Windows — the scripts passed bare directory args

&#x20; (test/preview/) to node --test, which doesn't recurse into them on this Windows/Node 24 setup (though it works on

&#x20; Linux). Fixed by switching to explicit globs (test/preview/\*.test.js) — verified working identically on both platforms

&#x20; since Node's own test runner does the glob expansion, not the shell.

&#x20; 2. Two pre-existing test-fixture bugs, invisible until run on real Windows: path.resolve('/proj/...') prepends the

&#x20; current drive letter on Windows (e.g. C:\\proj\\...) but two test files hardcoded POSIX-style paths that never matched.

&#x20; Fixed texture-base.test.js and case-cross-platform.test.js to derive their expected/fixture paths through the same

&#x20; path.resolve() the product code uses.

&#x20; 3. My own 7C4 code (killerFor, checkSessionPresent, resolveExeForTarget, evidence.js) — all new tests pass on real

&#x20; Windows.



&#x20; Result: npm run check exits 0 — 407/407 tests pass plus the full syntax gate, on this machine, for real.



&#x20; Then actually ran the app: built the editor bundle, launched electron . directly, confirmed the window rendered

&#x20; correctly (screenshot: "WRL Forge — Mall Item lane" with the full toolbar), and shut it down cleanly with zero

&#x20; surviving processes.



&#x20; One thing to flag: the SMB share's node\_modules is still in the broken state I left it in after the failed UNC npm ci

&#x20; attempts — if the Linux side needs it working, someone should run npm ci there (from a location git/npm can handle,

&#x20; not directly over the share).



