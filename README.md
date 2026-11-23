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
4. **Google sign-in** (no email or SMTP needed):
   - *Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID*, type **Web application**. Under *Authorized redirect URIs* add `https://<your-project-ref>.supabase.co/auth/v1/callback`. If asked, set up the consent screen first (External, app name, your email; leave it in Testing and add yourself as a test user).
   - *Supabase → Authentication → Sign In / Providers → Google:* enable it and paste the client ID and secret.
   - *Supabase → Authentication → URL Configuration:* set Site URL to your Vercel URL, and add both `http://localhost:3000/**` and `https://<your-app>.vercel.app/**` to Redirect URLs. Supabase only returns to listed addresses and quietly falls back to the Site URL otherwise.
   - `ALLOWED_EMAIL` must be the Google account's address. Any other Google account is signed straight back out.
   - After your first sign-in, turn off *Allow new users to sign up* (same Providers page) so no other account can even be created.
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
