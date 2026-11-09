-- P38: bounded P31 Standard/Deep profile projection refresh.
-- Keep P10/P11 routing and the existing P10 daily cron job unchanged.
-- P30 requires age <= 4 hours; use a 2-hour cadence with a +5-minute retry.
-- Supabase pg_cron uses UTC. Every invocation is an atomic P31 transaction.
-- Jobs run as the privileged postgres role; no API key or HTTP required.

do $guard$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'P38 requires existing pg_cron installation';
  end if;
  if to_regclass('public.reference_graph_profile_runtime_projection_p30_v1') is null
    or to_regprocedure('public.reference_graph_refresh_profile_runtime_projection_p31()') is null then
    raise exception 'P38 requires existing P31 projection and refresh';
  end if;
  if exists (
    select 1 from cron.job
    where jobname = 'reference-graph-p31-profile-refresh'
  ) then
    raise exception 'P38 cron job already exists; audit it instead of silently replacing';
  end if;
end;
$guard$;

select cron.schedule(
  'reference-graph-p31-profile-refresh',
  '0,5 */2 * * *',
  $job$select public.reference_graph_refresh_profile_runtime_projection_p31();$job$
);
