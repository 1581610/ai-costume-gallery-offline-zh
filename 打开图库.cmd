@echo off
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\serve.py"
  exit /b
)
where python >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0index.html"
) else (
  python "%~dp0scripts\serve.py"
)
