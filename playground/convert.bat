@echo off
cd /d "%~dp0"
py -3 convert.py %*
pause
