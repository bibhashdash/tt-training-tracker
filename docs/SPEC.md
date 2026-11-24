# Selby TT Tracker: implementation spec

Detailed build spec, expanded from the original brief (`selby-tt-tracker-spec.md`). Where the brief was silent or ambiguous, this doc makes a call and marks it **[DEFAULT]**. Calls confirmed by the rider on 23 Nov 2026 are marked **[DECIDED]** and listed in §7.

Single user, mobile-first. Every daily interaction should take under 30 seconds.

---

## 1. Stack and project layout

| Concern | Choice |
| --- | --- |
| Framework | Latest stable Next.js, App Router, TypeScript strict, React Server Components by default |
| Styling | Tailwind CSS. No component library; a few hand-rolled primitives (Button, Segmented, Stepper, Card) |
| Data | Supabase Postgres, `@supabase/ssr` for cookie-based auth in server components and actions |
| Auth | Google sign-in via Supabase OAuth, locked to `ALLOWED_EMAIL`. Public sign-ups disabled once the account exists. (Replaced email magic links: custom email templates need SMTP.) |
| Writes | Server actions only, using `revalidatePath`. No client state library |
| Rules | Pure TypeScript in `lib/engine/`, with no I/O, no `Date.now()` and no Supabase imports. Tested with Vitest |
| Time zone | Europe/London. All "today" and week-boundary logic goes through `lib/dates.ts` **[DEFAULT]** |
| Hosting | Vercel (free tier) plus Supabase cloud (free tier) **[DECIDED]** |
| PWA | Milestone 4: manifest and icons (`scripts/generate-icons.mjs`). No service worker: browsers offer install without one, and a caching worker risks showing stale pages after sign-out **[DECIDED in M4]** |

```
app/
  login/page.tsx                 "Continue with Google"
  auth/confirm/route.ts          exchanges the OAuth ?code= for a session, enforces ALLOWED_EMAIL
  (app)/layout.tsx               auth guard + bottom tab bar (Today · Log · Week · Settings)
  (app)/today/page.tsx
  (app)/log/[date]/page.tsx      daily log (defaults to today)
  (app)/week/[weekStart]/page.tsx
  (app)/review/[weekStart]/page.tsx
  (app)/settings/page.tsx
  actions/*.ts                   server actions grouped by table
lib/
  supabase/{server,client,middleware}.ts
  dates.ts                       london today, weekStart(d), calendarWeek(d), weekday(d)
  queries.ts                     typed read helpers
  engine/
    types.ts
    suggest.ts                   suggestNextWeek()
    decide.ts                    applyDecision()
    suggest.test.ts
    decide.test.ts
supabase/
  migrations/20261123000001_schema.sql
  migrations/20261123000002_rls.sql
  migrations/20261123000003_seed_block_1.sql
proxy.ts                         refreshes the Supabase session (Next 16 renamed middleware to proxy)
tests/db/migrations.test.ts      runs the migrations in PGlite: seed, RLS, weekday guard
```

---

## 2. Data model

All tables have `id uuid pk default gen_random_uuid()`, `user_id uuid not null default auth.uid() references auth.users`, and `created_at timestamptz default now()`. Mutable tables also get `updated_at`.

### Changes from the brief
1. **New table `week_plans`.** The brief has no record of which plan week is scheduled in a given calendar week, and the Today screen can't work without one. This table stores it, along with the progression pointer.
2. **`planned_sessions.backup_max_minutes`.** The backup slot sometimes has a lower cap than the primary: Thu backup is limited to 30 minutes and Sun backup to 120.
3. **A `minimum` template week** stored as a `plan_weeks` row (`plan_week = 0`, `type = 'minimum'`) so a minimum week can be scheduled like any other week.
4. **`settings` gains** `timezone`, `block_start_date`, `review_opens_time`, `planned_off_dates`.
5. **`planned_off` is decided by date, not by plan week.** Christmas Day stays 25 Dec even if the plan slips (see §2.7).

### 2.1 `plan_weeks`
| col | type | notes |
| --- | --- | --- |
| plan_week | int | 1..6 for Block 1, 0 = minimum template. Unique per `(user_id, plan_week)` |
| block | int | 1 (0 for template) |
| type | enum `habits\|build\|easy\|minimum` | |
| target_minutes | int | sum of ride targets, denormalised for display |
| notes | text | |

