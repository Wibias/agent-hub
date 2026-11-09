-- P53: exact 24-hour P31 cron EXECUTION-SIDE soak, read-only.
-- Date window [2026-11-08 20:00 UTC, 2026-11-09 20:00 UTC).
-- This is NOT an API latency, full-source content, or production rollback soak.
-- P38 cycles are even UTC 2-hour windows with successes at :00 and :05.
WITH bounds AS (
 SELECT '2026-11-08 20:00:00+00'::timestamptz AS started,
        '2026-11-09 20:00:00+00'::timestamptz AS finished
), cycles AS (
 SELECT gs AS cycle_start, gs + interval '2 hours' AS cycle_end
 FROM bounds b CROSS JOIN LATERAL generate_series(
   b.started,b.finished-interval '2 hours',interval '2 hours'
 ) gs
), runs AS (
 SELECT d.jobid,d.status,d.start_time,d.end_time,
   extract(epoch from d.end_time-d.start_time) AS duration_seconds
 FROM cron.job_run_details d,bounds b
 WHERE d.jobid=2 AND d.start_time>=b.started AND d.start_time<b.finished
), cycle_status AS (
 SELECT c.cycle_start,
  count(r.start_time) AS attempts,
  count(*) FILTER(WHERE r.status='succeeded') AS successes,
  count(*) FILTER(WHERE r.status IS DISTINCT FROM 'succeeded'
    AND r.start_time IS NOT NULL) AS failures,
  count(*) FILTER(WHERE r.status='succeeded'
    AND r.start_time>=c.cycle_start
    AND r.start_time<c.cycle_start+interval '2 minutes') AS on_the_hour_success,
  count(*) FILTER(WHERE r.status='succeeded'
    AND r.start_time>=c.cycle_start+interval '5 minutes'
    AND r.start_time<c.cycle_start+interval '7 minutes') AS five_minutes_later_success
 FROM cycles c LEFT JOIN runs r
   ON r.start_time>=c.cycle_start AND r.start_time<c.cycle_end
 GROUP BY c.cycle_start
), gaps AS (
 SELECT extract(epoch from start_time-lag(start_time)
    over(order by start_time)) AS gap_seconds FROM runs
)
SELECT (SELECT started AT TIME ZONE 'UTC' FROM bounds) AS window_start_utc,
 (SELECT finished AT TIME ZONE 'UTC' FROM bounds) AS window_end_utc,
 count(*) AS two_hour_cycles,
 count(*) FILTER(WHERE attempts=2 AND successes=2 AND failures=0
   AND on_the_hour_success=1 AND five_minutes_later_success=1) AS qualifying_cycles,
 count(*) FILTER(WHERE attempts<>2 OR successes<>2 OR failures<>0
   OR on_the_hour_success<>1 OR five_minutes_later_success<>1) AS deficient_cycles,
 sum(attempts) AS attempts, sum(successes) AS succeeded, sum(failures) AS failed,
 (SELECT round(max(gap_seconds)::numeric,3) FROM gaps) AS max_inter_run_gap_seconds,
 (SELECT round(percentile_cont(0.95) within group (
    order by duration_seconds)::numeric,3)
    FROM runs WHERE status='succeeded') AS cron_runtime_p95_seconds,
 (SELECT count(*) FROM runs WHERE end_time IS NULL) AS missing_end_times,
 (SELECT now() AT TIME ZONE 'UTC') AS checked_at_utc
FROM cycle_status;
