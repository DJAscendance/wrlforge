@echo off
REM Phase 7B1 Windows closeout: run the WRL Forge self-test (incl. the new passive-
REM launch cases) under the PACKED 1.2.0-beta.2 Electron runtime, as node, on real
REM NTFS. Result JSON + console log are written back to the host share.
setlocal
set SHARE=\\host.lan\Data\Projects\cybertown\wrlforge
set DEST=C:\wrlforge-b2
set OUTDIR=%SHARE%\qa\phase-7b1-windows-closeout

echo [1/3] Copying packed beta.2 runtime to %DEST% ...
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%SHARE%\release\win-unpacked" "%DEST%\" /E /I /Q /Y >nul

echo [2/3] Running self-test under packed Electron-as-node ...
set ELECTRON_RUN_AS_NODE=1
"%DEST%\WRL Forge.exe" "%SHARE%\qa\phase-6b-windows\win-selftest.js" --out "%OUTDIR%\selftest-b2-win-result.json" > "%OUTDIR%\selftest-b2-win-console.txt" 2>&1
set RC=%ERRORLEVEL%

echo [3/3] Done. exit=%RC%  (result -> %OUTDIR%\selftest-b2-win-result.json)
echo DONE %RC% > "%OUTDIR%\selftest-b2-win-DONE.txt"
endlocal
