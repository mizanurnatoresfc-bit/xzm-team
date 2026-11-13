@echo off
title XZM-TEAM demo - http://localhost:8080
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1"
