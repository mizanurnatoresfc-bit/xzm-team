-- Sorting functions: signed-in users only (each also checks permissions inside).
revoke execute on function public.sorting_dashboard(uuid, date, date), public.sorting_route_report(uuid, date, date),
  public.sorting_fuel_decide(uuid, boolean, text), public.sorting_fuel_withdraw(uuid, text),
  public.sorting_handover_receive(uuid, integer, integer, integer, integer, text),
  public.sorting_fuel_save(uuid, numeric, text, uuid, uuid, text, date, numeric, numeric, numeric, text, text, text, text, uuid, uuid),
  public.my_duties(uuid) from public, anon;
grant execute on function public.sorting_dashboard(uuid, date, date), public.sorting_route_report(uuid, date, date),
  public.sorting_fuel_decide(uuid, boolean, text), public.sorting_fuel_withdraw(uuid, text),
  public.sorting_handover_receive(uuid, integer, integer, integer, integer, text),
  public.sorting_fuel_save(uuid, numeric, text, uuid, uuid, text, date, numeric, numeric, numeric, text, text, text, text, uuid, uuid),
  public.my_duties(uuid) to authenticated;
