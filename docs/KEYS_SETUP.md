# Keys & Accounts Setup — What Maria Needs to Provide

> **Purpose:** every credential the Royal Diadem build needs, who provides it, where to get it,
> and exactly where it goes. Work top to bottom — items are ordered by when the build needs them.
>
> **Golden rules (from `docs/SUPABASE_RULES.md` + `CLAUDE.md` §3):**
> 1. **Never paste a key into chat, a file in this repo, or a commit.** Keys live only in
>    env files that are gitignored (`.env.local`), the Supabase secrets store, or Vercel env vars.
> 2. Anything named `VITE_*` ships to the browser — **only public keys** may use that prefix.
> 3. Custom Edge Function secrets may **not** start with `SUPABASE_` or `SB_` (reserved).
> 4. If a secret is ever exposed, rotate it immediately and tell Claude so usage gets updated.

**Status legend:** ⬜ not obtained · ✅ done

---

## 1. Supabase — needed FIRST (schema push blocks on this)

Project: `RoyalDiadem2007's Project` — ref `luvthaezikvssnuegviu` (us-west-2)

| # | What | Where to get it | Where it goes | Status |
|---|------|-----------------|---------------|--------|
| 1a | **Personal access token** (for the CLI to push migrations) | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → "Generate new token", name it `royal-diadem-cli` | Tell Claude it's ready, then run `! npx supabase login` in the session (it will prompt for the token) — or set it as a Codespaces secret named `SUPABASE_ACCESS_TOKEN` | ⬜ |
| 1b | **Publishable key** (`sb_publishable_…`) — public, safe for the browser | Dashboard → Project Settings → **API Keys** → "Publishable key" (create if none exists) | `.env.local` in the repo (gitignored) as `VITE_SUPABASE_PUBLISHABLE_KEY=…`, and later Vercel env (all environments) | ⬜ |
| 1c | **Secret key** (`sb_secret_…`) — server only, bypasses RLS | Same page → "Secret keys" → create one named `default` | Nowhere yet — Edge Functions receive it automatically as `SUPABASE_SECRET_KEYS`. Only needed manually if we add a non-Supabase server later. **Never** in `VITE_*`, never in the repo | ⬜ |

> ⚠️ Ignore the legacy `anon` / `service_role` JWT keys on that page — we do not use them
> (see `docs/SUPABASE_RULES.md` §1). If the dashboard offers to disable them, leave that
> decision until the app is stable, then disable.

| 1d | **Journal encryption key** (OD-2 — AES-256-GCM at rest for journal text) | Generate it yourself — run: `npx supabase secrets set JOURNAL_ENCRYPTION_KEY="$(openssl rand -base64 32)"` (once linked; or paste the generated value into Dashboard → Edge Functions → Secrets) | Supabase function secrets only. **Losing this key means existing journal entries become unreadable — store a copy in your password manager.** Rotation requires a re-encryption pass (ask Claude) | ⬜ |

**Database password** (only if the CLI asks during `db push`): Dashboard → Project Settings →
Database → you can reset it if unknown. Keep it in your password manager; Claude never needs it
stored anywhere.

---

## 2. Cloudflare Turnstile — needed at Phase 2 (login/auth)

Bot protection on login, COPPA consent, and Share posts. Free; requires a Cloudflare account.

| # | What | Where to get it | Where it goes | Status |
|---|------|-----------------|---------------|--------|
| 2a | Cloudflare account | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) (free plan is fine) | — | ⬜ |
| 2b | **Turnstile widget** | Dashboard → Turnstile → "Add widget". Name: `Royal Diadem`. Domains: the Vercel domain (add custom domain later). Mode: **Invisible** | — | ⬜ |
| 2c | **Site key** (public) | Shown after creating the widget | `.env.local` + Vercel env as `VITE_TURNSTILE_SITE_KEY=…` | ⬜ |
| 2d | **Secret key** | Same page | `npx supabase secrets set TURNSTILE_SECRET_KEY=…` (Claude runs this with you; value never enters the repo) | ⬜ |

