# Royal Diadem — Project State & Tracker

> **Start here.** This is the living status doc — current state, what's done, what's next, and open
> decisions. Update it as work progresses. For *what* we build see `Royal_Diadem_Master_Spec.md`;
> for *how* we build see `CLAUDE.md`; for backend rules see `docs/SUPABASE_RULES.md`.
>
> _Last updated: 2026-07-17 night · Phases 0–5 + 4c all merged (PR #11 merged on Maria's instruction, all CI green). Vercel + Supabase GitHub integrations connected (preview checks live on PRs). Supabase secrets set via dashboard: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`; Maria instructed on `ALLOWED_ORIGINS`. Still nothing deployed to hosted Supabase (access token, KEYS_SETUP §1a). Landing page (OD-20) built on `feat/landing-page`._

**Legend:** ✅ done · 🔄 in progress · ⬜ not started · ⏳ blocked/awaiting input

---

## 1. Where we are right now

**2026-07-17: four PRs merged in one day** (#6 WebAuthn, #7 admin shell, #8 enrollment+PIN reset,
#9 CSV import), all CI-gated. `main` now holds: Foundation; **complete Phase 2 auth** (PIN login,
COPPA gate, opaque sessions, rate limiting, Turnstile, passkeys/Face ID); **Phase 3 admin shell**
(file-cabinet layout, role-gated routing, registry-driven sidebar, dashboard with live audited
counts whose tiles link into their sections); **Phase 4a+4b enrollment** (individual add + CSV bulk
import with printable one-time PIN card sheets, crown-code/PIN generation, COPPA computed from DOB,
admin-initiated PIN reset that revokes sessions, same-name+DOB duplicate guard). Test floor:
**87 unit + 29 no-mock E2E** against the real local stack, including the credential circle
(enroll → real login → reset → old PIN+session dead). Server-side RBAC + append-only audit rows on
every admin endpoint, denials included. Still true: **nothing deployed to hosted Supabase/Vercel**
(waiting on the access token — KEYS_SETUP §1a) and the Anthropic key only gates Phase 7's live
generation, nothing else. Known CI quirk: the E2E job's Turnstile round-trip to Cloudflare can
transiently fail (fail-closed 403s on every login) — a re-run/retrigger clears it (seen once,
PR #9).

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
- ✅ **PR #6** merged 2026-07-17 — WebAuthn/passkeys (Phase 2 complete)
- ✅ **PR #7** merged 2026-07-17 — Phase 3 admin shell + audited dashboard (+ CI deno-check glob fix)
- ✅ **PR #8** merged 2026-07-17 — Phase 4a individual enrollment + PIN reset (OD-9); CodeQL
  modulo-bias finding fixed with rejection sampling
- ✅ **PR #9** merged 2026-07-17 — Phase 4b CSV bulk import + printable PIN card sheet + dashboard
  tiles linked to sections

---

## 3. Build tracker (from Spec §13)

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Governance & guardrails (CLAUDE.md, Supabase rules, hook, gitignore) | ✅ | This session |
| 1 | Foundation: scaffold, branding.config, **schema + RLS + grants**, PWA base | 🔄 | `feat/foundation` 2026-07-16: scaffold + strict gates ✅, branding config + shell + tests ✅, audit logger ✅, PWA base ✅, 4 migrations authored + Docker-verified ✅. Remaining: `supabase db push` (needs access token — KEYS_SETUP §1a), Vercel link, merge to main |
| 2 | Auth: PIN gen/hash, login, WebAuthn, COPPA consent gate | ✅ | **WebAuthn merged to main 2026-07-17 (PR #6, squash, all CI green) — Phase 2 complete** (PIN/code *generation* ships with Phase 4 enrollment as planned). Detail: merged to main 2026-07-16: Edge Fn trust boundary, auth-login/logout/session (Turnstile→rate-limit→bcrypt→COPPA gate→opaque session→audit), client login flow. **WebAuthn added on `feat/webauthn`** (dep `@simplewebauthn` approved 2026-07-16): passkeys in own `webauthn_credentials` table (multi-device + signature counter — spec's single-credential columns superseded; **dropping them = pending §2 ask**), usernameless discoverable login, session-gated registration, counter-regression rejection, single-use 5-min challenges; client Face ID button + post-login enable prompt. **14 no-mock E2E tests** (8 auth + 6 webauthn) + 50 unit tests. Decisions: crown code + PIN identifiers; **no Turnstile on WebAuthn** (crypto challenge-response isn't brute-forceable; IP rate limit still applies). Remaining: full passkey ceremony E2E needs a browser virtual authenticator (Playwright, later); PIN reset (OD-9); real Turnstile keys; PIN/code generation in Phase 4 |
| 3 | Admin panel shell (file-cabinet layout, sidebar, routing) | ✅ | **Merged to main 2026-07-17 (PR #7).** Built on `feat/admin-shell`: `react-router` (approved §2 ask, pinned 8.2.0), role-gated routing (student home vs `/admin`; client gate is UX only), `AdminLayout` file-cabinet sidebar driven by a section registry (`src/config/adminSections.ts` — sections register as phases ship), Dashboard with real counts via `admin-dashboard` Edge Fn (session-validated, role re-read server-side, allowed+denied reads audit-logged). 8 new unit + 5 new E2E tests (58 unit / 19 E2E total). Also fixed stale CI deno-check list → glob (`*/index.ts`). Remaining: merge |
| 4 | Student enrollment (CSV + individual, PIN distribution) | 🔄 | **4a merged (PR #8) + 4b merged (PR #9) 2026-07-17 — only the consent workflow remains (⏳ OD-10/OD-14).** Phase 4a on `feat/enrollment`: `admin-students` Edge Fn (list/create/reset-pin; super_admin only until OD-6), crown-code generation (`PREFIX-XXXX`, unambiguous alphabet, stored lowercase/shown uppercase, `CROWN_CODE_PREFIX` env for white-label), unbiased crypto 6-digit PIN → bcrypt(12), COPPA computed from DOB, PIN reset (OD-9) revokes sessions, shared `_shared/adminAuth.ts` RBAC gate (dashboard refactored onto it), Students UI (roster/add form/one-time PIN card/confirm-reset). E2E proves the credential circle: enroll → real login → reset → old PIN+session dead → new PIN works; COPPA gate holds. **Phase 4b built 2026-07-17 on `feat/enrollment-csv`:** CSV bulk import — own RFC4180 parser (no dep), heuristic header auto-map + admin-correctable mapping UI, client-side row validation by CSV line, chunked upload (≤10/req for Edge CPU), server per-row results with same-name+DOB duplicate guard (§7 idempotency), printable one-time PIN card sheet (print CSS); dashboard tiles now link into their sections via the registry (Active students → Students). AI-assisted field mapping = later layer on the same mapping UI (needs Anthropic key; headers only, never student data). Remaining: **guardian/consent verification workflow (needs OD-10/OD-14)**. **Phase 4c built 2026-07-17 on `feat/magic-link` (OD-19), PR pending:** enrollment collects emails (13+ student email, guardian name+email; under-13 student email rejected server-side), `magic_links` table (single-use hashed tokens, 72h, re-issue revokes), `admin-students/send-link` with the age matrix (11–12 → guardian inbox only after verified consent; 13+ → student inbox), Resend email transport (`EMAIL_TRANSPORT=log` locally; needs `RESEND_API_KEY` — KEYS_SETUP §3b), public `magic-link-claim` Edge Fn (Turnstile → rate limit → single-use token → **fresh PIN generated at claim**, prior sessions revoked → session minted), `/welcome` claim screen = one-time digital PIN card → existing Face ID prompt, CSV email columns, roster "Email link" button with precondition-specific errors. 12 unit + 11 E2E added (114/56 total). Guardian access portal (consent-code ceremony + Kenecia emergency override) = next build per OD-19 |
| 5 | Crown Check (student + admin trends + AI flag) | ✅ | **Merged to main 2026-07-17 (PR #10, squash, all CI green first run).** Decisions (Maria, 2026-07-17): one check per program-local day (`check_date`, `PROGRAM_TIMEZONE` env, default America/Chicago), same-day resubmits edit in place; flag rule = last 3 checks all ≤2 → ONE high-severity AI flag, no re-flag while open, new episode after resolve; admin needs-review indicator = **discreet tilted crown** (calm, no alarm — so no one is scared into masking; students never see flag state at all, and it never crosses the student wire). New `_shared/studentAuth.ts` gate re-reads status+COPPA every call (mid-session deactivation locks out). Dashboard "today" count moved to the same program-local day (sibling fix). Mood scale default set in `crownCheck.config.ts` — pending Kenecia approval (Spec §12). 15 unit + 16 E2E tests added (102/45 total). Remaining: merge |
| 6 | Journal (write + mentor review + AI flag) | ⬜ | OD-2 decided (AES-256-GCM in Edge Fn) |
| 7 | Encouragement Engine (MCP server, draft/approve) | ⬜ | Claude-in-Claude; gateway design decided (OD-18); key in Supabase secrets 2026-07-17 |
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
| OD-9 | 🟡 | **PIN reset** flow — DECIDED 2026-07-17: **admin-initiated only.** Admin regenerates from the panel → new card printed and handed to the student in person; all existing sessions revoked; reset audit-logged. No self-service recovery surface (nothing for an attacker to phish), fits the in-person program model. Ships with Phase 4 | ✅ decided |
| OD-10 | 🟡 | **Consent form** delivery (email/SMS), e-signature, link expiry/security | ⬜ open |
| OD-11 | 🟡 | **Notification triggers** (what fires a push) | ⬜ open |
| OD-12 | 🟡 | **Roles permission matrix** (super_admin/mentor/viewer capabilities) — provisional nav rule adopted 2026-07-17: Dashboard visible to all three roles (aggregate counts only); each section declares its `roles` in `adminSections.ts` as it ships; full per-capability matrix still needs deciding before Phase 4 write-paths | 🔄 provisional |
| OD-13 | 🟡 | **Spanish-language** support (esp. guardian consent) | ⬜ open |
| OD-14 | 🟡 | Guardian consent for **all minors (13–17)**, not just COPPA under-13? | ⬜ open |
| OD-15 | ⚪ | **Backups/DR**, staging/prod envs + seed data, **accessibility (WCAG)** target & color contrast | ⬜ open |
| OD-16 | ⚪ | **SOC 2 / HIPAA org items** (CLAUDE.md §17.5 — human-side): Supabase HIPAA add-on + BAA, vendor BAAs, audit engagement, written policies, security officer | ⬜ open |
| OD-17 | 🟡 | **AI journal analysis ("Journaling Coach")** — DECIDED 2026-07-17: buildable once the Anthropic BAA is signed (+ guardian-consent language + design review). Until then the spec's server-side keyword/pattern flag covers escalation signals. Maria is fully aware of the BAA requirement — **do not re-raise it**; when the BAA lands, just build | ⏳ awaiting BAA |
| OD-19 | 🟡 | **Magic-link onboarding + guardian access model** — DECIDED 2026-07-17 (Maria): low-friction credential delivery replaces in-person-only cards (cards remain the no-email fallback). **By age at issuance:** 16+ → magic link straight to the student's email; 13–15 → student gets her own setup link AND the guardian gets a linked account; 11–12 (COPPA) → guardian-only link, set up together with the student present, consent verified before any link is sent. **PIN is generated at claim time** and shown exactly once on the claim screen; claim = first login (Turnstile-gated, rate-limited, single-use hashed token, 72h expiry), then the existing passkey prompt takes over and the PIN stays as lockout fallback. **Guardian access (13–15, build B):** guardian may view the account / read journals ONLY with the student's live knowledge — guardian enters email+code → student gets an in-app notification with a consent code she must share → access opens; every access audited. **Emergency override:** super_admin (Kenecia) may grant guardian access without student knowledge — heavily audited; whether the student is told afterward parks with the OD-3 human protocol. Notification channel: in-app first (no SMS vendor); email vendor: **Resend** (approved §2; on the §17.5 vendor list). Build order: 4c magic-link provisioning first, guardian portal next | ✅ decided |
| OD-20 | 🟡 | **Public landing page** — DECIDED 2026-07-17 (Maria): `/` becomes a public landing page — Royal Diadem logo, **Kenecia's photo** (received; `public/assets/kenecia-headshot.jpg`), a short write-up about the organization, and an **arrow at the bottom leading to the login page** (login moves to its own route). Write-up copy: draft from Spec §1 org overview → Kenecia approves (§12 About copy still pending). Landing content is public/non-regulated; photo ships in the app bundle. Build: small standalone item, natural pairing with Phase 12 About Us but can ship sooner | ✅ decided |
| OD-18 | 🟡 | **AI gateway architecture** — DECIDED 2026-07-17 (Maria's design, confirmed): Phase 7 ships as a *governed AI response gateway*, built as a shared server module (`_shared/aiGateway`) so every AI layer routes through it. Edge Function is the locked gate: holds the key, pins Haiku + strict params, cost/rate caps, server-side output validation. **No auto-pass path** — all validated output → drafts table → human approve → publish (CLAUDE.md §1). Lean corrective loop: admin reject/edit records original + correction + reason + rule + reviewer + model/prompt version (`ai_corrections`); human-approved `ai_rules` feed the validator/prompt-builder on future calls — no auto-learning from raw feedback, no retraining claims. An MCP-protocol interface may layer on top later; enforcement never lives in it | ✅ decided |

---

## 5. Pending client deliverables (⏳ from Kenecia / client)

- ✅ Royal Diadem **logo** received 2026-07-03 — `Royal Diadem Real Logo.png` in repo root
  (untracked; commit it, then generate PWA icons 192/512 + favicon from it)
- ✅ **Anthropic API key** received 2026-07-17 — Maria added it to Supabase secrets
  (`ANTHROPIC_API_KEY`, via dashboard; project not yet CLI-linked). Gates only Phase 7 live generation
- ⏳ **Keys/accounts per `docs/KEYS_SETUP.md`** — Supabase secret key + access token, Turnstile keys
- ⏳ **Resend API key** (KEYS_SETUP §3b) — magic-link emails; local/CI run on the log transport until it lands
- ✅ Pastor Kenecia Duncan **photo** received 2026-07-17 → `public/assets/kenecia-headshot.jpg`
  (landing page OD-20 + About Us). **Bio text / short org write-up still ⏳**
- ⏳ Spec §12 items: tagline, About copy, fonts, scripture rotation, relaxation content, moderation
  preference (pre/post-approve), mood-scale approval, custom domain, age-range confirmation

---

## 6. Next-session startup checklist (updated 2026-07-17 after PR #9)

**Human decisions/inputs needed (none block the build queue below):**
1. ⏳ **Supabase access token** (KEYS_SETUP §1a) — unblocks `supabase link` + `db push` of the 6
   verified migrations to hosted project `luvthaezikvssnuegviu`, then
   `supabase functions deploy` (7 functions) + secrets (`TURNSTILE_SECRET_KEY`,
   `ALLOWED_ORIGINS`, optional `CROWN_CODE_PREFIX`) + Vercel link.
2. ✅ **Anthropic API key** — in Supabase secrets since 2026-07-17 (dashboard). After first link +
   deploy, verify functions can see it (`npx supabase secrets list`).
3. ⏳ **OD-10 + OD-14** (consent delivery method; guardian consent for all minors or under-13
   only) — the only remaining Phase 4 piece (guardian/consent verification workflow).
4. ⏳ **OD-3 human protocol, OD-12 full permission matrix, OD-6 mentor assignment model** — needed
   before mentors get real access to student data.

**Build queue (all unblocked):**
4c-next. ✅ **Guardian access portal** (OD-19 build B) — built 2026-07-17 on
   `feat/guardian-portal`, PR pending. Guardians = third session subject (`guardian_accounts`:
   one login per parent across siblings; email+PIN issued via a `guardian_portal` magic-link
   claim; no passkeys). **Consent ceremony:** guardian asks → 6-digit code (10-min, single-use,
   rate-limited) appears ONLY in the student's app → she chooses to share → 30-min viewing
   window. **v1 view boundary: profile + mood trend (scores/emojis) — crown-check NOTE TEXT
   excluded** (journal/note visibility plugs into the same grant machinery at Phase 6; widen
   deliberately if Maria wants notes sooner). **Emergency override:** super_admin only, 60-min
   window, invisible to the student, fully audited (`via: emergency_grant` on every read).
   Portal eligibility: under-16 (11–12 included — COPPA parental review right). Admin roster:
   Invite guardian + confirm-gated Emergency access. 8 unit + 9 E2E added (125/65 total).
4d. ✅ **Landing page** (OD-20) — merged 2026-07-17 (PR #12): `/` = logo + Kenecia photo +
   write-up + bouncing arrow → `/login`; sign-out lands on the landing page. **Write-up copy
   is a DRAFT in `branding.config.ts` (`landingBlurb`) — needs Kenecia's approval**; swap the
   string when her copy arrives. **Standing rule since PR #12 (Maria): squash-merge any PR
   the moment all CI checks are green — no per-PR ask.**
5. ✅ **Phase 5: Crown Check** — merged 2026-07-17 (PR #10; see tracker row 5).
6. **Phase 6: Journal** — write + mentor review + keyword flag; AES-256-GCM in the Edge Function
   (OD-2 decided). Mentor visibility needs OD-6 first, or ships super_admin-only like Students.
7. **Phase 7: Encouragement Engine** — build the MCP server + weekly draft/approve workflow fully,
   key-agnostic; wire the secret when it arrives.
8. **Phases 8–13** as specced (daily message, calendar, announcements, share, relaxation, about,
   profiles) — About Us still ⏳ Kenecia photo + bio.

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
- `docs/VERCEL_SETUP.md` — launch runbook (static-only hosting, settings, env, post-deploy wiring)
- `docs/KEYS_SETUP.md` — human key-provisioning checklist
- `PROJECT_STATE.md` — **this file**: current state & tracker
