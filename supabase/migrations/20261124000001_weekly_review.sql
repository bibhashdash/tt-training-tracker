-- Milestone 3: record a weekly review and schedule next week in one transaction,
-- and lock logs for weeks that have been reviewed. See docs/SPEC.md §4.3 and §5.4.

-- Records the review and creates the next week_plans row atomically.
-- The suggestion and next plan are computed by the app's rules engine
-- (lib/engine); this function only stores them, so it stays simple.
create function public.record_weekly_review(
  p_week_start date,
  p_plan_week int,
  p_sessions_planned int,
  p_sessions_done int,
  p_completion_pct smallint,
  p_flag_sessions boolean,
  p_flag_sleep boolean,
  p_flag_diet boolean,
  p_suggestion public.suggestion,
  p_reasons jsonb,
  p_decision public.review_decision,
  p_decision_value public.suggestion,
  p_decision_plan_week int,
  p_decision_note text,
  p_next_week_start date,
  p_next_pointer int,
  p_next_plan_week int,            -- null = rest week
  p_next_variant public.week_variant,
  p_next_pending_after int
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  review_id uuid;
  next_plan_week_id uuid;
begin
  if uid is null then
    raise exception 'record_weekly_review: not authenticated';
  end if;
  if not exists (select 1 from public.week_plans where user_id = uid and week_start = p_week_start) then
    raise exception 'No plan for the week of %', p_week_start;
  end if;
  if p_next_week_start <= p_week_start then
    raise exception 'Next week must come after the reviewed week';
  end if;

  if p_next_plan_week is not null then
    select id into next_plan_week_id
    from public.plan_weeks where user_id = uid and plan_week = p_next_plan_week;
    if next_plan_week_id is null then
      raise exception 'Plan week % does not exist', p_next_plan_week;
    end if;
  end if;

  insert into public.weekly_reviews (
    user_id, week_start, plan_week, sessions_planned, sessions_done, completion_pct,
    flag_sessions, flag_sleep, flag_diet, flags_count, suggestion, reasons,
    decision, decision_value, decision_plan_week, decision_note
  ) values (
    uid, p_week_start, p_plan_week, p_sessions_planned, p_sessions_done, p_completion_pct,
    p_flag_sessions, p_flag_sleep, p_flag_diet,
    (p_flag_sessions::int + p_flag_sleep::int + p_flag_diet::int)::smallint,
    p_suggestion, p_reasons, p_decision, p_decision_value, p_decision_plan_week,
    nullif(trim(p_decision_note), '')
  )
  returning id into review_id;

  insert into public.week_plans (
    user_id, week_start, pointer, plan_week_id, variant, source, review_id, pending_after
  ) values (
    uid, p_next_week_start, p_next_pointer, next_plan_week_id, p_next_variant, 'review', review_id,
    p_next_pending_after
  );

  return review_id;
end;
$$;

revoke execute on function public.record_weekly_review(
  date, int, int, int, smallint, boolean, boolean, boolean, public.suggestion, jsonb,
  public.review_decision, public.suggestion, int, text, date, int, int, public.week_variant, int
) from public, anon;
grant execute on function public.record_weekly_review(
  date, int, int, int, smallint, boolean, boolean, boolean, public.suggestion, jsonb,
  public.review_decision, public.suggestion, int, text, date, int, int, public.week_variant, int
) to authenticated;

-- Reviewed weeks are read-only: no log for a date in a reviewed week can be
-- added, changed or removed. date_trunc('week') is the ISO Monday.
create function public.reject_logs_in_reviewed_week() returns trigger
language plpgsql set search_path = '' as $$
declare
  row_user uuid := coalesce(new.user_id, old.user_id);
  dates date[] := array_remove(array[
    case when tg_op <> 'INSERT' then old.date end,
    case when tg_op <> 'DELETE' then new.date end
  ], null);
  d date;
begin
  -- Only the app's signed-in role is locked out; admin work and cascade
  -- deletes (e.g. removing the account) run as other roles and pass through.
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  foreach d in array dates loop
    if exists (
      select 1 from public.weekly_reviews r
      where r.user_id = row_user and r.week_start = date_trunc('week', d)::date
    ) then
      raise exception 'The week of % has been reviewed and is locked', date_trunc('week', d)::date
        using errcode = 'check_violation';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

create trigger session_logs_locked_after_review
  before insert or update or delete on public.session_logs
  for each row execute function public.reject_logs_in_reviewed_week();

create trigger daily_logs_locked_after_review
  before insert or update or delete on public.daily_logs
  for each row execute function public.reject_logs_in_reviewed_week();
