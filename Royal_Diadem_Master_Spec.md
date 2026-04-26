# Royal Diadem — Master Build Specification
## Empowerment Platform for At-Risk Young Women (Ages 11–19)

> **Document Purpose:** This is the single source of truth for the Royal Diadem PWA. Hand this to any Claude session to resume with full context. Every architectural decision, feature requirement, data model, branding rule, and governance constraint is captured here.

---

## 1. Organization Overview

**Royal Diadem Inc.** — Houston-based nonprofit (est. 2007) founded by Kenecia T. Belford (now Pastor Kenecia Duncan). Mentors at-risk young women ages 11–19 through behavioral development, self-esteem building, life skills, journaling, and beauty/personal care via subsidiary Crowning Glory salon.

**Program Model:** 90-day phases. Cohorts of ~30 students/month, up to 90 active per phase. Blends personal development (anger management, conflict resolution, goal-setting, journaling) with beauty/self-care mentorship. The salon is the delivery mechanism — investing in a girl's appearance as a reflection of inner worth.

**Revamped Vision:** Ongoing after-school program for ages 11–19. Digital-first platform to scale impact, track outcomes, and empower students daily.

---

## 2. Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Backend | Supabase (Auth, Database, Storage, Edge Functions, Realtime) |
| Hosting | Vercel |
| AI Engine | Claude API via dedicated MCP server |
| PWA | Service Worker, manifest.json, vercel.json |
| Auth | PIN-based (hashed) + WebAuthn/Passkeys (biometric) |
| Bot Protection | Cloudflare Turnstile (free, invisible, COPPA-safe — no user tracking like reCAPTCHA) |

**Supabase Note:** Use updated environment variable pattern (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). No deprecated patterns.

---

## 3. Architecture Principles

### White-Label — Non-Negotiable
- **Branding config** is the single source of truth for all visual identity
- Zero hardcoded colors, org names, logos, or messaging anywhere in components
- Every component reads from the branding config
- This platform can be templated for other youth-serving nonprofits

### Governance — SIC Method™ (CLAUDE.md)
- All AI interactions governed by CLAUDE.md constraints
- AI suggests, human approves — always
- No AI communicates directly with minors unsupervised
- MCP server enforces tone/content guardrails at the tool layer, not prompt layer
- Evaluate every feature: (1) Does it serve the product? (2) Can the AI-assisted workflow sustain it? (3) Can a new hire run it via CLAUDE.md without the builder's oversight?

### COPPA Compliance — From Day One
- Parental/guardian consent gate required before any under-13 account activates
- Digital consent form → admin verifies → student PIN unlocks
- No child data collected until consent is confirmed and stored
- Consent records are permanent audit trail in Supabase

### Bot Protection — Cloudflare Turnstile
- Invisible CAPTCHA on: login screen (before PIN submit), COPPA consent form, Share page posts
- COPPA-safe: no user tracking (unlike Google reCAPTCHA)
- Server-side token verification via Supabase Edge Function
- Lightweight — one script tag, one component, zero friction for the girls

### Responsive — Two Experiences, One Codebase
- **Student view (phones/tablets/iPads):** App-like, full-screen PWA, bottom nav, thumb-friendly, portrait-optimized
- **Admin view (laptop/desktop):** Full-screen file cabinet layout. Left sidebar with organized sections (Students, Messages, Calendar, Flags, Share Moderation, Reports). Clean main content area. Not stacked tabs. Not crowded. Feels like opening a well-organized desk.

---

## 4. Branding Config

### Colors (Extracted from Logo)

