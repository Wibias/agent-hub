-- P51 supplementary SQL: scheduled refresh execution metadata.
-- READ-ONLY, no cron.command, return_message, worker secrets or payload rows.
-- The job logs corroborate job execution, NOT exact historical source bytes.
SELECT j.jobname, d.jobid, d.status,
  d.start_time AT TIME ZONE 'UTC' AS start_utc,
  d.end_time AT TIME ZONE 'UTC' AS end_utc,
  extract(epoch FROM d.end_time - d.start_time)::numeric(12,3) AS duration_seconds
FROM cron.job_run_details d
JOIN cron.job j USING (jobid)
WHERE d.jobid IN (1,2)
  AND d.start_time >= '2026-11-08T01:55:00Z'::timestamptz
  AND d.start_time < '2026-11-08T02:10:00Z'::timestamptz
ORDER BY d.start_time;

SELECT date(d.start_time AT TIME ZONE 'UTC') AS run_date_utc,
  j.jobname, count(*) AS run_count,
  count(*) FILTER (WHERE d.status = 'succeeded') AS succeeded,
  count(*) FILTER (WHERE d.status IS DISTINCT FROM 'succeeded') AS not_succeeded,
  min(d.start_time) AT TIME ZONE 'UTC' AS first_start_utc,
  max(d.start_time) AT TIME ZONE 'UTC' AS last_start_utc
FROM cron.job_run_details d
JOIN cron.job j USING (jobid)
WHERE d.jobid IN (1,2)
  AND d.start_time >= '2026-11-08T00:00:00Z'::timestamptz
  AND d.start_time < '2026-11-10T00:00:00Z'::timestamptz
GROUP BY date(d.start_time AT TIME ZONE 'UTC'), j.jobname
ORDER BY run_date_utc, j.jobname;
