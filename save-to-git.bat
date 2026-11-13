@echo off
title XZM-TEAM - save to git
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-git.ps1"
