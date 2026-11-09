-- Read-only P38 cycle-health snapshot. Run only with an explicitly authorized
-- monitor role that can SELECT cron.job and cron.job_run_details.
-- This is not a migration and must never be pointed at production without
-- the approved monitoring rollout.

with target_job as (
  select jobid
  from cron.job
  where jobname = 'reference-graph-p31-profile-refresh'
),
runs as (
  select
    date_trunc('hour', start_time)
      - make_interval(hours => (extract(hour from start_time)::int % 2)) as cycle_start,
    start_time,
    status
  from cron.job_run_details
  where jobid = (select jobid from target_job)
    and start_time > statement_timestamp() - interval '7 days'
),
cycles as (
  select
    cycle_start,
    count(*)::int as invocations,
    count(*) filter (where status = 'succeeded')::int as succeeded
  from runs
  group by cycle_start
),
ordered as (
  select *, row_number() over (order by cycle_start desc) as rn
  from cycles
),
first_success as (
  select min(rn) as rn from ordered where succeeded > 0
),
leading_failed as (
  select count(*)::int as consecutive_failed
  from ordered
  where rn < coalesce((select rn from first_success), 2147483647)
    and succeeded = 0
)
select jsonb_build_object(
  'schema_version', 'reference-graph.p39-p38-cycle-health.v1',
  'observed_at', to_char(statement_timestamp() at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'cycles', jsonb_build_object(
    'consecutive_failed', (select consecutive_failed from leading_failed),
    'last_cycle_start', (
      select to_char(cycle_start at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from ordered order by cycle_start desc limit 1
    ),
    'last_cycle_status', (
      select case when succeeded > 0 then 'succeeded' else 'failed' end
      from ordered order by cycle_start desc limit 1
    )
  )
) as p38_cycle_health;
