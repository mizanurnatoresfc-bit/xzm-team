@echo off
rem Creates web\.env.local for the Supabase dev project xzm-team-erp-dev.
rem These two values are public browser values (URL + publishable key); RLS protects the data.
cd /d "%~dp0"
if exist .env.local (
  echo .env.local already exists - not changed.
  type .env.local
  pause
  exit /b 0
)
> .env.local echo VITE_SUPABASE_URL=https://ndgnhvbpmtxrpplgsslz.supabase.co
>> .env.local echo VITE_SUPABASE_ANON_KEY=sb_publishable_gTwjXlVoDCq8D7es_YLogw_4oX4y4sZ
echo Created web\.env.local:
type .env.local
pause