### 2.2 `planned_sessions`
| col | type | notes |
| --- | --- | --- |
| plan_week_id | uuid fk | cascade delete |
| weekday | smallint 1..7 | ISO, Mon=1 |
| kind | enum `ride\|core` | |
| target_minutes | int | |
| max_minutes | int null | primary-slot ceiling. Null = no limit (Sun outdoor) |
| backup_max_minutes | int null | null = same as `max_minutes` |
| zone | text | `Z1-2`, `Z2`, `Z3` … |
| is_key | bool | key/hard session: subject to `cutoff_time` |
| primary_slot | time | |
| backup_slot | time | |
| description | text | e.g. `2 x 8 min Z3, rest easy` |

### 2.3 `week_plans` (new)
One row per calendar week the app has scheduled.

| col | type | notes |
| --- | --- | --- |
| week_start | date | Monday. Unique per `(user_id, week_start)` |
| pointer | int | progression pointer (`plan_week`) *after* the previous review. Stays unchanged through minimum and illness weeks |
| plan_week_id | uuid fk null | the week actually scheduled. Can be the minimum template. Null = rest week (injury) |
| variant | enum `normal\|minimum\|easy_return\|rest` | |
| source | enum `seed\|review` | |
| review_id | uuid null | the weekly review that produced it |
| pending_after | int null | for `repeat_after_illness`: the plan week to schedule after this easy week |

Gap shown in UI = `calendarWeek(week_start) − pointer`, where `calendarWeek` counts weeks since `block_start_date` (week 1 = 23 Nov 2026).

### 2.4 `session_logs`
As in the brief, plus:
- Unique `(user_id, planned_session_id, date)` where `planned_session_id` is not null.
- A check that `date`'s ISO weekday equals the planned session's `weekday`, enforced in the server action. This is how "dropped, never moved" is enforced: a session can only be logged on its own day.
- `actual_minutes` is required when status is `done`, and null otherwise.
- `bike` defaults to `turbo_road` on weekdays and `road_outdoor` at weekends. `tt_outdoor` only makes sense outdoors, so it isn't offered when the session is logged as turbo.

### 2.5 `daily_logs`
As in the brief, unique `(user_id, date)`.
- **`sleep_hours` on date D means the night ending on the morning of D**, so you log on waking **[DEFAULT]**.
- `planned_indulgence` defaults to true on Fridays.
- Defaults that keep it to five taps: diet_ok = true, treat = false, illness = none.

### 2.6 `weekly_reviews`
As in the brief. Extra details:
- `reasons` jsonb: `[{ code: string, text: string }]` (plain English, shown verbatim).
- `decision_value`: the suggestion enum actually chosen. If the override picks a specific week, also store `decision_plan_week int`.
- Unique `(user_id, week_start)`.

### 2.7 `settings` (one row)
| col | default |
| --- | --- |
| sleep_threshold_hours | 6.5 **[DECIDED]** |
| sleep_flag_nights | 3 **[DECIDED]** |
| diet_flag_days | 2 **[DECIDED]** |
| completion_advance_pct | **75** (brief said 80) **[DECIDED]** |
| completion_minimum_pct | 60 |
| cutoff_time | 19:00 **[DECIDED]** |
| timezone | Europe/London |
| block_start_date | 2026-11-23 |
| review_opens_time | 18:00 (on Sundays) |
| planned_off_dates | `date[]`, seeded with `{2026-12-25}` |

Any planned session that falls on a date in `planned_off_dates` is shown as planned off and excluded by the engine. No log row is written (opening a page has no side effects) **[DECIDED in M2]**. This applies whichever plan week is running, so it still works if the plan has slipped.

### 2.8 RLS
Every table: `enable row level security`, plus a single policy `for all using (user_id = auth.uid()) with check (user_id = auth.uid())`. `planned_sessions` gets the same, carrying its own `user_id`, so no joins are needed in policies.

### 2.9 Seeding
`seed_block_1()` is a SQL function, `security invoker`. It inserts for `auth.uid()`:
settings, plan weeks 0–6, their planned sessions, and `week_plans(2026-11-23, pointer 1, plan week 1, normal, seed)`.
It is idempotent: it does nothing if `plan_weeks` already has rows. A server action on first authenticated load calls it.

---

## 3. Seed data, Block 1

