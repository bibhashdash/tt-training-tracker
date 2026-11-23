-- Seeds settings, Block 1 (plan weeks 1-6), the minimum template (plan week 0)
-- and the first week_plans row for the calling user. Idempotent: returns false
-- and does nothing if the user already has plan weeks. See docs/SPEC.md §3.

create function public.seed_block_1() returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  start_date date;
begin
  if uid is null then
    raise exception 'seed_block_1: not authenticated';
  end if;

  if exists (select 1 from public.plan_weeks where user_id = uid) then
    return false;
  end if;

  insert into public.settings (user_id) values (uid)
  on conflict (user_id) do nothing;

  insert into public.plan_weeks (user_id, plan_week, block, type, notes) values
    (uid, 0, 0, 'minimum', 'Minimum week: keep the habit going, easy riding only.'),
    (uid, 1, 1, 'habits',  'Habits: build the routine. Easy riding only.'),
    (uid, 2, 1, 'build',   'Build: first Sunday ride, all Z2.'),
    (uid, 3, 1, 'easy',    'Easy week: absorb the work.'),
    (uid, 4, 1, 'build',   'Build: first Z3 intervals on Monday.'),
    (uid, 5, 1, 'build',   'Build: longer Z3 intervals, Thursday ride added.'),
    (uid, 6, 1, 'easy',    'Easy week to close the block.');

  -- Weekly slot rules (ceilings, not targets).
  with slots (weekday, max_minutes, backup_max_minutes, primary_slot, backup_slot) as (
    values
      (1, 45,        45,  time '07:00', time '17:00'),
      (2, 45,        45,  time '07:00', time '18:00'),
      (3, 30,        30,  time '07:00', time '12:30'),
      (4, 60,        30,  time '18:00', time '12:30'),
      (5, 30,        30,  time '07:00', time '12:30'),
      (6, 90,        90,  time '15:00', time '19:00'),
      (7, null::int, 120, time '07:00', time '15:00')
  ),
  rides (plan_week, weekday, target_minutes, zone, is_key, description) as (
    values
      (0, 1, 30, 'Z1-2', false, 'Easy spin'),
      (0, 3, 30, 'Z1-2', false, 'Easy spin'),
      (0, 6, 45, 'Z1-2', false, 'Easy ride'),

      (1, 1, 45, 'Z1-2', false, 'Easy ride'),
      (1, 3, 30, 'Z1-2', false, 'Easy spin'),
      (1, 6, 60, 'Z1-2', false, 'Easy ride'),

      (2, 1, 45, 'Z2',   false, 'Steady Z2'),
      (2, 3, 30, 'Z2',   false, 'Steady Z2'),
      (2, 6, 60, 'Z2',   false, 'Steady Z2'),
      (2, 7, 45, 'Z2',   false, 'Steady Z2. No limit outdoors, 2h cap on the turbo'),

      (3, 1, 45, 'Z1-2', false, 'Easy ride'),
      (3, 3, 30, 'Z1-2', false, 'Easy spin'),
      (3, 6, 60, 'Z1-2', false, 'Easy ride'),

      (4, 1, 45, 'Z3',   true,  '2 x 8 min Z3, rest easy'),
      (4, 3, 30, 'Z1-2', false, 'Easy spin'),
      (4, 6, 60, 'Z1-2', false, 'Easy ride'),
      (4, 7, 75, 'Z2',   false, 'Steady Z2. No limit outdoors, 2h cap on the turbo'),

      (5, 1, 45, 'Z3',   true,  '2 x 10 min Z3, rest easy'),
      (5, 3, 30, 'Z1-2', false, 'Easy spin'),
      (5, 4, 45, 'Z2',   false, 'Steady Z2 (backup slot capped at 30 min)'),
      (5, 6, 60, 'Z1-2', false, 'Easy ride'),
      (5, 7, 60, 'Z2',   false, 'Steady Z2. No limit outdoors, 2h cap on the turbo'),

      (6, 1, 45, 'Z1-2', false, 'Easy ride'),
      (6, 3, 30, 'Z1-2', false, 'Easy spin'),
      (6, 5, 30, 'Z1-2', false, 'Easy spin'),
      (6, 6, 45, 'Z1-2', false, 'Easy ride')
  )
  insert into public.planned_sessions (
    user_id, plan_week_id, weekday, kind, target_minutes, max_minutes,
    backup_max_minutes, zone, is_key, primary_slot, backup_slot, description
  )
  select uid, pw.id, r.weekday, 'ride', r.target_minutes, s.max_minutes,
         s.backup_max_minutes, r.zone, r.is_key, s.primary_slot, s.backup_slot, r.description
  from rides r
  join slots s using (weekday)
  join public.plan_weeks pw on pw.user_id = uid and pw.plan_week = r.plan_week;

  -- Core and mobility: 15 min, Mon and Wed, plan weeks 2-6.
  insert into public.planned_sessions (
    user_id, plan_week_id, weekday, kind, target_minutes, max_minutes,
    backup_max_minutes, zone, is_key, primary_slot, backup_slot, description
  )
  select uid, pw.id, d.weekday, 'core', 15, 15, 15, null, false,
         time '12:30', time '20:00', 'Core and mobility'
  from public.plan_weeks pw
  cross join (values (1), (3)) as d (weekday)
  where pw.user_id = uid and pw.plan_week between 2 and 6;

  update public.plan_weeks pw
  set target_minutes = coalesce((
    select sum(ps.target_minutes) from public.planned_sessions ps
    where ps.plan_week_id = pw.id and ps.kind = 'ride'
  ), 0)
  where pw.user_id = uid;

  select block_start_date into start_date from public.settings where user_id = uid;

  insert into public.week_plans (user_id, week_start, pointer, plan_week_id, variant, source)
  select uid, start_date, 1, pw.id, 'normal', 'seed'
  from public.plan_weeks pw
  where pw.user_id = uid and pw.plan_week = 1;

  return true;
end;
$$;

revoke execute on function public.seed_block_1() from public, anon;
grant execute on function public.seed_block_1() to authenticated;
