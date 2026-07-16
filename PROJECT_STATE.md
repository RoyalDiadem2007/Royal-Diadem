# Royal Diadem — Project State & Tracker

> **Start here.** This is the living status doc — current state, what's done, what's next, and open
> decisions. Update it as work progresses. For *what* we build see `Royal_Diadem_Master_Spec.md`;
> for *how* we build see `CLAUDE.md`; for backend rules see `docs/SUPABASE_RULES.md`.
>
> _Last updated: 2026-07-16 (end of session) · Branches: `main` (Foundation merged, all CI green) + `feat/auth` (Phase 2, pushed, awaiting merge)_

**Legend:** ✅ done · 🔄 in progress · ⬜ not started · ⏳ blocked/awaiting input

---

## 1. Where we are right now

**2026-07-16 was the rebuild day.** Phase 1 (Foundation) is complete and merged to `main`:
strict-gated Vite+React+TS scaffold, branding config as single source of truth, client audit
logger, PWA base (brand-generated manifest, icons, static-only service worker), 5 Docker-verified
migrations (17 tables, RLS everywhere, anon locked to 4 public tables), CI/CodeQL/gitleaks/
Dependabot all live and green. Phase 2 (Auth) is built and pushed on **`feat/auth`**: the full
Edge-Function trust boundary, PIN login (crown code + PIN), COPPA gate, opaque sessions, atomic
rate limiting, client login flow — validated by **8 no-mock E2E tests against the real local
stack** plus 38 unit tests. Nothing has been pushed to the *hosted* Supabase project yet (waiting
on the access token). See §6 for the morning pickup list.

**Historical note:** the original code repo was lost 2026-06-20 (unpushed codespace auto-deleted);
only the Master Spec survived. Recovery concluded 2026-07-03 → rebuilt from scratch. Push at every
session end — always.

**External state (verified 2026-06-20, re-verified 2026-07-03):**
- GitHub repo `RoyalDiadem2007/Royal-Diadem` — only the spec + our new docs; code never existed here.
- Supabase project `luvthaezikvssnuegviu` — ACTIVE_HEALTHY, **public schema empty** (no tables yet).
- Vercel — no Royal Diadem project deployed yet.

**Recovery search — concluded 2026-07-03.** Exhaustive hunt for the original app found nothing:
laptop (searched by Maria — empty), this codespace's filesystem, all codespaces (only this one
exists), all GitHub repos/activity, Supabase (no tables ever created), Vercel (no deployment).
Last unchecked avenue: **github.com Settings → Repositories → Deleted repositories** (browser-only,
90-day restore window) and the original claude.ai conversation's artifacts panel. Working
conclusion: the app lived in a codespace that GitHub auto-deleted after ~30 days of inactivity and
was never pushed. **Decision: start fresh at Foundation** — and push at every session end so this
can never happen again.

---

## 2. Done so far (committed + pushed)

- ✅ Master Spec recovered & confirmed intact (`Royal_Diadem_Master_Spec.md`)
- ✅ `CLAUDE.md` — AI engineering governance & standards
- ✅ `docs/SUPABASE_RULES.md` — 2026 Supabase keys/grants/migrations, Turnstile, storage, Edge Fns
- ✅ `.claude/hooks/pre-commit-guard.sh` + `.claude/settings.json` — commit guard (blocks `any`,
  `@ts-ignore`, `console.*`, skipped tests; runs lint/typecheck/test gates when present)