```typescript
// branding.config.ts — SINGLE SOURCE OF TRUTH
export const brand = {
  name: "Royal Diadem",
  tagline: "", // Kenecia to provide
  colors: {
    primary: "#E05070",       // Royal pink (flamingo body, "Royal" text)
    secondary: "#C01050",     // Deep magenta ("Diadem" script)
    accent: "#F0C0B0",        // Rose gold / warm blush (feathers, glow)
    surfaceLight: "#F0D0C0",  // Soft peach (highlights)
    background: "#0A0A0A",    // Rich black
    crownGold: "#F0B0A0",     // Warm gold-pink (crown jewels, sparkles)
    textPrimary: "#FFFFFF",
    textSecondary: "#F0C0B0",
    cardSurface: "#1A1A1A",
    success: "#4CAF50",
    warning: "#FFB74D",
    danger: "#EF5350",
  },
  logo: "/assets/royal-diadem-logo.png",  // Crowned flamingo
  fonts: {
    display: "", // TBD — elegant script for headings (matching logo script)
    body: "",    // TBD — clean, readable for body text
  },
  // Crown/queen themed emoji set for Share page reactions
  reactions: ["👑", "💎", "🦩", "👏", "✨", "💪", "🌹", "🎉", "💖", "🔥"],
} as const;
```

### Design Language
- Elegant, feminine, regal but NOT stuffy
- Dark backgrounds with pink/rose gold accents (matches logo)
- Crown and flamingo motifs throughout
- The app should feel like it was built FOR these girls, not repurposed

---

## 5. Authentication Flow

### Initial Setup (Admin-Side)
1. Admin bulk-loads students via CSV upload (AI-assisted parsing) OR adds individually
2. System generates hashed PINs per student
3. For students under 13: COPPA consent form sent to parent/guardian
4. Admin verifies consent received → marks student as "consent verified"
5. Student account activates only after consent verification

### Student Login
1. First login: Enter PIN (hashed, verified against Supabase)
2. Device prompts: "Enable Face ID / Touch ID?"
3. If yes: WebAuthn registers device credential (public key stored in Supabase, biometric never leaves device)
4. Future logins: Biometric → authenticated
5. PIN always available as fallback

### Admin Login
- PIN (hashed) + WebAuthn
- Role-based permissions: Super Admin / Mentor / Viewer

---

## 6. Features — Must-Haves

### 6.1 Sign-In & Profiles
- PIN + biometric auth (see Section 5)
- Student profiles: photo, name, goals, phase status, enrollment date
- Privacy controls appropriate for minors
- Profile is the student's "queen card" — make it feel personal and aspirational

### 6.2 Crown Check (Daily Emotional Temp Check)
- Visual/emoji-driven mood scale (not clinical)
- Optional one-line note ("What's on your mind, queen?")
- Tracked over time — mentors see trends
- **AI flag:** Consecutive low scores or concerning patterns trigger quiet admin alert
- **Safety escalation:** Threshold-based notification, not AI interpretation
- Designed to take < 30 seconds — zero friction

### 6.3 Relaxation Tool
- Guided breathing exercises (visual animation)
- Calming content library (admin-curated)
- Sensory reset (ambient sounds, grounding prompts)
- Available offline via service worker cache

### 6.4 Journal Exercise
- Free-write or prompted entries
- Prompts curated by admin/mentors
- Entries visible to assigned mentor (student knows this — transparency, not surveillance)
- **AI flag:** Keyword/pattern detection for concerning language → admin alert
- Journal text encrypted at rest in Supabase
- Offline write → sync when connected

### 6.5 Encouragement Engine (Claude-in-Claude + MCP Server)
**How it works:**
1. Admin opens Encouragement panel once per week
2. Taps "Generate This Week's Messages"
3. MCP server calls Claude API → generates 7 messages (one for each day of the week)
4. All 7 appear in admin-only draft view, mapped to Monday–Sunday
5. Admin reviews each day — keeps the AI message OR replaces with her own for any given day
6. Approves the week's batch
7. Each day, the scheduled message auto-displays as the "Daily Crown Message" for all students

