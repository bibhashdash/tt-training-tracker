-- Smart trainer on real rides: the rider's FTP and threshold heart rate (zones
-- are worked out from them), and average power and cadence on session logs.
-- Additive only: existing rows get the defaults / nulls.

alter table public.settings
  add column ftp smallint not null default 160 check (ftp between 50 and 600),
  add column threshold_hr smallint not null default 172 check (threshold_hr between 100 and 220);

alter table public.session_logs
  add column avg_power smallint check (avg_power between 0 and 2000),
  add column avg_cadence smallint check (avg_cadence between 0 and 250),
  add constraint session_logs_power_only_when_done
    check (status = 'done' or (avg_power is null and avg_cadence is null));