- ✅ `.gitignore`
- ✅ `CLAUDE.md` §17 — **SOC 2 & HIPAA alignment** requirements (committed 2026-07-16)
- ✅ Commit guard active — verified live 2026-07-16 (runs lint/typecheck/test on every commit)
- ✅ **Phase 1 Foundation** merged to `main` 2026-07-16 (commit `61977e6` + Dependabot bumps);
  CI, CodeQL, secret scan all green; TS 7 major deliberately declined (PR #5 closed)
- ✅ **Phase 2 Auth** on `feat/auth` (commit `92bcb56`, pushed): trust-boundary layer, 3 auth
  Edge Functions, auth migration, client login, 38 unit + **8 no-mock E2E tests** (real stack)
- ✅ `docs/KEYS_SETUP.md` — human key-provisioning checklist (Supabase, Turnstile, Anthropic, Vercel)

---

## 3. Build tracker (from Spec §13)

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Governance & guardrails (CLAUDE.md, Supabase rules, hook, gitignore) | ✅ | This session |
| 1 | Foundation: scaffold, branding.config, **schema + RLS + grants**, PWA base | 🔄 | `feat/foundation` 2026-07-16: scaffold + strict gates ✅, branding config + shell + tests ✅, audit logger ✅, PWA base ✅, 4 migrations authored + Docker-verified ✅. Remaining: `supabase db push` (needs access token — KEYS_SETUP §1a), Vercel link, merge to main |
| 2 | Auth: PIN gen/hash, login, WebAuthn, COPPA consent gate | 🔄 | Merged to main 2026-07-16: Edge Fn trust boundary, auth-login/logout/session (Turnstile→rate-limit→bcrypt→COPPA gate→opaque session→audit), client login flow. **WebAuthn added on `feat/webauthn`** (dep `@simplewebauthn` approved 2026-07-16): passkeys in own `webauthn_credentials` table (multi-device + signature counter — spec's single-credential columns superseded; **dropping them = pending §2 ask**), usernameless discoverable login, session-gated registration, counter-regression rejection, single-use 5-min challenges; client Face ID button + post-login enable prompt. **14 no-mock E2E tests** (8 auth + 6 webauthn) + 50 unit tests. Decisions: crown code + PIN identifiers; **no Turnstile on WebAuthn** (crypto challenge-response isn't brute-forceable; IP rate limit still applies). Remaining: full passkey ceremony E2E needs a browser virtual authenticator (Playwright, later); PIN reset (OD-9); real Turnstile keys; PIN/code generation in Phase 4 |
| 3 | Admin panel shell (file-cabinet layout, sidebar, routing) | ⬜ | |
| 4 | Student enrollment (CSV + individual, PIN distribution) | ⬜ | |
| 5 | Crown Check (student + admin trends + AI flag) | ⬜ | |
| 6 | Journal (write + mentor review + AI flag) | ⬜ | OD-2 decided (AES-256-GCM in Edge Fn) |
| 7 | Encouragement Engine (MCP server, draft/approve) | ⬜ | Claude-in-Claude |
| 8 | Daily Message display | ⬜ | |
| 9 | Calendar + Announcements | ⬜ | |
| 10 | Share page (posts, photos, comments, reactions, moderation, peer flag) | ⬜ | |
| 11 | Relaxation tool | ⬜ | needs content table (OD-8) |
| 12 | About Us | ⬜ | ⏳ needs Kenecia bio + photo |
| 13 | Profiles ("queen card") | ⬜ | needs goals model (OD-8) |
| 14 | Flag Center (unified) | ⬜ | needs escalation protocol (OD-3) |
| 15 | Service worker / offline sync | ⬜ | no PHI client-side |
| 16 | Polish (animations, final branding) | ⬜ | |

**Cross-cutting (interleave, not a single phase):**
| Item | Status | Notes |
|------|--------|-------|
| GitHub security scanner (CodeQL, Dependabot, secret scan, gitleaks) | 🔄 | workflows authored 2026-07-16 (`.github/`); repo-side toggles = human (KEYS_SETUP §5) |
| CI/CD GitHub Actions YAML (lint/typecheck/test → build → deploy) | ✅ | `ci.yml` 2026-07-16; deploy via Vercel Git integration when linked |
| PWA cross-platform: VAPID push, SW, manifest (iPhone/iPad/Android/Mac/Windows) | 🔄 | manifest (brand-generated) + SW (static-only cache) + icons done; VAPID push later |
| `audit_logs` table + audit logger | ✅ | migration authored + client logger (`src/lib/logger.ts`, PHI-redacting, transport attaches Phase 2) |

---

## 4. Open Decisions / Spec Gaps (resolve deliberately)

> 🔴 = decide at/before Foundation · 🟠 = schema impact · 🟡 = product/flow · ⚪ = ops

| ID | Pri | Gap / decision needed | Status |
|----|-----|-----------------------|--------|
| OD-1 | 🔴 | **Session/token model** — DECIDED 2026-07-16 (defaults accepted): server-minted opaque tokens (256-bit random), stored **hashed** in a `sessions` table with expiry + revocation; client holds token **in memory only** (never localStorage — §3 PHI rule); ~12h idle timeout students, shorter for admins + re-auth for sensitive actions (§17.2); every Edge Fn validates against the table | ✅ decided |
| OD-2 | 🔴 | **Journal/crown-note encryption** — DECIDED 2026-07-16 (defaults accepted): application-layer **AES-256-GCM in the Edge Function**, server-held key (Supabase secret, rotatable); encrypt before insert, decrypt only for the student + her assigned mentor. Not E2E (mentors must read — Spec transparency model) | ✅ decided |
| OD-3 | 🔴 | **Crisis escalation + Texas mandated-reporting** — PARTIAL 2026-07-16: technical default accepted = high-severity flag → immediate admin-panel badge + alert row for super_admins; email/SMS escalation + the human reporting protocol (who/how fast) still needs Kenecia/legal input before launch | 🔄 tech default set; human protocol ⏳ |
| OD-4 | 🔴 | **`audit_logs` table** — DECIDED 2026-07-16: append-only (no UPDATE/DELETE grants any role); actor id+role, action, entity type+id, UTC timestamp, IP, outcome (allowed/denied); ids never contents; ≥6yr retention, no auto-purge (§17.2). Ships in Foundation migrations | ✅ decided |
| OD-5 | 🔴 | **COPPA data rights**: deletion/parent-review workflow, retention policy, soft-delete, **Privacy Policy + ToS** | ⬜ open |
| OD-6 | 🟠 | **Student↔mentor assignment** table | ⬜ open |
| OD-7 | 🟠 | **Cohorts/phases** model (cohort table, phase dates, transitions) | ⬜ open |
| OD-8 | 🟠 | Missing tables: **relaxation content**, **student goals**, **groups** (for targeting) | ⬜ open |
| OD-9 | 🟡 | **PIN reset** flow | ⬜ open |
| OD-10 | 🟡 | **Consent form** delivery (email/SMS), e-signature, link expiry/security | ⬜ open |
| OD-11 | 🟡 | **Notification triggers** (what fires a push) | ⬜ open |
| OD-12 | 🟡 | **Roles permission matrix** (super_admin/mentor/viewer capabilities) | ⬜ open |
| OD-13 | 🟡 | **Spanish-language** support (esp. guardian consent) | ⬜ open |
| OD-14 | 🟡 | Guardian consent for **all minors (13–17)**, not just COPPA under-13? | ⬜ open |
| OD-15 | ⚪ | **Backups/DR**, staging/prod envs + seed data, **accessibility (WCAG)** target & color contrast | ⬜ open |
| OD-16 | ⚪ | **SOC 2 / HIPAA org items** (CLAUDE.md §17.5 — human-side): Supabase HIPAA add-on + BAA, vendor BAAs, audit engagement, written policies, security officer | ⬜ open |

---

## 5. Pending client deliverables (⏳ from Kenecia / client)

- ✅ Royal Diadem **logo** received 2026-07-03 — `Royal Diadem Real Logo.png` in repo root
  (untracked; commit it, then generate PWA icons 192/512 + favicon from it)
- ⏳ **Anthropic API key** (for the Claude-in-Claude Encouragement Engine) — Maria obtaining, expected 2026-07-17
- ⏳ **Keys/accounts per `docs/KEYS_SETUP.md`** — Supabase secret key + access token, Turnstile keys
- ⏳ Pastor Kenecia Duncan **photo + bio text** → About Us page
- ⏳ Spec §12 items: tagline, About copy, fonts, scripture rotation, relaxation content, moderation
  preference (pre/post-approve), mood-scale approval, custom domain, age-range confirmation

---

## 6. Next-session startup checklist (morning of 2026-07-17)

**Human decisions/inputs needed first:**
1. ⏳ **Approve `@simplewebauthn/server` + `@simplewebauthn/browser`** (CLAUDE.md §2 dependency
   ask) — unblocks WebAuthn/Face ID, the last piece of Phase 2.
2. ⏳ **Anthropic API key** (expected today) — set via `npx supabase secrets set ANTHROPIC_API_KEY=…`
   once the project is linked; needed for Phase 7 Encouragement Engine (Claude-in-Claude).
3. ⏳ **Supabase access token** (KEYS_SETUP §1a) — unblocks `supabase link` + `supabase db push`
   of the 5 verified migrations to the hosted project `luvthaezikvssnuegviu`.
4. Decide: merge `feat/auth` → `main` (CI is the gate; same flow as Foundation).

**Then the build continues, in order:**
5. **WebAuthn** (after #1): registration at first PIN login, credential storage per spec schema,
   `auth-webauthn-*` Edge Functions, E2E where feasible (needs virtual authenticator — may be
   unit + Deno tests instead).
6. **PIN reset flow (OD-9)** — admin-initiated regenerate + reprint card; decide before Phase 4.
7. **Phase 3: Admin panel shell** — file-cabinet layout, sidebar, routing (`react-router` will be
   a §2 dependency ask), role-gated by the session subject.
8. **Phase 4: Enrollment** — CSV + individual add, PIN + crown-code generation (bcrypt cost 12),
   COPPA consent workflow; this is where login_code/PIN issuance actually happens.
9. After db push (#3): deploy the three auth functions (`supabase functions deploy`), set
   `TURNSTILE_SECRET_KEY` (test secret until real keys) + `ALLOWED_ORIGINS`, and re-run the E2E
   suite pointed at a Supabase preview branch if desired.

**Session mechanics (every session):**
- E2E locally: `npx supabase start -x studio,imgproxy,mailpit,realtime,storage-api,vector,logflare`
  → `npx supabase functions serve --env-file supabase/functions/.env` →
  `SUPABASE_E2E_SERVICE_KEY="$(npx supabase status -o json | jq -r .SERVICE_ROLE_KEY)" npm run test:e2e`
  → **`npx supabase stop` when done** (frees CPU; user hit 100% utilization 2026-07-16).
- Deno is installed at `~/.deno/bin` (codespace-local; reinstall if the codespace rebuilt:
  `curl -fsSL https://deno.land/install.sh | sh`). `deno check` the functions before committing.
- Commit + push at session end. No exceptions (see §1 historical note).

---

## 7. Document map
- `Royal_Diadem_Master_Spec.md` — what we build
- `CLAUDE.md` — how we build (standards, gates, Definition of Done)
- `docs/SUPABASE_RULES.md` — backend rules (keys, grants, migrations, Turnstile, storage, Edge Fns)
- `PROJECT_STATE.md` — **this file**: current state & tracker
