@echo off
REM Phase 6B Windows self-test launcher. Type this file's \\host.lan\Data\... path
REM into the Start-menu search (Run command) to execute it in the VM.
REM
REM Runs win-selftest.js under the PACKAGED beta Electron runtime as node
REM (ELECTRON_RUN_AS_NODE) against the repo source on the share, writing a JSON
REM result + console log next to this file. The 200+MB Electron binary is copied
REM to C:\wrlbeta first (running it off the SMB share is slow/flaky).
setlocal
set SRC=%~dp0..\..\release\win-unpacked
set DST=C:\wrlbeta
if not exist "%DST%\WRL Forge.exe" (
  echo Copying app to %DST% ...
  xcopy "%SRC%" "%DST%" /E /I /Y /Q >nul
)
set ELECTRON_RUN_AS_NODE=1
echo Running Phase 6B self-test under packaged beta Electron...
"%DST%\WRL Forge.exe" "%~dp0win-selftest.js" --out "%~dp0selftest-6b-result.json" > "%~dp0selftest-6b-console.txt" 2>&1
echo EXITCODE=%ERRORLEVEL% > "%~dp0selftest-6b-done.txt"
echo Done. Exit=%ERRORLEVEL%
endlocal
