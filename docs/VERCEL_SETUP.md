# Vercel Deployment — Royal Diadem (READ BEFORE FIRST DEPLOY)

> **Purpose:** the launch runbook for hosting the PWA on Vercel. What Vercel does and does not
> do in this architecture, exact project settings, env vars, the deploy pipeline, and the
> post-deploy wiring that lives OUTSIDE Vercel (Supabase CORS, Turnstile domains).
>
> Companion docs: `docs/KEYS_SETUP.md` §4 (accounts/keys checklist) ·
> `docs/SUPABASE_RULES.md` (backend rules) · `vercel.json` (checked-in config).

---

## 1. Architecture: Vercel is a static host, nothing more

Vercel serves the **built PWA only** — HTML, JS, CSS, icons, manifest, service worker. There is
no server code on Vercel:

- All server logic (auth, data access, AI gateway) lives in **Supabase Edge Functions**.
- The browser talks to Supabase **directly**; student data never transits or rests on Vercel.
  That keeps Vercel out of the regulated-data path (§17.5 BAA scope) — **keep it that way**.
- Adding Vercel serverless/edge functions, SSR, or middleware would change that boundary —
  that is a stop-and-ask (`CLAUDE.md` §2) with compliance implications, not a casual change.

**Consequence for secrets:** Vercel env vars hold **public values only** (`VITE_*` = shipped to
every browser). No secret of any kind ever goes into Vercel.

---

## 2. Deploy order (first launch)

Deploying the frontend before the backend exists gives a broken app. Order:

1. Supabase hosted project ready: `supabase db push` (needs access token — KEYS_SETUP §1a),
   `supabase functions deploy` (all functions), secrets set (`TURNSTILE_SECRET_KEY`,
   `ANTHROPIC_API_KEY` ✅ already set 2026-07-17, optional `CROWN_CODE_PREFIX`,
   optional `PROGRAM_TIMEZONE`).
2. Create the Vercel project (§3) + env vars (§4).
3. First production deploy → note the `*.vercel.app` domain.
4. Post-deploy wiring (§6): `ALLOWED_ORIGINS` on Supabase, Turnstile domain, PWA smoke test.

---

## 3. Project settings

Create via the connected Vercel MCP or dashboard → "Import Git Repository" →
`RoyalDiadem2007/Royal-Diadem`.

| Setting | Value |
|---------|-------|
| Framework preset | **Vite** |
| Build command | `npm run build` (runs `tsc -b` first — type errors fail the build, on purpose) |
| Output directory | `dist` |
| Install command | `npm ci` |
| Node.js version | **24.x** (LTS; matches CI `node-version: 24` and `engines` `>=22` — keep CI and Vercel on the same major) |
| Root directory | repo root |

**Git integration:** every push to `main` = production deploy; every PR = preview deploy.
Since our workflow is PR-per-phase with required CI, enable
**Settings → Git → "Only deploy when CI checks pass"** (or leave Vercel's check reported into
the PR) so a red CI never ships. Preview deploys are safe — the bundle contains only public
config — but previews get random URLs that are **not** in `ALLOWED_ORIGINS`, so backend calls
from previews fail closed. That is acceptable (UI review only) — do not widen CORS to fix it.

---

## 4. Environment variables (all environments; public by definition)

| Name | Value | Source |
|------|-------|--------|
| `VITE_SUPABASE_URL` | `https://luvthaezikvssnuegviu.supabase.co` | SUPABASE_RULES §1 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | KEYS_SETUP §1b |
| `VITE_TURNSTILE_SITE_KEY` | `0x4AAA…` (site key, not secret) | KEYS_SETUP §2c |

Nothing else. If a task ever seems to need another env var here, check it against the
"Vercel is static-only" rule (§1) first.

---

## 5. `vercel.json` (checked in — do not configure headers in the dashboard)

Already authored in Foundation; the dashboard must not duplicate/override it:

- **SPA rewrite** — every path → `index.html` (client routing via react-router).
- **Security headers** on every response: HSTS (2y, preload), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, referrer policy, permissions policy (camera/mic/geo/payment/usb
  all off), and a strict **CSP** allowing only self + `*.supabase.co` (API/media) +
  `challenges.cloudflare.com` (Turnstile). **If a new external origin is ever introduced,
  the CSP must be updated in the same PR — and new origins are a §2 stop-and-ask anyway.**
- **Caching**: `/icons/*` and `/assets/*` immutable for 1 year; `sw.js` `no-cache` (so service
  worker updates propagate); `manifest.json` served with the correct content type.

---

## 6. Post-deploy wiring (outside Vercel — easy to forget)

| # | What | Where | Why |
|---|------|-------|-----|
| 1 | `npx supabase secrets set ALLOWED_ORIGINS=https://<prod-domain>` | Supabase function secrets | Edge Function CORS allowlist (`_shared/http.ts`) — until set, production API calls fail closed |
| 2 | Add the prod domain to the Turnstile widget | Cloudflare dashboard | Turnstile only issues tokens on listed domains — login breaks without it |
| 3 | PWA smoke test | iPhone Safari + Android Chrome | "Add to Home Screen", standalone display, icons, login flow end-to-end |
| 4 | Custom domain (optional — Kenecia decision, Spec §12) | Vercel → Domains | Then update #1 and #2 with the new domain (keep both during transition) |

---

## 7. Rules recap

- **No secrets on Vercel, ever.** `VITE_*` ships to the browser (`CLAUDE.md` §4.5).
- **No Vercel serverless/SSR/middleware** without a §2 ask — it would pull Vercel into the
  regulated-data path (§17.5 BAA).
- **Headers/routing changes go through `vercel.json` in a PR**, never the dashboard —
  change management (§17.3) requires config in git.
- Deploys ride the Git integration; there is no manual `vercel deploy` step in the workflow.
- Rollback = Vercel dashboard → Deployments → "Promote" a previous good deploy (static-only
  makes rollbacks instant and safe; the database is versioned separately via migrations).
