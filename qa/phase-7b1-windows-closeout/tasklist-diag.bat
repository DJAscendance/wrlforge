@echo off
setlocal
set OUT=\\host.lan\Data\Projects\cybertown\wrlforge\qa\phase-7b1-windows-closeout\tasklist-out.txt
echo ==== VSCodium / Code processes ==== > "%OUT%"
tasklist /FI "IMAGENAME eq VSCodium.exe" >> "%OUT%" 2>&1
tasklist /FI "IMAGENAME eq Code.exe" >> "%OUT%" 2>&1
echo ==== any codium ==== >> "%OUT%"
tasklist ^| findstr /I codium >> "%OUT%" 2>&1
echo ==== WRL Forge ==== >> "%OUT%"
tasklist /FI "IMAGENAME eq WRL Forge.exe" >> "%OUT%" 2>&1
echo DONE %ERRORLEVEL% > "\\host.lan\Data\Projects\cybertown\wrlforge\qa\phase-7b1-windows-closeout\tasklist-DONE.txt"
endlocal
