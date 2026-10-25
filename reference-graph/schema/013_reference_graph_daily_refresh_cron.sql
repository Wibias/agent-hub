-- P21 automates the already-governed P10 current-date projection refresh.
-- The job stays entirely inside Postgres and carries no API credentials.

create extension if not exists pg_cron;

select cron.schedule(
  'reference-graph-p10-daily-refresh',
  '0,5 0 * * *',
  $cron$
    select public.reference_graph_refresh_quick_runtime_projection_p10();
  $cron$
);
