-- Block editor: save a whole training block in one transaction.
-- The app validates the block first (lib/blocks.ts); this function only
-- writes it, and protects history: a plan week that has already been
-- scheduled (referenced by week_plans) is never changed or deleted.

create function public.save_block(p_block int, p_weeks jsonb) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  w jsonb;
  wk int;
  pw_id uuid;
  pw_block int;
  kept int[] := '{}';
begin
  if uid is null then
    raise exception 'save_block: not authenticated';
  end if;
  if p_block < 1 then
    raise exception 'Block must be 1 or more';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' then
    raise exception 'Weeks must be an array';
  end if;

  for w in select value from jsonb_array_elements(p_weeks) loop
    wk := (w ->> 'plan_week')::int;
    if wk is null or wk < 1 then
      raise exception 'Bad plan week';
    end if;
    kept := kept || wk;

    pw_id := null;
    select id, block into pw_id, pw_block
    from public.plan_weeks where user_id = uid and plan_week = wk;

    if pw_id is not null then
      if pw_block <> p_block then
        raise exception 'Plan week % belongs to block %', wk, pw_block;
      end if;
      -- Already scheduled: leave it exactly as it was.
      if exists (select 1 from public.week_plans where plan_week_id = pw_id) then
        continue;
      end if;
      update public.plan_weeks
      set type = (w ->> 'type')::public.plan_week_type, notes = nullif(trim(w ->> 'notes'), '')
      where id = pw_id;
      delete from public.planned_sessions where plan_week_id = pw_id;
    else
      insert into public.plan_weeks (user_id, plan_week, block, type, notes)
      values (uid, wk, p_block, (w ->> 'type')::public.plan_week_type, nullif(trim(w ->> 'notes'), ''))
      returning id into pw_id;
    end if;

    insert into public.planned_sessions (
      user_id, plan_week_id, weekday, kind, target_minutes, max_minutes, backup_max_minutes,
      zone, is_key, primary_slot, backup_slot, description
    )
    select
      uid, pw_id,
      (s ->> 'weekday')::smallint,
      (s ->> 'kind')::public.session_kind,
      (s ->> 'target_minutes')::int,
      (s ->> 'max_minutes')::int,
      (s ->> 'backup_max_minutes')::int,
      nullif(trim(s ->> 'zone'), ''),
      coalesce((s ->> 'is_key')::boolean, false),
      (s ->> 'primary_slot')::time,
      (s ->> 'backup_slot')::time,
      nullif(trim(s ->> 'description'), '')
    from jsonb_array_elements(coalesce(w -> 'sessions', '[]'::jsonb)) as s;

    update public.plan_weeks pw
    set target_minutes = coalesce((
      select sum(ps.target_minutes) from public.planned_sessions ps
      where ps.plan_week_id = pw.id and ps.kind = 'ride'
    ), 0)
    where pw.id = pw_id;
  end loop;

  -- Weeks of this block that were left out are removed, unless already scheduled.
  if exists (
    select 1 from public.plan_weeks pw
    where pw.user_id = uid and pw.block = p_block and not (pw.plan_week = any (kept))
      and exists (select 1 from public.week_plans wp where wp.plan_week_id = pw.id)
  ) then
    raise exception 'A week that has already been scheduled can''t be removed';
  end if;
  delete from public.plan_weeks
  where user_id = uid and block = p_block and not (plan_week = any (kept));
end;
$$;

revoke execute on function public.save_block(int, jsonb) from public, anon;
grant execute on function public.save_block(int, jsonb) to authenticated;
