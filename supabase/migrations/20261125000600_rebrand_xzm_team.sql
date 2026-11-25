-- =====================================================================
-- XZM TEAM — Migration: drop "ERP" from the displayed brand name
--
-- The brand name shown on the website, Android app and every report is
-- just "XZM TEAM". Earlier migrations stored the browser-tab title as
-- 'XZM-TEAM — Management + Accounts ERP' and the company name as
-- 'XZM-TEAM'. This migration updates the live values so no "ERP" shows
-- anywhere a user can see. New installs already receive 'XZM TEAM' from
-- the default-branding code path (web/src/lib/branding.ts).
-- Internal identifiers — the Android package id, the Netlify project,
-- the Supabase project and the git repo name — are deliberately left
-- unchanged: they are not shown to users and breaking them would log
-- every installed Android app out and detach it from Firebase push.
-- =====================================================================

update public.system_settings
   set value = '"XZM TEAM"'
 where key = 'branding.system_title'
   and value::text in ('"XZM-TEAM — Management + Accounts ERP"', '"XZM-TEAM"', '"XZM TEAM"');

update public.system_settings
   set value = '"XZM TEAM"'
 where key = 'branding.company_name'
   and value::text in ('"XZM-TEAM"', '"XZM TEAM"');

update public.system_settings
   set value = '"XZM TEAM"'
 where key = 'branding.name_bn'
   and value::text in ('"XZM-TEAM"', '"XZM TEAM"');