> Until 2c/2d exist, development uses Cloudflare's official **always-pass test keys** — nothing
> is blocked, but real bot protection needs the real keys before launch.

---

## 3. Anthropic API key — needed at Phase 7 (Encouragement Engine, Claude-in-Claude)

The embedded AI layer: the Edge Function MCP server calls the Claude API to draft the 7 weekly
encouragement messages (admin-reviewed, never posted directly — Spec §6.5/§10).

| # | What | Where to get it | Where it goes | Status |
|---|------|-----------------|---------------|--------|
| 3a | **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key, name it `royal-diadem-encouragement` | `npx supabase secrets set ANTHROPIC_API_KEY=…` — server-only, never `VITE_*`, never the repo | ✅ set in Supabase secrets 2026-07-17 (dashboard) |
| 3b | **Spending limit** | Console → Settings → Limits — set a low monthly cap (e.g. $10–20; generation is 1 small call/week) | — | ⬜ |

> Reminder from `CLAUDE.md` §17.4: this key powers generic message generation only — **no student
> data ever goes to the Claude API** (no BAA with Anthropic).

---

## 3b. Resend — needed for magic-link onboarding (Phase 4c, OD-19)

Transactional email for enrollment magic links (and later the consent workflow). Approved
vendor 2026-07-17; handles guardian/student names + emails → tracked on the CLAUDE.md §17.5
vendor list.

| # | What | Where to get it | Where it goes | Status |
|---|------|-----------------|---------------|--------|
| R1 | **Resend account + API key** | [resend.com](https://resend.com) → API Keys → create `royal-diadem-links` | `npx supabase secrets set RESEND_API_KEY=…` — server-only, never `VITE_*`, never the repo | ✅ set in Supabase secrets 2026-07-17 (dashboard) |
| R2 | **Sending domain** (later; test address works day one) | Resend → Domains → verify a domain, then set `npx supabase secrets set EMAIL_FROM="Royal Diadem <hello@yourdomain.org>"` | Until then the code falls back to Resend's onboarding sender (only delivers to your own inbox — fine for testing, not launch) | ⬜ |

---

## 4. Vercel — needed at first deploy (end of Foundation / Phase 3)

> Full launch runbook: **`docs/VERCEL_SETUP.md`** (settings, env vars, deploy order, and the
> post-deploy wiring on the Supabase/Turnstile side). This section is just the account items.

| # | What | Where to get it | Where it goes | Status |
|---|------|-----------------|---------------|--------|
| 4a | Vercel project | Claude can create it via the connected Vercel MCP when we first deploy — nothing for you to fetch | — | ✅ repo connected 2026-07-17 (preview checks reporting on PRs) |
| 4b | Env vars on Vercel | Claude will list the exact `VITE_*` values (1b, 2c) to add in Vercel → Project → Settings → Environment Variables | — | ⬜ |
| 4c | Custom domain (optional, client decision — Spec §12) | If Kenecia wants one | Vercel → Domains | ⬜ |

---

## 5. GitHub repo hardening — recommended now (no keys, just switches)

In `github.com/RoyalDiadem2007/Royal-Diadem` → Settings:

| # | What | Where | Status |
|---|------|-------|--------|
| 5a | **Secret scanning + push protection** | Settings → Code security | ⬜ |
| 5b | **Dependabot alerts + security updates** | Settings → Code security | ⬜ |
| 5c | **CodeQL default setup** | Settings → Code security → Code scanning | ⬜ |

---

## Quick checklist (in order of need)

- [ ] 1a Supabase access token → unblocks pushing the database schema
- [ ] 1b Supabase publishable key → unblocks the app talking to Supabase
- [ ] 1c Supabase secret key named `default` created in dashboard
- [ ] 5a–5c GitHub security switches (5 minutes, do anytime)
- [ ] 2a–2d Turnstile (before Phase 2 auth is finished)
- [ ] 3a–3b Anthropic key + spend cap (before Phase 7; expected tomorrow)
- [ ] 4a–4c Vercel (at first deploy)

When any item is done, tell Claude — it verifies the wiring and checks the box here.