### Slot rules per weekday
| Day | max | backup_max | Primary | Backup |
| --- | --- | --- | --- | --- |
| Mon (1) | 45 | 45 | 07:00 | 17:00 |
| Tue (2) | 45 | 45 | 07:00 | 18:00 |
| Wed (3) | 30 | 30 | 07:00 | 12:30 |
| Thu (4) | 60 | 30 | 18:00 | 12:30 |
| Fri (5) | 30 | 30 | 07:00 | 12:30 |
| Sat (6) | 90 | 90 | 15:00 | 19:00 |
| Sun (7) | null (2h if turbo) | 120 | 07:00 | 15:00 |

Core: kind `core`, 15 minutes, Mon and Wed of **plan weeks 2–6**, primary 12:30, backup 20:00. These are plan weeks, not calendar weeks **[DEFAULT]**.

### Rides per plan week
| PW | type | Mon | Wed | Thu | Fri | Sat | Sun |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | habits | 45 Z1-2 | 30 Z1-2 | | | 60 Z1-2 | |
| 2 | build | 45 Z2 | 30 Z2 | | | 60 Z2 | 45 Z2 |
| 3 | easy | 45 Z1-2 | 30 Z1-2 | | | 60 Z1-2 | |
| 4 | build | 45 Z3 ★ (2×8 Z3) | 30 Z1-2 | | | 60 Z1-2 | 75 Z2 |
| 5 | build | 45 Z3 ★ (2×10 Z3) | 30 Z1-2 | 45 Z2 | | 60 Z1-2 | 60 Z2 |
| 6 | easy | 45 Z1-2 | 30 Z1-2 | | 30 Z1-2 | 45 Z1-2 | |
| 0 | minimum | 30 Z1-2 | 30 Z1-2 | | | 45 Z1-2 | |

★ = `is_key`. Only the Z3 interval sessions are key **[DECIDED]**. The minimum template is Mon 30, Wed 30, Sat 45, all Z1-2, no core **[DECIDED]**.

Note: plan week 5's Friday has no session, so the 25 Dec `planned_off` changes nothing if the plan runs on schedule. It only matters if a week with a Friday ride (week 6) lands on Christmas week.

### HR zones (display only, threshold ≈172)
Z1 < 139 · Z2 139–154 · Z3 155–161 · Z4 162–171 · Z5 ≥ 172.
The brief left gaps at 154, 161 and 171. Here each gap is closed by extending the lower zone **[DEFAULT]**. Rules ignore HR. The UI shows a small zone badge next to logged avg HR, and an amber badge if it's above the target zone.

---

## 4. Rules engine

Pure functions in `lib/engine`. No dates are computed inside them; the caller passes ISO date strings.

### 4.1 Types
```ts
type Weekday = 1|2|3|4|5|6|7;
type Illness = 'none'|'above_neck'|'below_neck';

interface EngineSettings {
  sleepThresholdHours: number; sleepFlagNights: number; dietFlagDays: number;
  completionAdvancePct: number; completionMinimumPct: number;
}
interface PlannedSessionIn { id: string; date: string; kind: 'ride'|'core'; isKey: boolean; plannedOff: boolean; }
interface SessionLogIn { plannedSessionId: string|null; date: string; status: 'done'|'dropped'|'planned_off'; }
interface DailyLogIn {
  date: string; sleepHours: number|null; dietOk: boolean|null;
  unplannedTreat: boolean; plannedIndulgence: boolean; illness: Illness; injuryNote: string|null;
}
interface WeekInput {
  weekStart: string;                 // Monday
  pointer: number;                   // current plan_week pointer
  planned: PlannedSessionIn[];       // this week's planned sessions, dates resolved
  sessionLogs: SessionLogIn[];       // this week only
  dailyLogs: DailyLogIn[];           // this week + the 6 days before (for illness streak)
  settings: EngineSettings;
}
type Suggestion = 'advance'|'repeat'|'minimum'|'repeat_after_illness'|'step_back'|'rest_injury';
interface Reason { code: string; text: string; }
interface SuggestOut {
  suggestion: Suggestion; reasons: Reason[];
  stats: { sessionsPlanned: number; sessionsDone: number; completionPct: number;
           shortSleepNights: number; offPlanDays: number; illnessDays: number; };
  flags: { sessions: boolean; sleep: boolean; diet: boolean; count: number };
}
```

