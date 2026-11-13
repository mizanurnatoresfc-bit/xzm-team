@echo off
rem XZM-TEAM ERP: builds the website for upload to Netlify.
cd /d "%~dp0web"
if not exist ".env.local" (
  echo web\.env.local not found. Run web\create-env.bat first.
  pause
  exit /b 1
)
echo Installing packages (first time can take a few minutes)...
call npm install
if errorlevel 1 goto fail
echo Building the site...
call npm run build
if errorlevel 1 goto fail
echo.
echo DONE. Now drag the "dist" folder into the Netlify page that opens.
start "" explorer "%~dp0web"
start "" "https://app.netlify.com/sites/xzm-team-erp/deploys"
pause
exit /b 0
:fail
echo.
echo Build failed. Take a screenshot of this window and send it to Claude.
pause
exit /b 1
