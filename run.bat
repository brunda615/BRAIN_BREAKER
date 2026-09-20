@echo off
echo ===================================================
echo     STARTING TAMBOLA PUZZLE WEB ARENA SERVER
echo ===================================================
echo.
echo Launching server on http://localhost:8000 ...
echo Admin Dashboard will be at http://localhost:8000/admin (Passcode: BMS123)
echo.
start http://localhost:8000
python -u server.py
pause
