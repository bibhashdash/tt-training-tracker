# Selby TT Tracker

Single-user, mobile-first log of training, sleep and diet against a fixed plan, with a Sunday review that suggests next week's plan. Full spec: [docs/SPEC.md](docs/SPEC.md).

Stack: Next.js 16 (App Router, Cache Components), Supabase (Postgres, email auth, RLS), Tailwind, Vitest.

## First-time setup

1. **Create a Supabase project** at supabase.com (free tier, region London `eu-west-2`).
2. **Env vars:** copy `.env.local.example` to `.env.local` and fill in the project URL, publishable key and `ALLOWED_EMAIL` (your address; nobody else can sign in).
3. **Apply the migrations** with the Supabase CLI:
   ```sh
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npm run db:push
   ```
   Alternatively, paste the three files in `supabase/migrations/` into the SQL editor, in order.
4. **Auth settings** in the Supabase dashboard:
   - *Authentication → URL Configuration:* set Site URL to your deployed URL and add `http://localhost:3000/**` and your Vercel URL `/**` to Redirect URLs.
   - *Authentication → Email Templates → Magic Link:* replace the body with the template below. It adds the 6-digit code (needed when the app is installed on your phone's home screen) and a link that works in any browser.
     ```html
     <h2>Sign in to Selby TT Tracker</h2>
     <p>Your code: <strong>{{ .Token }}</strong></p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/today">Or tap here to sign in</a></p>
     ```
   - After your first sign-in, turn off *Authentication → Sign In / Providers → Allow new users to sign up*.
5. **Run it:** `npm run dev`, open http://localhost:3000 and sign in. The first load seeds Block 1 (plan weeks 1–6, the minimum template, settings, and the week starting 23 Nov 2026).

## Deploy (Vercel)

Import the repo in Vercel, add the same env vars (plus `NEXT_PUBLIC_SITE_URL`), deploy, then add the Vercel URL to Supabase's redirect URLs.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Vitest: date helpers, plus the migrations run in an in-process Postgres (PGlite) to check seeding, RLS and the weekday guard |
| `npm run typecheck` | Route types + `tsc` |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply migrations to the linked Supabase project |
