# Royal Diadem — Project State & Tracker

> **Start here.** This is the living status doc — current state, what's done, what's next, and open
> decisions. Update it as work progresses. For *what* we build see `Royal_Diadem_Master_Spec.md`;
> for *how* we build see `CLAUDE.md`; for backend rules see `docs/SUPABASE_RULES.md`.
>
> _Last updated: 2026-06-20 · Latest commit: 83653c6 · Branch: main (synced to origin)_

**Legend:** ✅ done · 🔄 in progress · ⬜ not started · ⏳ blocked/awaiting input

---

## 1. Where we are right now

The original code repo was lost (2026-06-20); only the Master Spec survived. We have **not** started
the app build. We have established the **foundation documents and guardrails** and confirmed external
state. Next working session begins the actual rebuild at **Phase 0/1 (Foundation)**.

**External state (verified 2026-06-20):**
- GitHub repo `RoyalDiadem2007/Royal-Diadem` — only the spec + our new docs; code never existed here.
- Supabase project `luvthaezikvssnuegviu` — ACTIVE_HEALTHY, **public schema empty** (no tables yet).
- Vercel — no Royal Diadem project deployed yet.

---

## 2. Done so far (committed + pushed)

- ✅ Master Spec recovered & confirmed intact (`Royal_Diadem_Master_Spec.md`)
- ✅ `CLAUDE.md` — AI engineering governance & standards
- ✅ `docs/SUPABASE_RULES.md` — 2026 Supabase keys/grants/migrations, Turnstile, storage, Edge Fns
- ✅ `.claude/hooks/pre-commit-guard.sh` + `.claude/settings.json` — commit guard (blocks `any`,
  `@ts-ignore`, `console.*`, skipped tests; runs lint/typecheck/test gates when present)
- ✅ `.gitignore`
- ⏳ **Commit guard not yet active** — open `/hooks` once (or restart) to activate it.

---

## 3. Build tracker (from Spec §13)

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Governance & guardrails (CLAUDE.md, Supabase rules, hook, gitignore) | ✅ | This session |
| 1 | Foundation: scaffold, branding.config, **schema + RLS + grants**, PWA base | ⬜ | Resolve Open Decisions #1–#4 here |
| 2 | Auth: PIN gen/hash, login, WebAuthn, COPPA consent gate | ⬜ | Blocked on session-model decision (OD-1) |
| 3 | Admin panel shell (file-cabinet layout, sidebar, routing) | ⬜ | |
| 4 | Student enrollment (CSV + individual, PIN distribution) | ⬜ | |
| 5 | Crown Check (student + admin trends + AI flag) | ⬜ | |
| 6 | Journal (write + mentor review + AI flag) | ⬜ | Blocked on encryption decision (OD-2) |
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
| GitHub security scanner (CodeQL, Dependabot, secret scan, gitleaks) | ⬜ | early — protect every commit |
| CI/CD GitHub Actions YAML (lint/typecheck/test → build → deploy) | ⬜ | |
| PWA cross-platform: VAPID push, SW, manifest (iPhone/iPad/Android/Mac/Windows) | ⬜ | iOS push needs Add-to-Home-Screen |
| `audit_logs` table + audit logger | ⬜ | OD-4; core to logging rule |

---

## 4. Open Decisions / Spec Gaps (resolve deliberately)

> 🔴 = decide at/before Foundation · 🟠 = schema impact · 🟡 = product/flow · ⚪ = ops

| ID | Pri | Gap / decision needed | Status |
|----|-----|-----------------------|--------|
| OD-1 | 🔴 | **Session/token model** for PIN auth (format, storage — not localStorage PHI, expiry, refresh, revoke) | ⬜ open |
| OD-2 | 🔴 | **Journal/crown-note encryption** approach + key management (and mentor decrypt path) | ⬜ open |
| OD-3 | 🔴 | **Crisis escalation + Texas mandated-reporting** protocol (who/how-fast on self-harm/abuse signals) | ⬜ open |
| OD-4 | 🔴 | **`audit_logs` table** design (actor, action, entity, timestamp, redaction) | ⬜ open |
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

---

## 5. Pending client deliverables (⏳ from Kenecia / client)

- ⏳ Royal Diadem **logo** (crowned flamingo) → branding, icons, manifest
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
