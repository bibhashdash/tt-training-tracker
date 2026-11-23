-- Row level security: every row belongs to exactly one user. See docs/SPEC.md §2.8.

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'plan_weeks', 'planned_sessions', 'week_plans',
    'session_logs', 'daily_logs', 'weekly_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;