**Tone Constraints (enforced at MCP server level):**
- Scripture-based motivation that uplifts
- Touch of humor — warm, not corny
- Confident and reassuring
- Affirms the person reading it directly
- Faith-infused but inclusive
- **NEVER:** Bible belt / white nationalist Christianity, dry, scary, prophetic, preachy, fire-and-brimstone, condescending, patronizing
- **NEVER:** Hallucinated scripture references. If citing scripture, it must be real and accurate.
- **NEVER:** AI posts directly. Admin is always the gatekeeper.

**MCP Server Architecture:**
- Dedicated MCP server with internal hooks
- System prompt locked in server config (not editable by prompt injection)
- Tone validation layer before returning messages
- All generated messages logged with metadata (model, timestamp, prompt used)
- Admin approval status tracked (draft → approved → posted OR rejected)

### 6.6 Calendar
- Admin-managed: add/edit/delete events
- Event fields: title, description, date/time, recurring flag, visibility
- Student view: clean monthly/weekly view, upcoming events list
- Push notification support for upcoming events (future enhancement)

### 6.7 Announcements Page
- Admin posts announcements (title, body, priority level)
- Normal vs. urgent priority (urgent = visual emphasis)
- Optional read receipts (track who's seen it)
- Chronological feed, newest first

### 6.8 Royal Diadem Share (Social Feed)
- Post types: photos, text posts, comments, emoji reactions
- **Custom reaction set:** Crown-themed (👑 💎 🦩 👏 ✨ 💪 🌹 🎉 💖 🔥)
- Theme: queenship, crowning, celebrating each other, hyping each other up
- **Moderation:**
  - Admin can pre-approve or post-approve (configurable)
  - **Peer flag:** Any student can tap "Something doesn't feel right" — anonymous to other students, visible to admin
  - Flagged content auto-hidden until admin reviews
  - Admin actions: approve / remove / address privately
- Photo uploads via Supabase Storage
- This is a SAFE SPACE — the moderation architecture protects that

### 6.9 About Us Page
- About Royal Diadem (mission, history, program overview)
- Pastor Kenecia Duncan bio and photo
- Static content, admin-editable

### 6.10 Admin Panel (Desktop File Cabinet)
**Layout:** Full-screen on laptop. Left sidebar navigation with clear sections:

| Section | What's Inside |
|---------|--------------|
| **Dashboard** | At-a-glance: active students, flags needing attention, today's Crown Check summary |
| **Students** | Roster, profiles, enrollment, COPPA consent status, phase tracking |
| **Crown Checks** | Trend views per student, AI flag alerts |
| **Journals** | Student entries (by mentor assignment), AI flag alerts |
| **Encouragement** | Generate messages, review drafts, post or write custom |
| **Calendar** | Add/edit events |
| **Announcements** | Create/manage announcements |
| **Share Moderation** | Review flagged posts, moderate content |
| **Flags** | Unified view of all AI + peer flags, status tracking |
| **Settings** | Branding config, mentor management, permissions |

**Enrollment Tools:**
- Bulk CSV upload with AI-assisted field mapping
- Individual student add form
- Auto-generate hashed PINs
- COPPA consent tracking workflow

---

## 7. Flagging & Safety System

### Two Flag Sources
1. **AI Flag (Automated)**
   - Triggers on Crown Check: consecutive low mood scores (configurable threshold)
   - Triggers on Journal: keyword/pattern detection for concerning language
   - No AI interpretation — pattern matching only
   - Quietly alerts admin (badge count on Flags section)

2. **Peer Flag (Student-Initiated)**
   - Available on every Share page post/comment
   - Single button: "Something doesn't feel right"
   - Anonymous to all students — only admin sees who flagged
   - No burden on the student to explain or categorize
   - Flagged content auto-hides pending admin review

### Flag Record
- Source (AI or peer)
- Related entity (Crown Check ID / Journal ID / Share Post ID)
- Severity (auto-set for AI, default for peer)
- Status: new → reviewed → resolved
- Admin notes
- Resolution timestamp

---

## 8. Supabase Schema

### Tables

**students**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| first_name | text | |
| last_name | text | |
| display_name | text | What shows in the app |
| date_of_birth | date | Used for COPPA check |
| age | int | Computed or stored |
| grade_level | text | |
| school_name | text | nullable |
| pin_hash | text | bcrypt hashed PIN |
| webauthn_credential_id | text | nullable, for biometric |
| webauthn_public_key | text | nullable |
| profile_photo_url | text | Supabase Storage path |
| enrollment_date | timestamptz | |
| phase | text | e.g., "Phase 1", "Phase 2" |
| status | text | active / inactive / graduated |
| coppa_required | boolean | true if under 13 at enrollment |
| coppa_consent_status | text | pending / verified / denied |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**guardians**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| student_id | uuid | FK → students |
| guardian_name | text | |
| relationship | text | parent / legal guardian / other |
| email | text | |
| phone | text | |
| consent_given | boolean | |
| consent_method | text | digital_form / in_person / paper |
| consent_timestamp | timestamptz | |
| verified_by | uuid | FK → admin_users |
| verification_timestamp | timestamptz | |

**admin_users**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | |
| role | text | super_admin / mentor / viewer |
| pin_hash | text | |
| webauthn_credential_id | text | nullable |
| webauthn_public_key | text | nullable |
| email | text | |
| created_at | timestamptz | |

**crown_checks**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| student_id | uuid | FK → students |
| mood_score | int | 1–5 scale |
| mood_emoji | text | The emoji they selected |
| note | text | nullable, optional one-liner |
| ai_flag_triggered | boolean | default false |
| ai_flag_reason | text | nullable |
| created_at | timestamptz | |

**journal_entries**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| student_id | uuid | FK → students |
| prompt_id | uuid | nullable, FK → journal_prompts |
| entry_text | text | Encrypted at rest |
| ai_flag_triggered | boolean | default false |
| ai_flag_reason | text | nullable |
| mentor_id | uuid | nullable, FK → admin_users (assigned mentor) |
| created_at | timestamptz | |

**journal_prompts**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| prompt_text | text | |
| created_by | uuid | FK → admin_users |
| active | boolean | |
| created_at | timestamptz | |

**encouragement_messages**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| message_text | text | |
| source | text | ai_generated / admin_written |
| ai_generation_metadata | jsonb | nullable — model, prompt hash, timestamp |
| scheduled_date | date | The day this message displays (Mon–Sun) |
| week_of | date | Monday of the scheduled week (for batch grouping) |
| status | text | draft / approved / posted / rejected |
| posted_at | timestamptz | nullable |
| posted_by | uuid | nullable, FK → admin_users |
| created_at | timestamptz | |

**calendar_events**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| title | text | |
| description | text | nullable |
| event_date | date | |
| event_time | time | nullable |
| end_time | time | nullable |
| is_recurring | boolean | default false |
| recurrence_rule | text | nullable (iCal RRULE format) |
| visibility | text | all / specific_group |
| created_by | uuid | FK → admin_users |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**announcements**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| title | text | |
| body | text | |
| priority | text | normal / urgent |
| posted_by | uuid | FK → admin_users |
| created_at | timestamptz | |

**announcement_reads**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| announcement_id | uuid | FK → announcements |
| student_id | uuid | FK → students |
| read_at | timestamptz | |

**share_posts**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| student_id | uuid | FK → students |
| post_type | text | photo / text / photo_text |
| content_text | text | nullable |
| image_url | text | nullable, Supabase Storage |
| moderation_status | text | pending / approved / removed |
| created_at | timestamptz | |

**share_comments**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| post_id | uuid | FK → share_posts |
| student_id | uuid | FK → students |
| comment_text | text | |
| moderation_status | text | pending / approved / removed |
| created_at | timestamptz | |

**share_reactions**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| post_id | uuid | FK → share_posts |
| student_id | uuid | FK → students |
| emoji | text | From approved reaction set |
| created_at | timestamptz | |

**flags**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| source | text | ai / peer |
| entity_type | text | crown_check / journal / share_post / share_comment |
| entity_id | uuid | FK to relevant table |
| flagged_by | uuid | nullable — student_id for peer flags, null for AI |
| severity | text | low / medium / high |
| status | text | new / reviewed / resolved |
| admin_notes | text | nullable |
| reviewed_by | uuid | nullable, FK → admin_users |
| resolved_at | timestamptz | nullable |
| created_at | timestamptz | |

**about_content**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| section | text | about_org / pastor_bio |
| title | text | |
| body | text | |
| image_url | text | nullable |
| updated_by | uuid | FK → admin_users |
| updated_at | timestamptz | |

### Storage Buckets
- `profile-photos` — Student profile images
- `share-media` — Share page photo uploads
- `about-images` — About page / pastor bio images
- `branding` — Logo and brand assets

### Row Level Security (RLS)
- Students can only read/write their own data (crown_checks, journal_entries, share_posts)
- Students can read all approved share_posts, announcements, calendar_events, encouragement_messages (posted only)
- Students can create flags but cannot see other students' flags
- Admin roles have tiered access based on role (super_admin > mentor > viewer)
- COPPA consent records: admin-only access
- **Auth pattern:** PIN-based (no Supabase Auth sessions) — RLS policies use custom session management, not `auth.uid()`

---

## 9. PWA Configuration

### manifest.json
```json
{
  "name": "Royal Diadem",
  "short_name": "Royal Diadem",
  "description": "Empowerment platform for young queens",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A0A0A",
  "theme_color": "#E05070",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Service Worker Caching
- Cache daily encouragement message for offline
- Cache relaxation tool content
- Cache journal write capability (sync when reconnected)
- Cache Crown Check (sync when reconnected)
- Cache static assets (logo, fonts, icons)

### vercel.json
- SPA rewrites
- Security headers
- Cache control for static assets

---

## 10. MCP Server — Encouragement Engine

### Purpose
Dedicated MCP server that wraps Claude API calls for generating daily encouragement messages. Isolates AI from the rest of the app. Admin-gated.

### Endpoints
- `generate_messages` — Returns 7 draft messages
- `get_drafts` — Returns all pending drafts
- `approve_message` — Moves draft to posted status
- `reject_message` — Marks draft as rejected

### System Prompt (Locked in Server Config)
```
You are the encouragement writer for Royal Diadem, a mentoring program 
for young women ages 11–19. Generate exactly 7 short encouragement 
messages (2–3 sentences each).

TONE REQUIREMENTS:
- Scripture-based motivation that uplifts
- Warm humor — like a cool auntie, not a Sunday school teacher
- Confident and reassuring
- Directly affirm the reader ("You are...", "Your crown...")
- Faith-infused but welcoming to all backgrounds

ABSOLUTE RESTRICTIONS:
- NEVER sound prophetic, preachy, or fire-and-brimstone
- NEVER use dry, scary, or condescending language
- NEVER hallucinate scripture — only cite real verses with accurate text
- NEVER use language associated with white nationalist Christianity
- NEVER patronize or talk down to the reader
- Keep each message under 280 characters

Return as JSON array of 7 strings. No preamble. No markdown.
```

### Internal Hooks
- System prompt is immutable — not modifiable by user input
- Input sanitization on any admin-provided context
- Output validation: check message count = 7, check character limit, check for hallucinated verse patterns
- All generations logged with full metadata for audit

---

## 11. File Structure (Scaffold)

```
royal-diadem/
├── public/
│   ├── manifest.json
│   ├── sw.js
│   ├── icons/
│   └── assets/
│       └── royal-diadem-logo.png
├── src/
│   ├── config/
│   │   ├── branding.config.ts      # Single source of truth
│   │   ├── supabase.config.ts
│   │   └── routes.config.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── auth.ts                 # PIN + WebAuthn logic
│   │   ├── coppa.ts                # Consent management
│   │   └── flags.ts                # AI + peer flag logic
│   ├── hooks/
│   ├── components/
│   │   ├── ui/                     # Shared UI primitives
│   │   ├── student/                # Student-facing components
│   │   │   ├── CrownCheck.tsx
│   │   │   ├── Journal.tsx
│   │   │   ├── Relaxation.tsx
│   │   │   ├── ShareFeed.tsx
│   │   │   ├── Calendar.tsx
│   │   │   ├── Announcements.tsx
│   │   │   ├── DailyMessage.tsx
│   │   │   ├── AboutUs.tsx
│   │   │   └── Profile.tsx
│   │   └── admin/                  # Admin panel components
│   │       ├── Dashboard.tsx
│   │       ├── StudentRoster.tsx
│   │       ├── CrownCheckTrends.tsx
│   │       ├── JournalReview.tsx
│   │       ├── EncouragementEngine.tsx
│   │       ├── CalendarManager.tsx
│   │       ├── AnnouncementManager.tsx
│   │       ├── ShareModeration.tsx
│   │       ├── FlagCenter.tsx
│   │       ├── EnrollmentManager.tsx
│   │       └── Settings.tsx
│   ├── layouts/
│   │   ├── StudentLayout.tsx       # Mobile app shell, bottom nav
│   │   └── AdminLayout.tsx         # Desktop file cabinet, sidebar
│   ├── pages/
│   ├── types/
│   │   └── index.ts                # All TypeScript interfaces
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   ├── migrations/
│   └── functions/
│       └── encouragement-engine/   # MCP server Edge Function
├── CLAUDE.md                       # Governance rules
├── vercel.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 12. Open Items — Needs from Kenecia

- [ ] Tagline / slogan for the app
- [ ] Pastor Kenecia Duncan bio text + photo
- [ ] About Royal Diadem copy (updated from 2007/2010 version)
- [ ] Preferred display font (or approve our selection)
- [ ] Any specific scripture passages she wants in rotation for encouragement
- [ ] Relaxation tool: any specific exercises or content she uses in the program?
- [ ] Moderation preference: pre-approve all Share posts, or post-approve (review after)?
- [ ] Crown Check mood scale: approve the 5-tier emoji scale
- [ ] Custom domain preference (if any)
- [ ] Confirm age range: 11–19 (this means COPPA applies to 11–12 year olds)

---

## 13. Build Order (Recommended)

1. **Foundation:** Project scaffold, branding config, Supabase schema, PWA setup, CLAUDE.md
2. **Auth:** PIN generation, hashing, login flow, WebAuthn registration, COPPA consent gate
3. **Admin Panel Shell:** File cabinet layout, sidebar navigation, routing
4. **Student Enrollment:** Bulk upload + individual add, PIN distribution
5. **Crown Check:** Student-facing + admin trend view + AI flag logic
6. **Journal:** Student write + mentor review + AI flag logic
7. **Encouragement Engine:** MCP server, Claude-in-Claude, admin draft/approve workflow
8. **Daily Message Display:** Student-facing daily message component
9. **Calendar + Announcements:** Admin CRUD + student read views
10. **Share Page:** Posts, photos, comments, reactions, moderation, peer flagging
11. **Relaxation Tool:** Breathing exercises, calming content
12. **About Us:** Static content pages
13. **Profiles:** Student profile cards
14. **Flag Center:** Unified admin view of all flags
15. **Service Worker:** Offline support, sync queue
16. **Polish:** Animations, transitions, final branding pass

---

*Document version: 1.0*
*Created: April 12, 2026*
*Builder: Maria Denise LeBlanc / Envision VirtualEdge Group LLC*
*Client: Royal Diadem Inc. / Pastor Kenecia Duncan*
