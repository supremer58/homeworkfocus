@echo off
cd /d "%~dp0"
echo Starting HomeworkFocus server...
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".claude\server.ps1"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5174/teacher.html"
