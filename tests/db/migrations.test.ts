// Runs the real Supabase migrations against an in-process Postgres (PGlite)
// with a minimal stand-in for Supabase's auth schema, then checks seeding,
// RLS isolation and the weekday guard.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../../supabase/migrations");
const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

let db: PGlite;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function count(sql: string): Promise<number> {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}, 60_000);

describe("seed_block_1", () => {
  it("seeds Block 1 for the calling user, once", async () => {
    await asUser(USER_A, async () => {
      const first = await db.query<{ seeded: boolean }>("select public.seed_block_1() as seeded");
      expect(first.rows[0].seeded).toBe(true);
      const second = await db.query<{ seeded: boolean }>("select public.seed_block_1() as seeded");
      expect(second.rows[0].seeded).toBe(false);

      expect(await count("select * from plan_weeks")).toBe(7);
      expect(await count("select * from planned_sessions where kind = 'ride'")).toBe(26);
      expect(await count("select * from planned_sessions where kind = 'core'")).toBe(10);
      expect(await count("select * from settings")).toBe(1);
    });
  });

  it("matches the plan week targets and key sessions", async () => {
    await asUser(USER_A, async () => {
      const weeks = await db.query<{ plan_week: number; type: string; target_minutes: number }>(
        "select plan_week, type, target_minutes from plan_weeks order by plan_week",
      );
      expect(weeks.rows).toEqual([
        { plan_week: 0, type: "minimum", target_minutes: 105 },
        { plan_week: 1, type: "habits", target_minutes: 135 },
        { plan_week: 2, type: "build", target_minutes: 180 },
        { plan_week: 3, type: "easy", target_minutes: 135 },
        { plan_week: 4, type: "build", target_minutes: 210 },
        { plan_week: 5, type: "build", target_minutes: 240 },
        { plan_week: 6, type: "easy", target_minutes: 150 },
      ]);

      const key = await db.query<{ plan_week: number; weekday: number }>(
        `select pw.plan_week, ps.weekday from planned_sessions ps
         join plan_weeks pw on pw.id = ps.plan_week_id where ps.is_key order by 1`,
      );
      expect(key.rows).toEqual([
        { plan_week: 4, weekday: 1 },
        { plan_week: 5, weekday: 1 },
      ]);

      const thu = await db.query<{ max_minutes: number; backup_max_minutes: number }>(
        `select max_minutes, backup_max_minutes from planned_sessions ps
         join plan_weeks pw on pw.id = ps.plan_week_id where pw.plan_week = 5 and weekday = 4`,
      );
      expect(thu.rows[0]).toEqual({ max_minutes: 60, backup_max_minutes: 30 });
    });
  });

  it("creates the first week plan on 23 Nov 2026 at plan week 1", async () => {
    await asUser(USER_A, async () => {
      const wp = await db.query<{ week_start: Date; pointer: number; plan_week: number }>(
        `select wp.week_start, wp.pointer, pw.plan_week from week_plans wp
         join plan_weeks pw on pw.id = wp.plan_week_id`,
      );
      expect(wp.rows).toHaveLength(1);
      expect(wp.rows[0].pointer).toBe(1);
      expect(wp.rows[0].plan_week).toBe(1);
      expect(wp.rows[0].week_start.toISOString().slice(0, 10)).toBe("2026-11-23");
    });
  });

  it("refuses to run without a user", async () => {
    await db.exec("set role authenticated;");
    try {
      await expect(db.query("select public.seed_block_1()")).rejects.toThrow(/not authenticated/);
    } finally {
      await db.exec("reset role;");
    }
  });
});

describe("row level security", () => {
  it("hides one user's rows from another", async () => {
    await asUser(USER_B, async () => {
      expect(await count("select * from plan_weeks")).toBe(0);
      expect(await count("select * from planned_sessions")).toBe(0);
      expect(await count("select * from week_plans")).toBe(0);
      expect(await count("select * from settings")).toBe(0);
    });
  });

  it("blocks writing rows owned by someone else", async () => {
    await asUser(USER_B, async () => {
      await expect(
        db.query(`insert into daily_logs (user_id, date) values ('${USER_A}', '2026-11-23')`),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("blocks attaching to another user's plan week", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from plan_weeks where user_id = '${USER_A}' and plan_week = 1`,
    );
    await asUser(USER_B, async () => {
      await expect(
        db.query(
          `insert into planned_sessions (plan_week_id, weekday, kind, target_minutes, primary_slot)
           values ('${rows[0].id}', 2, 'ride', 30, '07:00')`,
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });
});

describe("session_logs", () => {
  async function mondayRideId(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select ps.id from planned_sessions ps join plan_weeks pw on pw.id = ps.plan_week_id
       where pw.plan_week = 1 and ps.weekday = 1 and ps.kind = 'ride'`,
    );
    return rows[0].id;
  }

  it("accepts a log on the session's own weekday", async () => {
    await asUser(USER_A, async () => {
      const id = await mondayRideId();
      await db.query(
        `insert into session_logs (date, planned_session_id, status, slot_used, actual_minutes, bike)
         values ('2026-11-23', $1, 'done', 'primary', 45, 'turbo_road')`,
        [id],
      );
      expect(await count("select * from session_logs")).toBe(1);
    });
  });

  it("rejects moving a session to another day", async () => {
    await asUser(USER_A, async () => {
      const id = await mondayRideId();
      await expect(
        db.query(
          `insert into session_logs (date, planned_session_id, status, slot_used, actual_minutes, bike)
           values ('2026-11-24', $1, 'done', 'other', 45, 'turbo_road')`,
          [id],
        ),
      ).rejects.toThrow(/planned weekday/);
    });
  });

  it("rejects logging the same session twice on one day", async () => {
    await asUser(USER_A, async () => {
      const id = await mondayRideId();
      await expect(
        db.query(
          `insert into session_logs (date, planned_session_id, status) values ('2026-11-23', $1, 'dropped')`,
          [id],
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  it("requires minutes for done and forbids them for dropped", async () => {
    await asUser(USER_A, async () => {
      await expect(
        db.query(`insert into session_logs (date, status, slot_used, bike) values ('2026-11-25', 'done', 'other', 'turbo_road')`),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("only allows unplanned rides as done", async () => {
    await asUser(USER_A, async () => {
      await expect(
        db.query(`insert into session_logs (date, status) values ('2026-11-25', 'dropped')`),
      ).rejects.toThrow(/check constraint/);
    });
  });
});
