@echo off
setlocal
set SHARE=\\host.lan\Data\Projects\cybertown\wrlforge
set OUT=%SHARE%\qa\phase-7b1-windows-closeout\diag-editor-out.txt
echo ==== persistent env (as seen by a fresh shell) ==== > "%OUT%"
echo WRL_FORGE_NO_EDITOR=[%WRL_FORGE_NO_EDITOR%] >> "%OUT%"
echo WRL_FORGE_EDITOR=[%WRL_FORGE_EDITOR%] >> "%OUT%"
echo ==== resolveEditor (packed Electron-as-node) ==== >> "%OUT%"
set ELECTRON_RUN_AS_NODE=1
"C:\wrlforge-b2\WRL Forge.exe" "%SHARE%\qa\phase-7b1-windows-closeout\diag-editor.js" >> "%OUT%" 2>&1
echo DONE %ERRORLEVEL% > "%SHARE%\qa\phase-7b1-windows-closeout\diag-editor-DONE.txt"
endlocal