### 4.2 `suggestNextWeek(input): SuggestOut`

**Step 1: exclusions.** These never count as skips or warning signs:
- Sessions with `plannedOff` or a `planned_off` log are removed from the denominator.
- Illness days: any date with `illness ≠ none`. Sessions on illness days are removed from the denominator, **unless done**, in which case they count as planned and done **[DEFAULT]**. Illness days are also excluded from the sleep and diet counts.
- Planned indulgence on day D excludes D from the diet count and **excludes D+1's sleep** (the Friday-night pub → Saturday morning sleep) **[DEFAULT]**.

**Step 2: stats.**
- Completion counts **rides only**, by session count. Core is shown separately and doesn't affect the suggestion **[DECIDED]**.
- Unlogged past sessions count as not done, and there are no "pending" states at review time.
- If `sessionsPlanned` = 0 after exclusions, `completionPct` = 100. This can't on its own cause a sessions flag.
- `completionPct = round(done / planned × 100)`.
- Short-sleep night: `sleepHours` not null and `< threshold`. Missing logs are ignored, not penalised.
- Off-plan day: `dietOk === false || unplannedTreat`, and not excluded.
- Illness days: the length of the longest consecutive illness run that includes at least one day of this week, counting back into the previous 6 days. Without this, a 7-day illness spanning Thursday to Wednesday would never trigger `step_back` **[DEFAULT]**.

**Step 3: flags.**
- `sessions = completionPct < completionAdvancePct`
- `sleep = shortSleepNights >= sleepFlagNights`
- `diet = offPlanDays >= dietFlagDays`

**Step 4: precedence (first match wins).**
1. Any non-empty `injuryNote` in the week → `rest_injury`. Reason text: "Injury noted on {day}. Rest and see a GP before riding again." No plan suggestion follows.
2. `illnessDays >= 7` → `step_back`
3. `illnessDays >= 3` → `repeat_after_illness`
3a. No rides left to count (rest week, or every ride planned off) → `repeat`. Without this, 0 of 0 would read as 100% and advance **[DECIDED in M3]**
4. `flags.count >= 2 || completionPct < completionMinimumPct` → `minimum`
5. `completionPct >= completionAdvancePct` → `advance`
6. else → `repeat`

Each rule that fires, and each flag that's set, adds a `Reason`, e.g. `{code:'completion', text:'2 of 3 rides done (67%). 75% needed to move on.'}`. Excluded items also get a reason, so the rider can see they weren't held against them, e.g. "Fri 25 Dec planned off, not counted."

### 4.3 `applyDecision(current: WeekPlanState, value: Suggestion | {planWeek:number}, maxPlanWeek): NextWeekPlan`
Also pure. It turns the accepted or overridden decision into next week's `week_plans` row:

| value | next pointer | scheduled week | variant |
| --- | --- | --- | --- |
| advance | min(pointer+1, max) | pointer+1 | normal |
| repeat | pointer | pointer | normal |
| minimum | pointer | template 0 | minimum |
| repeat_after_illness | pointer | template 0, `pending_after = pointer` | easy_return |
| step_back | max(pointer−1, 1) | pointer−1 | normal |
| rest_injury | pointer | none | rest |
| `{planWeek: n}` (override) | n | n | normal |

If the current week has `pending_after` set (it was an easy-return week) and it reviews as `advance` or `repeat`, the next week schedules `pending_after`, which is the interrupted plan week redone, with the pointer unchanged. Other outcomes apply as normal **[DECIDED]**.

More generally, after any week on hold (minimum, easy return or rest), `advance` and `repeat` both return to the held plan week (`Back to plan week N`) rather than skipping past it, because the pointer never moved during the hold **[DECIDED in M3]**.

The DB function `record_weekly_review` stores the review and creates next week's `week_plans` row in one transaction. Next week normally starts the Monday after the reviewed week; if the review is late, it starts the current Monday instead, and the missed weeks show only as calendar-vs-plan gap **[DECIDED in M3]**.

At the end of the block, `advance` from week 6 has nowhere to go. The review says "Block 1 complete: add Block 2" and the options become repeat week 6, or minimum **[DEFAULT]**.

