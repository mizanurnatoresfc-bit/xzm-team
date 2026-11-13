@echo off
setlocal
rem XZM-TEAM ERP: builds the Android app (APK) from the same code as the website.
rem Needs: Node.js and Android Studio (installed once). First run downloads a lot (10-20 minutes).
cd /d "%~dp0web"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  start "" "https://nodejs.org"
  pause & exit /b 1
)
if not exist ".env.local" (
  echo web\.env.local not found. Run web\create-env.bat first, then run this again.
  pause & exit /b 1
)
if not exist "%LOCALAPPDATA%\Android\Sdk" (
  echo Android Studio is not installed yet.
  echo Install it from the page that opens, open it once and finish its setup wizard, then run this again.
  start "" "https://developer.android.com/studio"
  pause & exit /b 1
)

echo [1/6] Installing packages...
call npm install
if errorlevel 1 goto fail

echo [2/6] Building the app pages...
call npm run build
if errorlevel 1 goto fail

if not exist "android" (
  echo [3/6] Creating the Android project (first time only)...
  call npx cap add android
  if errorlevel 1 goto fail
) else (
  echo [3/6] Android project already exists.
)

echo [4/6] App icon and splash screen...
call npx -y @capacitor/assets generate --android
if errorlevel 1 echo    (icons skipped - the app still works with the default icon)

echo [5/6] Copying the pages into the Android project...
call npx cap sync android
if errorlevel 1 goto fail

echo [6/6] Building the APK...
if "%JAVA_HOME%"=="" if exist "%ProgramFiles%\Android\Android Studio\jbr" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not exist "android\local.properties" (
  set "SDKDIR=%LOCALAPPDATA:\=/%/Android/Sdk"
  call echo sdk.dir=%%SDKDIR%%> "android\local.properties"
)
pushd android
call gradlew.bat assembleDebug
if errorlevel 1 ( popd & goto fail )
popd
copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "%~dp0XZM-TEAM.apk" >nul
echo.
echo DONE. The app file is: %~dp0XZM-TEAM.apk
echo Send it to an Android phone (WhatsApp/Drive/USB) and open it to install.
explorer /select,"%~dp0XZM-TEAM.apk"
pause
exit /b 0

:fail
echo.
echo Something failed. Take a screenshot of this window and send it to Claude.
pause
exit /b 1
