alter table public.hubs add column trip_wifi_ssid text
  check (trip_wifi_ssid is null or octet_length(trip_wifi_ssid) between 1 and 32);

comment on column public.hubs.trip_wifi_ssid is
  'Hub Wi-Fi network name shown on sorting receipts. Never a password or proof of network identity.';