### 4.4 Plan rules the engine can't enforce: where each one lives
| Rule | Enforcement |
| --- | --- |
| A skipped session is dropped, never moved | Logs are only allowed on the session's own weekday (§2.4). There's no "move" or "reschedule" control. A past unlogged session shows as missed, read-only. |
| No stacking / no catch-up | Unplanned rides (`planned_session_id` null) never count toward completion. Today never shows another day's session. |
| Hard sessions finish before `cutoff_time` | On Today, an `is_key` session whose slot start + target minutes ends after the cutoff shows "Too late for this one: drop it", with Dropped as the only primary action. Done stays reachable under "log anyway" so data is never lost. |

### 4.5 Unit tests (Vitest), minimum set
- advance: 3/3 rides done, no flags
- advance: 3/4 (75%), exactly at the threshold
- repeat: 2/3 (67%), with the thresholds at 75/60
- minimum: 1/3 (33%)
- minimum: 100% completion but sleep and diet flags both set
- one flag only + 85% completion → advance (one flag alone doesn't block)
- planned_off on 25 Dec removed from denominator
- Friday indulgence: Friday diet and Saturday sleep not counted
- above_neck illness on 2 days, sessions on those days excluded → completion computed on the rest
- illness 3 days → repeat_after_illness; 7 days spanning the week boundary → step_back
- injury overrides everything, including illness ≥ 7
- missing daily logs don't create flags
- unplanned ride doesn't count
- applyDecision for each row of the table in 4.3, end of block, and the `pending_after` path

---

## 5. Screens

Bottom tab bar: **Today · Log · Week · Settings**. Review is reached from a banner. Single-column layout, thumb-reachable buttons, minimum tap target 44px.

### 5.1 Today (`/today`)
- Header: date, "Calendar wk 3 · Plan wk 2 (1 behind)", and the variant chip (minimum / easy return / rest).
- **Review banner** (blocking) if last week has no decision and it's Monday or later: "Review last week first". Today's sessions show once the review is decided, since next week's plan depends on it. From Sunday 18:00 the banner is non-blocking.
- One card per planned item (ride, then core):
  `Mon · 45 min · Z1-2 · 07:00 (backup 17:00)` plus a description line.
  Buttons: **Done · Used backup · Dropped**.
  - Done / Used backup expands inline: minutes (prefilled with target, stepper ±5, capped at that slot's max with a warning), avg HR (number pad, optional), bike (segmented, preset), RPE (optional, collapsed). Save. That's three taps when you accept the defaults.
  - Dropped: one tap, then undo toast.
- A logged card collapses to a summary and can be tapped to edit (today only).
- Rest day: "Rest day" and a link to the daily log.
- Footer: "+ Unplanned ride" (minutes, HR, bike, notes).
- Daily log nudge if today's daily log is missing.

### 5.2 Daily log (`/log/[date]`)
Target is five taps or fewer:
1. Sleep: a row of chips `5 · 5.5 · 6 · 6.5 · 7 · 7.5 · 8 · 8.5+` (one tap)
2. Diet OK: toggle, default on
3. Unplanned treat/drink: toggle, default off
4. Planned indulgence: toggle, default on for Fridays
5. Illness: segmented `None · Above neck · Below neck`

Below that: "Injury?" link, which opens a text field; optional energy 1–5 ("Energy today"). Bedtime was dropped after M4: nothing read it. The nullable `daily_logs.bedtime` column is left in place, unused. Autosaves on each change (server action, debounced). A date switcher lets you go back through the current and previous week, so the days before the app existed can be backfilled.

### 5.3 Week view (`/week/[weekStart]`)
- Mon–Sun list showing planned versus done per day with status icons, and minutes planned versus done.
- Live engine output for the week so far: completion %, sleep and diet counts against their thresholds, flags lit or unlit, and the "if the week ended now" suggestion in muted text.
- Plan week versus calendar week, with the gap described neutrally ("1 week behind schedule").
- Prev/next week arrows.

### 5.4 Weekly review (`/review/[weekStart]`)
- The suggestion as a headline in plain English ("Move on to plan week 3"), the reasons as a bullet list, then a stats strip.
- **Accept** writes the review with `decision = accepted` and creates next week's `week_plans` row.
- **Override** opens a picker (advance / repeat / minimum / step back / rest / specific plan week) plus a required one-line note, then saves the same way.
- `rest_injury` has no Accept-to-plan. It shows the GP message, then "Mark week as rest".
- Reviews are read-only once decided, and past reviews are reachable from Week view.
- Deciding locks that week's session and daily logs. A DB trigger rejects any insert, update or delete in a reviewed week for the app's signed-in role.

### 5.5 Settings (`/settings`)
Number inputs for every threshold in §2.7, the cutoff time, and the planned-off dates list. Sign out.

---

## 6. Milestones and acceptance

**M1: Foundations**
- `create-next-app`, Tailwind, Vitest, ESLint. Git initialised.
- Migrations 1–3 applied, RLS verified (a second test user can't read rows).
- Google login works. First load seeds Block 1. `.env.local.example` committed.
- *Done when:* signing in shows a placeholder Today with plan week 1 sessions read from the DB.

**M2: Today + Daily log**
- Everything in §5.1 and §5.2, with the weekday guard and cutoff behaviour.
- *Done when:* a full week can be logged on a phone-width viewport, each session in three taps or fewer.

**M3: Engine + Weekly review**
- `lib/engine` with all §4.5 tests passing; review screen; `week_plans` rollover.
- *Done when:* the tests are green, and a seeded test week produces the expected suggestion and next-week row for each path.

**M4: Week view, PWA, polish**
- Week view, manifest + icons + service worker, a loading skeleton for each screen, dark mode.
- *Done when:* installable from Safari/Chrome on the phone, and Lighthouse PWA checks pass.

---

## 7. Decisions (confirmed 23 Nov 2026)

1. **Thresholds**: sleep flag at under 6.5 h on 3+ nights; diet flag at 2+ unplanned off-plan days.
2. **Completion**: counted by sessions, with `completion_advance_pct` lowered from 80 to **75**. A 4-ride week can absorb one drop; a 3-ride week still needs all three. 60–75% → `repeat`; under 60% → `minimum`.
3. **Minimum week**: Mon 30, Wed 30, Sat 45, all Z1-2, no core.
4. **Repeat after illness**: an easy return week (the minimum template), then the *interrupted* plan week is redone. The pointer doesn't move. Stepping back is only for illness of 7 days or more.
5. **Key sessions**: only the Z3 interval rides (Mon of plan weeks 4 and 5). Cutoff 19:00.
6. **Core**: tracked separately. It doesn't count toward completion.
7. **Hosting**: Vercel + Supabase cloud. The rider creates the Supabase project and puts its URL and anon key into `.env.local`.
8. **Weeks run Mon–Sun**: the seed dates confirm 23 Nov 2026 is a Monday.

## 8. Timing note
Block 1 starts **today (Mon 23 Nov 2026)**. Week 1 will be partly done before the app exists. The daily log and Today screens allow backfilling any day of the current week, so week 1's review can still run on Sun 29 Nov if M1–M3 land by then. Otherwise, run the week 1 review by hand and seed `week_plans` for week 2 directly.

## 9. Training blocks (added after M4)

Settings → Training blocks lists every block and opens an editor for each.

- **Plan week numbering runs on across blocks.** Block 2 starts at plan week 7. The engine's "last plan week" comes from the data, so `advance` from week 6 goes to week 7 once Block 2 exists, and "Block complete" only appears at the end of the last block.
- **Scheduled weeks are read-only.** A plan week referenced by any `week_plans` row keeps exactly the plan it was ridden against. The DB function `save_block` skips such weeks and refuses to delete them, whatever the client sends.
- **Only the last block can grow or shrink**, so plan week numbers stay contiguous. Earlier blocks can be edited week by week but keep their length.
- **Copy and progress:** a new block copies the last one and raises ride targets in build weeks by a chosen % (default 10), rounded to 5 min and capped at each slot's ceiling. Habits/easy weeks, core and slots are unchanged.
- **Checks** (`lib/blocks.ts`, run in the browser and again on the server): errors block saving (minutes 1-600, target within the slot ceiling, one ride and one core per day, valid times, contiguous weeks). Warnings never block: a key session that can't finish before the cutoff in its primary or backup slot, a week with no rides, and a build week more than 20% above the previous build week.
- The minimum template (plan week 0) isn't editable here yet.

## 10. Activity (live heart rate)

"Start activity" on today's ride card opens `/activity/<session id>`: a full-screen, guitar-tuner style view fed by a Bluetooth chest strap.

- **Connection:** Web Bluetooth (Chrome on Android, desktop Chrome), standard Heart Rate service `0x180D`, characteristic `0x2A37`. One tap opens Chrome's device picker; drops reconnect automatically (5 tries, 2 s apart), then offer a Reconnect button. The screen is kept awake (Wake Lock API). The app must stay on screen: Chrome may drop Bluetooth when it's backgrounded.
- **Display:** bpm averaged over 5 s; status under / in zone / over against the session's zone (`Z1-2` has no floor; zone bpm bounds in `lib/hr.ts`, matching `hrZone`). Key sessions get an Effort / Recovery (Z1-2) toggle for intervals.
- **Nudges:** after 10 s out of zone, then every 30 s: one long vibration = push on, three short = ease off; optional beep.
- **Finish:** minutes (wall clock), time-weighted average HR and % in zone (gaps capped at 5 s) prefill the Done form; saving logs the session like any other and notes the % in zone.
- **Testing / public demo:** the demo (`/activity/demo`) is open without signing in, linked from the login page ("Try the heart rate demo") and from Settings. Visitors enter their threshold heart rate and zones are worked out from it (Coggan: Z2 from 81%, Z3 90%, Z4 94%, Z5 100%; at 172 this is exactly the plan's table, `zonesFromThreshold` in `lib/hr.ts`); signed in, it is prefilled with 172. Simulator presets (below / in / above) follow the chosen band. It loads no user data and saves nothing; Back goes to Settings when signed in, the login page otherwise. The demo runs the same screen with no session behind it: pick any zone (Z1-2 to Z4, switchable mid-ride), use the strap or a simulated heart rate (Sim 110 / 145 / 165), and nothing is saved. On a real ride, `?sim=1` on the activity URL also enables the simulator.
- Not stored: the per-second readings (only the summary is saved). No background recording.

### Smart trainer in the demo (read-only)

The public demo (`/activity/demo`, `app/activity/demo/demo-screen.tsx`) can also connect a smart trainer (built for the rider's Tacx Flow Smart), alongside or instead of the strap. The real-ride screen is heart rate only.

- **Read-only.** Nothing is ever written to the trainer; resistance stays with the rider (no ERG mode).
- **Three formats**, tried in order (`useTrainer`): Fitness Machine Indoor Bike Data (0x1826 / 0x2AD2), Cycling Power Measurement (0x1818 / 0x2A63, cadence worked out from crank revolutions), and Tacx's own FE-C over Bluetooth (service `6e40fec1-…`, ANT+ pages 0x19 power/cadence and 0x10 speed). Decoders are unit-tested in `lib/power.ts`.
- **FTP** entered by the visitor (prefilled 160 when signed in) gives Coggan power zones: Z2 from 56%, Z3 above 75%, Z4 above 90%, Z5 above 105%, Z6 above 120% (`powerZonesFromFtp`). Power is shown as a 3-second average.
- With both sources on, a **Heart rate / Power** toggle picks what the tuner follows; the other values show as tiles (power, cadence, speed, heart rate).
- The summary adds average power, average cadence (pedalling only) and time in each power zone. A simulated trainer is available for testing.

### Trainer on real rides, free rides, and zones from Settings

- **One screen for every live ride** (`app/activity/live-ride-screen.tsx`), in three modes: a **planned** ride (`/activity/<session id>`, from the ride card), a **free ride** (`/activity/free`, from the Record ride button on Today), and the public **demo**. All three can use the strap, the trainer, or both, with the Heart rate / Power tuner toggle. Heart rate stays the default: the plan's sessions are written in heart rate zones, and sessions have no power targets.
- **Settings → Zones:** threshold heart rate (default 172) and FTP (default 160). Heart rate zones everywhere (tuner, zone badges on Today) and power zones come from these. At 172 the heart rate zones are the plan's original table.
- **Saved with the ride:** `session_logs.avg_power` and `avg_cadence` (migration `20261126000001_power.sql`), only on done rides (DB check). They're only written when sent, so editing a log with the normal Done form never wipes recorded power. Shown on Today's logged card and in Week view. Using the trainer sets the bike to Turbo.
- **Free ride:** if today still has a planned ride to log, the finish screen offers "Today's ride" (counts toward the week, with slot choice) or "Unplanned ride" (on the record only). Otherwise it's logged as unplanned. Not available in a reviewed (locked) week.
- **Record ride button:** a floating button on Today (only when viewing today and the week isn't locked) opens a free ride.
