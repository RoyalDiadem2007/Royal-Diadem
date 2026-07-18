# Royal Diadem — Project State & Tracker

> **Start here.** This is the living status doc — current state, what's done, what's next, and open
> decisions. Update it as work progresses. For *what* we build see `Royal_Diadem_Master_Spec.md`;
> for *how* we build see `CLAUDE.md`; for backend rules see `docs/SUPABASE_RULES.md`.
>
> _Last updated: 2026-07-18 · **Phases 0–7 all merged** (PR #18 squash-merged after a real CI fix: the workflow's Edge Function env never set `AI_TRANSPORT=canned`, so the encouragement E2E had never run green in CI — one line added to `ci.yml`; local dev `.env` always had it, which is why local runs passed). Repo housekeeping 2026-07-18: all 15 merged `feat/*` branches deleted local + origin (each tip verified against its PR's merged head first); local `supabase/config.toml` now disables unused storage/realtime (one-line re-enable each if a future feature needs them — CI already excluded both via `-x`). **Hosted Supabase is live 2026-07-18:** all 11 migrations applied + all 16 Edge Functions deployed (verified via CLI 2026-07-18 after a Codespaces rebuild — the `SUPABASE_ACCESS_TOKEN` Codespaces user secret survived); function secrets set: `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `ALLOWED_ORIGINS`, and (2026-07-18) `JOURNAL_ENCRYPTION_KEY` + `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. **Production frontend is live 2026-07-18: https://www.royaldiademrise.org** (Vercel project `royal-diadem`, team `royal-diadems-projects`; custom domain attached, `VITE_SUPABASE_*` env vars set + verified in the live bundle; `ALLOWED_ORIGINS` updated to www+apex, CORS + auth-login round-trip verified from the prod origin). **Turnstile is live 2026-07-18:** `TURNSTILE_SECRET_KEY` set on hosted Supabase (secrets list, 03:16 UTC) and the real site key `0x4AAAAAAD4Pa0SqEXsVRH6i` verified in the production bundle — the former login blocker is cleared. Still pending: `EMAIL_FROM` (needs a verified Resend domain, §3b R2). Key backup copied to password manager + file deleted (verified 2026-07-18). **Deferred (Maria's call 2026-07-18): rotate the `royal-diadem-cli` access token** (pasted in chat — golden rule 4) **when the app is finished** — do it at launch prep, not later. Merged since: commit-guard hardening (PR #21), "Modern Regal" design refresh — Fraunces/Albert Sans, self-hosted (PR #22), Student Mode — admins join the student experience via an auto-provisioned TEST staff identity, excluded from real metrics (PR #23), Phase 8 Daily Message display (see row 8), and Phase 9 Calendar + Announcements (see row 9 — hosted deploy of its 3 functions done 2026-07-18, 20 functions live), and Phase 10a Share (see row 10 — **hosted deploy pending: `app_settings` migration + 2 new functions**). Next: Phase 10b Share photos (storage), then Phase 11 Relaxation._

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
| 6 | Journal (write + mentor review + AI flag) | 🔄 | **Built 2026-07-17 on `feat/journal`, PR pending.** OD-2 implemented for real: AES-256-GCM in the Edge Fn (`JOURNAL_ENCRYPTION_KEY` secret — KEYS_SETUP §1d; local/CI keys auto-generated), **E2E proves the DB row never contains plaintext**. Keyword flag = documented pattern list (`_shared/journalFlag.ts`: self-harm/abuse/crisis categories — a floor pending OD-3 clinical input), high-severity flag per entry, **reason = category only, never contents**. Student card carries the transparency line ("your mentor can read this"). Review = super_admin until OD-6 (Journals section + prompts manager). Guardians read entries ONLY inside an OD-19 grant window (wired into guardian-portal). 5 unit + 8 E2E added. **Merged 2026-07-17 (PR #16) — Phase 6 complete** (mentor-scoped review joins at OD-6; offline write-sync waits for Phase 15) |
| 7 | Encouragement Engine (MCP server, draft/approve) | ✅ | **Merged 2026-07-18 (PR #18, squash) — Phase 7 complete.** CI fix shipped with it: `AI_TRANSPORT=canned` added to the workflow's functions env (`ci.yml`) — without it `aiConfigured()` correctly failed closed with 503 and all five encouragement E2E assertions cascaded. **Built 2026-07-17 on `feat/encouragement`.** OD-18 gateway implemented: `_shared/aiGateway.ts` = the locked gate — **`claude-haiku-4-5` pinned** (Maria's choice), max_tokens 1500, locked Spec §10 system prompt + human-approved `ai_rules` appended, output validation (exactly 7, ≤280 chars, 66-book scripture-canon check on references), **plain fetch not the npm SDK** (SDK bundle blows Edge isolate CPU limits — documented in-file), `AI_TRANSPORT=canned` for local/CI (deterministic batch through the same validator), 10/day generation cap. `encouragement` fn (super_admin only, permanently): generate/list/approve/reject/replace/post + rules CRUD; **no auto-pass** — anon policy exposes only status=posted. Corrections recorded (`ai_corrections`: original+correction+reason+rule+reviewer+model+prompt_version). Admin UI: week view, 7 day cards, reject/replace with required reason, post-approved, rules manager. Migration `ai_gateway` (CLI-applied). 7 unit + 8 E2E added (139 unit / 86 E2E total). **Live-key smoke test on hosted = at first deploy** |
| 8 | Daily Message display | ✅ | **Built 2026-07-18 on `feat/daily-message`.** "Today's Crown Message" card on the student home: the client's first (and only) direct Data API read — `src/lib/dailyMessage.ts` fetches today's `status=posted` row with the publishable key; the anon RLS policy (core_schema) is the security boundary, proven by a dedicated E2E suite (anon sees only posted rows even unfiltered; insert/update/delete all denied; two posted rows on one date → latest `posted_at` wins). "Today" = device-local calendar date (same convention as `mondayOf`). No message posted → card renders nothing; error → quiet line + retry (no alarm). E2E stack gained `anonKey()` + `SUPABASE_E2E_ANON_KEY` in `ci.yml`. 10 unit + 4 E2E added (157 unit / 96 E2E total) |
| 9 | Calendar + Announcements | ✅ | **Built 2026-07-18 on `feat/calendar-announcements`.** Three new Edge Functions (all `verify_jwt = false` in config.toml, super_admin-gated until OD-12, audited): `admin-calendar` (event CRUD; recurrence = documented weekly subset `FREQ=WEEKLY[;UNTIL=…]` — the only rule the UI can author and the client can expand, no RRULE dep; visibility always 'all' — no group model exists, the enum's 'specific_group' waits for one), `admin-announcements` (create/list/delete, newest first, read counts exclude Student Mode staff identities on both sides of the fraction), `announcement-reads` (student session marks read; idempotent upsert, unknown ids skipped not failed — feed/delete races are benign; student id from session never body). Client: shared `dataApi.ts` extracted (dailyMessage refactored onto it), `calendar.ts` (anon read + weekly expansion incl. week-jump for old series), `announcements.ts` (anon feed + receipts via Edge Fn). Student home: "Coming up" card (next 5 within 60 days) + Announcements feed card (urgent = gold emphasis; auto-receipts, best-effort). Admin: Calendar + Announcements sections (registry + routes). E2E proves RBAC (mentor/student/anon denied), anon RLS (specific_group hidden, writes denied), receipt idempotency + staff exclusion, delete cascades receipts. 24 unit + 11 E2E added (181 unit / 107 E2E total). Hosted deploy ✅ 2026-07-18: all 3 deployed via CLI, verified ACTIVE with verify_jwt=false (20 functions hosted incl. student-mode); prod-origin probe returns our own 401 missing_token, proving the custom-session gate runs |
| 10 | Share page (posts, photos, comments, reactions, moderation, peer flag) | 🔄 | **10a built 2026-07-18 on `feat/share-page` — everything except photos.** New `app_settings` migration (server-side switches; seeded `share_moderation_mode='pre'` — Spec §6.8 "configurable"; unreadable setting also reads as 'pre', never fail-open). `share` Edge Fn (student): feed (approved + own-pending only; own-pending labeled), post (Turnstile-gated per Spec §3 + per-student rate limit 10/h), comment (30/h, approved posts only), reaction toggle (server allowlist of the 10 crown emoji, unique-index race-safe, 120/h), peer flag ("Something doesn't feel right": auto-hides via status→pending + one open `flags` row source=peer severity=medium, no stacking, 10/h; response reveals nothing). `admin-share` Edge Fn (super_admin): queue (pending posts+comments with flagger NAMED — anonymous to students only), approve/remove (resolves open peer flags in the same action, optional note = the "address privately" record), mode switch (audited). Student `/share` route (composer, feed, reactions, comment box, flag confirm flow) linked from a home card; admin "Share Moderation" section (queue + mode radio). All writes audited; admin tokens 403 on the student surface and vice versa. 12 unit + 8 E2E added (189 unit / 115 E2E total). **Remaining 10b: photo posts** — needs storage-api re-enabled (local config.toml + CI `-x` + hosted), `share-media` private bucket + signed URLs, upload via Edge Fn (SUPABASE_RULES §7). **Hosted deploy pending: `app_settings` migration + `share` + `admin-share` functions** |
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
| PWA cross-platform: VAPID push, SW, manifest (iPhone/iPad/Android/Mac/Windows) | 🔄 | Cross-platform pass 2026-07-17: Android **maskable icons** (safe-zone padded, brand bg), manifest `id`/`scope`/`lang` + `purpose` split, **iOS installed-app metas** (capable/status-bar/title), **safe-area insets** (notch/Dynamic Island/home indicator), text-size-adjust, tap-highlight, SW precache v2. Student surfaces are centered-column responsive (phone→tablet→desktop); admin is desktop-first with a ≤48rem stacked fallback (Spec §3). **VAPID push wired 2026-07-17** (`feat/vapid-push`): `push_subscriptions` table, `push` fn (public-key/subscribe/unsubscribe, any signed-in subject), `_shared/push.ts` via `npm:web-push` (approved with Maria's VAPID instruction), SW push+click handlers, gentle in-app enable prompt (students + guardians), **first trigger: guardian access request → PII-free nudge to the student's phone** (send failures never break the request — proven E2E). Needs `VAPID_*` secrets in prod (KEYS_SETUP §1e). Remaining: real-device install + push smoke test at launch (VERCEL_SETUP §6); more triggers await OD-11 |
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
| OD-20 | 🟡 | **Public landing page** — DECIDED 2026-07-17, REVISED same day (Kenecia): **no photo of her on the landing page** — the **logo carries it, larger and centered** with a warm human feel; short org write-up + bottom arrow → login stay. Her headshot (`public/assets/kenecia-headshot.jpg`) is reserved for About Us (Spec §6.9). Write-up copy remains a DRAFT pending her approval (`branding.config.ts` `landingBlurb`) | ✅ decided |
| OD-18 | 🟡 | **AI gateway architecture** — DECIDED 2026-07-17 (Maria's design, confirmed): Phase 7 ships as a *governed AI response gateway*, built as a shared server module (`_shared/aiGateway`) so every AI layer routes through it. Edge Function is the locked gate: holds the key, pins Haiku + strict params, cost/rate caps, server-side output validation. **No auto-pass path** — all validated output → drafts table → human approve → publish (CLAUDE.md §1). Lean corrective loop: admin reject/edit records original + correction + reason + rule + reviewer + model/prompt version (`ai_corrections`); human-approved `ai_rules` feed the validator/prompt-builder on future calls — no auto-learning from raw feedback, no retraining claims. An MCP-protocol interface may layer on top later; enforcement never lives in it | ✅ decided |

---

## 5. Pending client deliverables (⏳ from Kenecia / client)

- ✅ Royal Diadem **logo** received 2026-07-03 — `Royal Diadem Real Logo.png` in repo root
  (untracked; commit it, then generate PWA icons 192/512 + favicon from it)
- ✅ **Anthropic API key** received 2026-07-17 — Maria added it to Supabase secrets
  (`ANTHROPIC_API_KEY`, via dashboard; project not yet CLI-linked). Gates only Phase 7 live generation
- ⏳ **Keys/accounts per `docs/KEYS_SETUP.md`** — access token ✅ 2026-07-18 (Codespaces secret,
  CLI verified; rotate it — pasted in chat); Turnstile keys ✅ 2026-07-18 (secret on hosted +
  site key in prod bundle, verified); remaining: `EMAIL_FROM` (§3b R2)
- ✅ **Resend API key** (KEYS_SETUP §3b) — in Supabase secrets since 2026-07-17; local/CI still use
  the log transport by design
- ✅ Pastor Kenecia Duncan **photo** received 2026-07-17 → `public/assets/kenecia-headshot.jpg`.
  **Placement decided (Maria 2026-07-17): her PROFILE page (About Us / pastor bio, Spec §6.9)**
  — NOT the landing page. **Bio text: Kenecia submitting 2026-07-17/18** → unblocks building the
  About Us / profile page (Phase 12 item, can ship early once the bio lands)
- ⏳ Spec §12 items: tagline, About copy, fonts, scripture rotation, relaxation content, moderation
  preference (pre/post-approve), mood-scale approval, custom domain, age-range confirmation

---

## 6. Next-session startup checklist (updated 2026-07-17 after PR #9)

**Human decisions/inputs needed (none block the build queue below):**
1. ✅ **Supabase access token** (KEYS_SETUP §1a) — done 2026-07-18: linked, all 11 migrations
   pushed, all 16 functions deployed, secrets set (see header). `TURNSTILE_SECRET_KEY` ✅ set on
   hosted 2026-07-18 (site key verified in the prod bundle); optional `CROWN_CODE_PREFIX` still
   default. Rotate the `royal-diadem-cli` token (pasted in chat 2026-07-18).
2. ✅ **Anthropic API key** — in Supabase secrets since 2026-07-17 (dashboard). After first link +
   deploy, verify functions can see it (`npx supabase secrets list`).
3. ⏳ **OD-10 + OD-14** (consent delivery method; guardian consent for all minors or under-13
   only) — the only remaining Phase 4 piece (guardian/consent verification workflow).
4. ⏳ **OD-3 human protocol, OD-12 full permission matrix, OD-6 mentor assignment model** — needed
   before mentors get real access to student data.

**PICK UP HERE (next session, in order):**
1. ✅ **PR #18 (Phase 7 Encouragement)** — merged 2026-07-18. CI was red for a real reason:
   the workflow env lacked `AI_TRANSPORT=canned` (fixed in `ci.yml`, then all checks green).
   Branch deleted; this file refreshed.
2. ✅ **Phase 8: Daily Message display** — built 2026-07-18 as planned (see phase table
   row 8): anon read of today's posted row, RLS-proven by E2E, quiet empty/error states.
3. **Optional polish (Maria asked 2026-07-17):** route-based lazy loading — split the admin
   bundle out of the student path with React.lazy/Suspense on the /admin routes. Current
   bundle is ~93KB gzip + SW-precached, so latency is already fine; this is a cheap nicety,
   not a need. Do it in a quiet moment, not before Phase 8.
4. **Phases 9+ in spec order** (calendar, announcements, share, relaxation, about — Kenecia's
   bio may have arrived → her profile/About page becomes buildable).
5. **Humans:** Supabase access token (§1a — unlocks first deploy + live-Haiku smoke test),
   Kenecia's landing-blurb approval + bio, OD-10/OD-14 consent decisions, ALLOWED_ORIGINS.

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

**⚠️ Local E2E capacity ceiling (learned 2026-07-17 night):** this 2-core/8GB codespace can no
longer complete all 10 E2E files in one run — the edge runtime hits per-isolate CPU soft limits
partway and starts returning 502/503 (failures look like `expected 503 to be 200` on auth-login).
**Every suite passes in isolation/small groups on a fresh `functions serve`.** Locally: run suites
in halves and restart `functions serve` between runs; treat CI (4-core) as the full-matrix truth —
it has been green on every PR. This is capacity, not code.

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
