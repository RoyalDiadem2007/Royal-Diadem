# Royal Diadem — Project State & Tracker

> **Start here.** This is the living status doc — current state, what's done, what's next, and open
> decisions. Update it as work progresses. For *what* we build see `Royal_Diadem_Master_Spec.md`;
> for *how* we build see `CLAUDE.md`; for backend rules see `docs/SUPABASE_RULES.md`.
>
> _Last updated: 2026-07-16 · Branch: main + `feat/foundation` (Phase 1 underway)_

**Legend:** ✅ done · 🔄 in progress · ⬜ not started · ⏳ blocked/awaiting input

---

## 1. Where we are right now

The original code repo was lost (2026-06-20); only the Master Spec survived. We have **not** started
the app build. We have established the **foundation documents and guardrails** and confirmed external
state. Next working session begins the actual rebuild at **Phase 0/1 (Foundation)**.

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
- ✅ `CLAUDE.md` §17 — **SOC 2 & HIPAA alignment** requirements (regulated-data definition, audit
  controls, TSC mapping, no-PHI-to-AI rule, org-items checklist) + §3 hard gate + §13 DoD checkbox
  _(2026-07-03, **uncommitted**)_
- ⏳ **Commit guard not yet active** — open `/hooks` once (or restart) to activate it.

---

## 3. Build tracker (from Spec §13)

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Governance & guardrails (CLAUDE.md, Supabase rules, hook, gitignore) | ✅ | This session |
| 1 | Foundation: scaffold, branding.config, **schema + RLS + grants**, PWA base | 🔄 | `feat/foundation` 2026-07-16: scaffold + strict gates ✅, branding config + shell + tests ✅, audit logger ✅, PWA base ✅, 4 migrations authored + Docker-verified ✅. Remaining: `supabase db push` (needs access token — KEYS_SETUP §1a), Vercel link, merge to main |
| 2 | Auth: PIN gen/hash, login, WebAuthn, COPPA consent gate | 🔄 | `feat/auth` 2026-07-16: Edge Fn trust boundary (`_shared`), auth-login/logout/session (Turnstile→rate-limit→bcrypt→COPPA gate→opaque session→audit), client login flow, **8 no-mock E2E tests passing on the local stack** + 38 unit tests. Decision: students log in with **crown code + PIN** (`students.login_code`) so PIN isn't the sole credential. Remaining: **WebAuthn — blocked on §2 dependency approval for `@simplewebauthn/server`+`browser`**; PIN reset (OD-9); real Turnstile keys; PIN/code generation lands with enrollment (Phase 4) |
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

## 6. Next-session startup checklist

1. Open `/hooks` to **activate the commit guard**.
2. Confirm **OD-1 → OD-4** decisions (or accept proposed defaults) before writing schema/auth.
3. Begin **Phase 1 Foundation**: scaffold (Vite+React+TS), `branding.config.ts`, Supabase migration
   (via **CLI**, not MCP — see Supabase rules), PWA base (manifest + SW skeleton).
4. Stand up the **`audit_logs` table** as part of Foundation.
5. Branch off `main` for app code; commit + push at session end.

---

## 7. Document map
- `Royal_Diadem_Master_Spec.md` — what we build
- `CLAUDE.md` — how we build (standards, gates, Definition of Done)
- `docs/SUPABASE_RULES.md` — backend rules (keys, grants, migrations, Turnstile, storage, Edge Fns)
- `PROJECT_STATE.md` — **this file**: current state & tracker
