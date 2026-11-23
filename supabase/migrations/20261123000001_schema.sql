-- Selby TT Tracker: core schema. See docs/SPEC.md §2.

create type public.plan_week_type as enum ('habits', 'build', 'easy', 'minimum');
create type public.session_kind as enum ('ride', 'core');
create type public.session_status as enum ('done', 'dropped', 'planned_off');
create type public.slot_used as enum ('primary', 'backup', 'other');
create type public.bike as enum ('turbo_road', 'road_outdoor', 'tt_outdoor');
create type public.illness as enum ('none', 'above_neck', 'below_neck');
create type public.suggestion as enum (
  'advance', 'repeat', 'minimum', 'repeat_after_illness', 'step_back', 'rest_injury'
);
create type public.review_decision as enum ('accepted', 'overridden');
create type public.week_variant as enum ('normal', 'minimum', 'easy_return', 'rest');
create type public.week_plan_source as enum ('seed', 'review');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- settings: one row per user -------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sleep_threshold_hours numeric(3, 1) not null default 6.5 check (sleep_threshold_hours between 0 and 16),
  sleep_flag_nights smallint not null default 3 check (sleep_flag_nights between 1 and 7),
  diet_flag_days smallint not null default 2 check (diet_flag_days between 1 and 7),
  completion_advance_pct smallint not null default 75 check (completion_advance_pct between 0 and 100),
  completion_minimum_pct smallint not null default 60 check (completion_minimum_pct between 0 and 100),
  cutoff_time time not null default '19:00',
  timezone text not null default 'Europe/London',
  block_start_date date not null default '2026-11-23' check (extract(isodow from block_start_date) = 1),
  review_opens_time time not null default '18:00', -- on Sundays
  planned_off_dates date[] not null default '{2026-12-25}',
  check (completion_minimum_pct <= completion_advance_pct)
);

-- plan_weeks: the template weeks (0 = minimum template) ----------------------
create table public.plan_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  plan_week int not null check (plan_week >= 0),
  block int not null check (block >= 0),
  type public.plan_week_type not null,
  target_minutes int not null default 0 check (target_minutes >= 0),
  notes text,
  unique (user_id, plan_week),
  unique (id, user_id) -- target for owner-matching composite FKs
);

-- planned_sessions: what each plan week contains -----------------------------
create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  plan_week_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO, Mon = 1
  kind public.session_kind not null,
  target_minutes int not null check (target_minutes > 0),
  max_minutes int check (max_minutes > 0),                -- null = no limit
  backup_max_minutes int check (backup_max_minutes > 0),  -- null = same as max_minutes
  zone text,
  is_key boolean not null default false,
  primary_slot time not null,
  backup_slot time,
  description text,
  foreign key (plan_week_id, user_id) references public.plan_weeks (id, user_id) on delete cascade,
  unique (plan_week_id, weekday, kind),
  unique (id, user_id),
  check (max_minutes is null or target_minutes <= max_minutes)
);

-- weekly_reviews -------------------------------------------------------------
create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  week_start date not null check (extract(isodow from week_start) = 1),
  plan_week int not null,
  sessions_planned int not null check (sessions_planned >= 0),
  sessions_done int not null check (sessions_done >= 0),
  completion_pct smallint not null check (completion_pct between 0 and 100),
  flag_sessions boolean not null,
  flag_sleep boolean not null,
  flag_diet boolean not null,
  flags_count smallint not null check (flags_count between 0 and 3),
  suggestion public.suggestion not null,
  reasons jsonb not null default '[]'::jsonb,
  decision public.review_decision not null,
  decision_value public.suggestion not null,
  decision_plan_week int check (decision_plan_week >= 1),
  decision_note text,
  unique (user_id, week_start),
  unique (id, user_id),
  check (decision <> 'overridden' or length(trim(coalesce(decision_note, ''))) > 0)
);

-- week_plans: which plan week runs in which calendar week --------------------
create table public.week_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  week_start date not null check (extract(isodow from week_start) = 1),
  pointer int not null check (pointer >= 1),
  plan_week_id uuid,
  variant public.week_variant not null,
  source public.week_plan_source not null,
  review_id uuid,
  pending_after int check (pending_after >= 1),
  unique (user_id, week_start),
  foreign key (plan_week_id, user_id) references public.plan_weeks (id, user_id),
  foreign key (review_id, user_id) references public.weekly_reviews (id, user_id),
  check ((variant = 'rest') = (plan_week_id is null))
);

-- session_logs ---------------------------------------------------------------
create table public.session_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date not null,
  planned_session_id uuid, -- null = unplanned ride
  status public.session_status not null,
  slot_used public.slot_used,
  actual_minutes int check (actual_minutes > 0),
  avg_hr smallint check (avg_hr between 40 and 230),
  rpe smallint check (rpe between 1 and 10),
  bike public.bike,
  notes text,
  foreign key (planned_session_id, user_id) references public.planned_sessions (id, user_id),
  check (planned_session_id is not null or status = 'done'),
  check ((status = 'done') = (actual_minutes is not null)),
  check (status <> 'done' or slot_used is not null)
);
create unique index session_logs_one_per_planned_day
  on public.session_logs (user_id, planned_session_id, date)
  where planned_session_id is not null;
create index session_logs_user_date on public.session_logs (user_id, date);

-- "Dropped, never moved": a planned session can only be logged on its own weekday.
create function public.session_logs_weekday_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  planned_weekday smallint;
begin
  if new.planned_session_id is null then
    return new;
  end if;
  select weekday into planned_weekday
  from public.planned_sessions where id = new.planned_session_id;
  if planned_weekday is distinct from extract(isodow from new.date)::smallint then
    raise exception 'Session can only be logged on its planned weekday (%), not %',
      planned_weekday, new.date
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger session_logs_weekday_guard
  before insert or update of date, planned_session_id on public.session_logs
  for each row execute function public.session_logs_weekday_guard();

-- daily_logs -----------------------------------------------------------------
create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date not null,
  sleep_hours numeric(3, 1) check (sleep_hours between 0 and 16), -- night ending on the morning of `date`
  bedtime time,
  diet_ok boolean,
  unplanned_drink_or_treat boolean not null default false,
  planned_indulgence boolean not null default false,
  illness public.illness not null default 'none',
  injury_note text,
  energy smallint check (energy between 1 and 5),
  unique (user_id, date)
);

-- updated_at triggers --------------------------------------------------------
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
create trigger session_logs_updated_at before update on public.session_logs
  for each row execute function public.set_updated_at();
create trigger daily_logs_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();
