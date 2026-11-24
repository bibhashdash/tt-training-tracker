// save_block against the real migrations in PGlite: create, edit, protect scheduled weeks, atomicity.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");
const USER = "00000000-0000-0000-0000-0000000000c1";
const OTHER = "00000000-0000-0000-0000-0000000000c2";
let db: PGlite;

async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const q = <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params).then((r) => r.rows);

const session = (weekday: number, target: number, extra: Record<string, unknown> = {}) => ({
  weekday, kind: "ride", target_minutes: target, max_minutes: 90, backup_max_minutes: 90,
  zone: "Z2", is_key: false, primary_slot: "07:00", backup_slot: "12:30", description: null, ...extra,
});
const save = (block: number, weeks: unknown[]) =>
  db.query("select public.save_block($1, $2::jsonb)", [block, JSON.stringify(weeks)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    insert into auth.users values ('${USER}'), ('${OTHER}');
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  await as(USER, () => db.query("select public.seed_block_1()")); // week 1 is scheduled by the seed
}, 60_000);

describe("save_block", () => {
  it("creates a new block with its weeks and sessions", async () => {
    await as(USER, async () => {
      await save(2, [
        { plan_week: 7, type: "build", notes: "Block 2 starts", sessions: [session(1, 50), session(6, 70)] },
        { plan_week: 8, type: "easy", notes: "", sessions: [session(3, 30)] },
      ]);
      const weeks = await q<{ plan_week: number; block: number; type: string; target_minutes: number; notes: string | null }>(
        "select plan_week, block, type, target_minutes, notes from plan_weeks where block = 2 order by plan_week",
      );
      expect(weeks).toEqual([
        { plan_week: 7, block: 2, type: "build", target_minutes: 120, notes: "Block 2 starts" },
        { plan_week: 8, block: 2, type: "easy", target_minutes: 30, notes: null },
      ]);
    });
  });

  it("replaces an unscheduled week's sessions and removes weeks left out", async () => {
    await as(USER, async () => {
      await save(2, [{ plan_week: 7, type: "build", notes: null, sessions: [session(2, 40)] }]);
      expect(await q("select plan_week from plan_weeks where block = 2")).toEqual([{ plan_week: 7 }]);
      expect(await q("select ps.weekday, ps.target_minutes from planned_sessions ps join plan_weeks pw on pw.id = ps.plan_week_id where pw.plan_week = 7"))
        .toEqual([{ weekday: 2, target_minutes: 40 }]);
    });
  });

  it("never changes a week that has already been scheduled", async () => {
    await as(USER, async () => {
      const before = await q("select ps.weekday, ps.target_minutes from planned_sessions ps join plan_weeks pw on pw.id = ps.plan_week_id where pw.plan_week = 1 order by ps.weekday");
      await save(1, [
        { plan_week: 1, type: "build", notes: "changed", sessions: [session(2, 5)] },
        ...[2, 3, 4, 5, 6].map((n) => ({ plan_week: n, type: "easy", notes: null, sessions: [session(3, 30)] })),
      ]);
      const after = await q("select ps.weekday, ps.target_minutes from planned_sessions ps join plan_weeks pw on pw.id = ps.plan_week_id where pw.plan_week = 1 order by ps.weekday");
      expect(after).toEqual(before);
      expect(await q("select type from plan_weeks where plan_week = 1")).toEqual([{ type: "habits" }]);
      expect(await q("select type from plan_weeks where plan_week = 2")).toEqual([{ type: "easy" }]); // unscheduled: edited
    });
  });

  it("refuses to remove a scheduled week, and rolls back everything else", async () => {
    await as(USER, async () => {
      await expect(save(1, [{ plan_week: 2, type: "build", notes: null, sessions: [session(1, 45)] }])).rejects.toThrow(
        /already been scheduled can't be removed/,
      );
      expect(await q("select type from plan_weeks where plan_week = 2")).toEqual([{ type: "easy" }]);
    });
  });

  it("refuses to move a week into another block", async () => {
    await as(USER, async () => {
      await expect(save(2, [{ plan_week: 6, type: "easy", notes: null, sessions: [] }])).rejects.toThrow(/belongs to block 1/);
    });
  });

  it("rejects invalid sessions via the table constraints", async () => {
    await as(USER, async () => {
      await expect(
        save(2, [{ plan_week: 7, type: "build", notes: null, sessions: [session(1, 120, { max_minutes: 45 })] }]),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("only touches the caller's own weeks", async () => {
    await as(OTHER, async () => {
      await save(1, [{ plan_week: 1, type: "build", notes: null, sessions: [session(1, 30)] }]);
      expect(await q("select count(*)::int as n from plan_weeks")).toEqual([{ n: 1 }]);
    });
    await as(USER, async () => {
      expect(await q("select type from plan_weeks where plan_week = 1")).toEqual([{ type: "habits" }]);
    });
  });
});

describe("power migration", () => {
  it("gives existing settings FTP 160 and threshold 172, within limits", async () => {
    await as(USER, async () => {
      expect(await q("select ftp, threshold_hr from settings")).toEqual([{ ftp: 160, threshold_hr: 172 }]);
      await expect(db.query("update settings set ftp = 20")).rejects.toThrow(/check constraint/);
      await expect(db.query("update settings set threshold_hr = 250")).rejects.toThrow(/check constraint/);
    });
  });

  it("stores average power and cadence on done rides only", async () => {
    await as(USER, async () => {
      await db.query(
        `insert into session_logs (date, status, slot_used, actual_minutes, bike, avg_power, avg_cadence)
         values ('2026-11-24', 'done', 'other', 40, 'turbo_road', 145, 88)`,
      );
      expect(await q("select avg_power, avg_cadence from session_logs where date = '2026-11-24'")).toEqual([
        { avg_power: 145, avg_cadence: 88 },
      ]);
      const [{ id }] = await q<{ id: string }>(
        `select ps.id from planned_sessions ps join plan_weeks pw on pw.id = ps.plan_week_id
         where pw.plan_week = 1 and ps.weekday = 3`,
      );
      await expect(
        db.query(
          `insert into session_logs (date, planned_session_id, status, avg_power) values ('2026-11-25', $1, 'dropped', 100)`,
          [id],
        ),
      ).rejects.toThrow(/session_logs_power_only_when_done/);
    });
  });
});
