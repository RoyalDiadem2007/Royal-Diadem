# Supabase Rules — Royal Diadem (READ BEFORE ANY SUPABASE WORK)

> **Purpose:** Supabase changed its API-key model and its Data API exposure defaults in 2026.
> The original Master Spec (April 2026) is out of date on these points. **This file overrides the
> spec wherever they conflict.** Claude Code must follow these rules every time it touches
> Supabase config, env vars, migrations, RLS, or Edge Functions.
>
> _Last verified against Supabase docs: July 16, 2026._

---

## TL;DR for every session

1. **No `anon` / `service_role` keys.** Use **publishable** (`sb_publishable_…`) on the client and
   **secret** (`sb_secret_…`) server-side only.
2. **Tables are NOT auto-exposed to the API.** Every migration must explicitly `GRANT` + enable
   RLS + add policies, as one unit.
3. **Never push migrations via the Supabase MCP** — it truncates filenames and does not land on both
   local + remote. Use the **Supabase CLI** (`supabase migration new` → `supabase db push`).
   MCP is **read-only** for us (list tables, advisors, logs).
4. **Never commit a key.** Secret keys are auto-revoked by Supabase if detected in a public repo.

---

## 1. API Keys — new model (replaces anon + service_role)

Legacy long-lived JWT `anon` and `service_role` keys are superseded by the new key pair. As of
July 2026 the docs give **no hard removal date** — legacy keys keep working until manually
deactivated in the Dashboard — but they are legacy; **never use them in this project.**

| Key | Format | Where it lives | Privilege |
|-----|--------|----------------|-----------|
| **Publishable** | `sb_publishable_…` | Client: web/PWA, mobile, anything shipped to users | Low — same as old `anon`. Safe to ship. |
| **Secret** | `sb_secret_…` | Server only: Edge Functions, backend, workers | High — **bypasses RLS**, full data access. Multiple, named, revocable. |

### Rules
- Secret keys are **browser-blocked**: if used from a browser User-Agent, Supabase returns **HTTP 401**.
  Never put a secret key in any `VITE_*` variable or client bundle.
- Send keys on the **`apikey` header only**. Do **not** use `Authorization: Bearer <key>` with these
  keys — the platform tries to JWT-parse it and rejects with `Invalid JWT`.
  - Database Webhooks / `pg_net`: use header `apikey: sb_secret_…` (not `Authorization: Bearer …`).
- Keys can be rotated/revoked instantly and audited. Prefer named secret keys per surface.
- **GitHub protection:** Supabase auto-revokes secret keys found in public repos — another reason
  for the gitleaks/secret-scanning setup. Do not rely on it; never commit keys in the first place.

### Env var naming for THIS project
**Client (Vite — public, safe):**
```
VITE_SUPABASE_URL=https://luvthaezikvssnuegviu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```
**Server (Vercel server env only — secret, never VITE_):**
```
SUPABASE_SECRET_KEY=sb_secret_xxx
```
> In Supabase Edge Functions, do **not** set this yourself — `SUPABASE_`/`SB_` prefixes are
> reserved (§8) and the platform already injects `SUPABASE_PUBLISHABLE_KEYS` and
> `SUPABASE_SECRET_KEYS` as **JSON objects keyed by name**, e.g.
> `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']`.

---

## 2. Data API exposure — explicit grants required (breaking change)

As of **May 30, 2026** (new projects) and **October 30, 2026** (all existing projects), new tables in
the `public` schema are **no longer auto-exposed** to the REST/GraphQL Data API. A table is invisible
to the API until you explicitly `GRANT` privileges to the relevant role.

### Every migration that creates a table must do all three, together:
```sql
-- 1. Grant Data API privileges (per role — anon and authenticated differ deliberately)
grant select on public.your_table to anon;
grant select, insert, update, delete on public.your_table to authenticated;
grant select, insert, update, delete on public.your_table to service_role;

-- 2. Enable Row Level Security
alter table public.your_table enable row level security;

-- 3. Add policies (RLS denies everything until a policy allows it)
create policy "describe the rule"
  on public.your_table
  for select
  to authenticated
  using (true);  -- replace with the real predicate
```

### Opt an existing project into the new behavior early (run once)
```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
```
Existing objects keep their current grants, so a running app stays reachable.

---

## 3. ⚠️ THIS PROJECT USES CUSTOM PIN AUTH — read carefully

Royal Diadem does **not** use Supabase Auth sessions (Spec §8: "PIN-based … RLS policies use custom
session management, not `auth.uid()`"). That has direct consequences for the grant/RLS model above:

- With no Supabase Auth, the client (publishable key) maps to the **`anon`** role. There is **no
  `authenticated` JWT session** and **`auth.uid()` is unavailable** in policies.
- **Therefore: do not write client-facing RLS that depends on `auth.uid()`.** It will not work.

### Required pattern for this project (children's data — safety first)
- **Lock the `anon` role down to (near) nothing.** Do not grant broad client access to tables holding
  minors' data (students, journals, crown_checks, guardians, flags).
- **Route all reads/writes through Edge Functions** that:
  1. Verify the app's own PIN / WebAuthn session, then
  2. Use the **secret key** server-side to read/write, with RLS still enabled as defense-in-depth.
- Only genuinely public, post-moderation content (e.g. approved announcements) may get a narrow
  direct `anon select` grant — and only with an RLS policy that restricts it to approved rows.
- If we ever need direct client RLS, it must be via **custom JWTs** we mint and sign (carrying a role
  + student id claim) — not Supabase Auth. Flag this for human approval before building it.

---

## 4. Migrations — workflow (MCP cannot do this)

- **Author** migrations as files: `supabase migration new <name>` → edit the generated SQL.
- **Apply** with the CLI: `supabase db push` (keeps local + remote in sync, correct filenames).
- **Do NOT** use the MCP `apply_migration` tool: it **truncates the migration filename** and does not
  land on both local and remote. Known limitation — avoid entirely for schema changes.
- MCP tools we DO use (read-only): `list_tables`, `list_migrations`, `get_advisors`, `get_logs`,
  `list_extensions`. Use `get_advisors` after migrations to catch RLS/security gaps.

### Migration hygiene
- One concern per migration; reversible where possible.
- Always bundle grant + RLS + policy in the same migration (see §2).
- After applying, run `get_advisors` (security) and confirm RLS is on for every new table.

---

## 5. Project facts

- **Project ref:** `luvthaezikvssnuegviu` (`RoyalDiadem2007's Project`, region us-west-2)
- **Status as of June 2026:** ACTIVE_HEALTHY, **public schema empty** (no tables yet).
- **HIPAA note:** true HIPAA requires the Supabase **HIPAA add-on + signed BAA** — a contract/org
  step, not a code step. Build the technical safeguards (encryption, audit logs, least privilege,
  RLS) to that standard regardless.

---

## 6. Cloudflare Turnstile — bot protection (COPPA-safe CAPTCHA)

Turnstile guards: **login (before PIN submit), the COPPA consent form, and Share-page posts**
(Spec §3). Chosen over reCAPTCHA because it does **no user tracking** — appropriate for minors.

### How it works (two halves)
- **Client:** one script tag + a widget that produces a short-lived token. The widget uses the
  **site key** (public, safe to ship — `VITE_TURNSTILE_SITE_KEY`).
- **Server:** you MUST verify the token server-side before trusting the action. Verification uses the
  **secret key** (server-only — never `VITE_*`).

### Server-side verification (in a Supabase Edge Function — NOT the client)
- Endpoint: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Send `secret`, `response` (the token), optionally `remoteip`, and an **`idempotency_key`**.
- Token rules: valid **300s (5 min)**, **single-use**. A replayed token fails with
  `timeout-or-duplicate`.
- **Always use an `idempotency_key`** (a UUID you generate per attempt) so a network timeout +
  retry doesn't get falsely rejected as a duplicate — important on flaky phone connections.
- Treat verification as **fail-closed**: if `success !== true`, reject the action.

```ts
// inside an Edge Function, before processing login / consent / share-post
const form = new FormData();
form.append("secret", Deno.env.get("TURNSTILE_SECRET_KEY")!);
form.append("response", token);          // from the client
form.append("idempotency_key", attemptId); // a UUID you generated for this attempt
// form.append("remoteip", clientIp);     // optional

const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
  method: "POST",
  body: form,
});
const outcome = await res.json();
if (outcome.success !== true) {
  return new Response("Bot check failed", { status: 403 });
}
// ...proceed with the protected action
```

### Env vars
```
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAA...        # client, public
TURNSTILE_SECRET_KEY=0x4AAAAAAA...           # Edge Function / server only — NEVER VITE_
```

### Rules
- **Never** verify a Turnstile token on the client — verification is server-side only.
- Turnstile is **not** authentication. It gates *who can attempt* an action; the PIN/WebAuthn check
  still decides *who is authorized*. Run Turnstile verification first, then the auth check.
- Dev/testing: Cloudflare provides always-pass / always-fail test keys — use those locally, never
  the real secret in client code or commits.

---

## 7. Storage buckets — policies (private by default, served via signed URLs)

Buckets from Spec §8: `profile-photos`, `share-media`, `about-images`, `branding`.

### ⚠️ Same custom-auth caveat as §3
Supabase Storage's built-in ownership and object policies derive identity from the JWT `sub` claim
(i.e. Supabase Auth). **This project has no Supabase Auth**, so `auth.uid()` and owner-based storage
policies **do not work**. Do not write storage RLS that assumes a logged-in Supabase user.

### Required pattern for this project
- **All buckets PRIVATE** (the default). Never make a bucket public — minors' photos must not be
  on a guessable public URL. (Possible exception: `branding`, which holds only the logo/brand assets
  and may be public if convenient — confirm with a human first.)
- **Uploads** go through an **Edge Function** that verifies the PIN/WebAuthn session, then writes
  using the **secret key** (which bypasses storage RLS). The client never uploads directly with the
  publishable key.
- **Downloads/serving** use **short-lived signed URLs** generated server-side
  (`createSignedUrl`) after the Edge Function confirms the requester is allowed to see that object.
  Never hand the client a permanent public URL for student media.
- **Path convention** for per-student isolation, e.g. `share-media/{student_id}/{post_id}.jpg` and
  `profile-photos/{student_id}.jpg`, so the Edge Function can authorize by path prefix.
- Defense-in-depth: keep RLS enabled on `storage.objects`. Because access flows through the secret
  key, the practical policy is "deny `anon`/`authenticated` direct access" and let the Edge Function
  mediate. Storage helper functions (`storage.foldername()`, `storage.filename()`) are available if
  we later move to custom JWTs.

### Per-bucket intent
| Bucket | Visibility | Who writes | Who reads |
|--------|-----------|------------|-----------|
| `profile-photos` | private | Edge Fn (owner/admin) | signed URL to the student + admins |
| `share-media` | private | Edge Fn after moderation/consent | signed URL to students (approved posts only) |
| `about-images` | private | Edge Fn (admin) | signed URL (public-facing About content) |
| `branding` | private (public OK if approved) | Edge Fn (admin) | app-wide |

---

## 8. Edge Functions — conventions (the trust boundary)

Edge Functions are where this app's real security lives. Because the client only holds the
publishable key (§1) and all sensitive reads/writes, Turnstile checks (§6), and storage access (§7)
flow through functions, **the Edge Function is the trust boundary.** Treat every function as
internet-facing and hostile-input-facing.

### The standard request pipeline (in this order — fail closed at each step)
1. **CORS / method check** — reject anything that isn't the expected method + origin.
2. **Turnstile verify** (only on login, consent, share-post) — §6, fail closed.
3. **Session auth** — verify the app's PIN/WebAuthn session token. No valid session → `401`.
   This replaces `auth.uid()`; the function resolves the `student_id`/`admin_id` itself.
4. **Authorization** — confirm *this* caller may touch *this* resource (own data, or admin role).
   Students may only act on their own rows; never trust an id sent from the client as proof.
5. **Input validation** — validate/parse the body (e.g. with `zod`) before use. Reject unknown
   fields. Never interpolate input into SQL — use parameterized queries / the client library.
6. **Do the work** — using the **secret key** (§1), with RLS still enabled as defense-in-depth.
7. **Audit log** — write an audit record (who/what/when) for any access to minors' data (§ HIPAA).
8. **Return** — minimal data, no internal errors leaked to the client.

### Hard rules
- **Secret key never leaves the server.** Read it from env inside the function only. Never return it,
  log it, or echo it.
- **Fail closed.** Any check that errors or is uncertain → deny. Default-deny everywhere.
- **One function = one responsibility.** Small, auditable functions over a mega-endpoint.
- **Validate every input.** Body, headers, and path params. Assume the client is compromised.
- **No secrets in error messages.** Log details server-side; return a generic message + status code.
- **Idempotency** for anything that mutates after an external call (Turnstile, payments-like flows).
- **Least privilege for the AI:** the Encouragement Engine function is the ONLY one that calls the
  Claude API, runs admin-gated, validates output (count = 7, ≤280 chars, no hallucinated scripture),
  and never posts directly (Spec §6.5/§10). The Claude API key is server-only env, like the secret key.

### Env access (new key model — see §1)
```ts
// Supabase injects these as JSON objects keyed by name in Edge Functions:
const secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!)["default"]; // sb_secret_...
// Plus our own explicitly-set secrets:
const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY")!;
const anthropicKey   = Deno.env.get("ANTHROPIC_API_KEY")!;
// Create a server client with the SECRET key (bypasses RLS — that's intended, server-side only):
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secret);
```

### Structure & deploy
- Live under `supabase/functions/<name>/index.ts` (Spec §11: `functions/encouragement-engine/`).
- Shared helpers (CORS, session verify, audit log, Turnstile verify) in
  `supabase/functions/_shared/` and imported — don't copy-paste the pipeline into each function.
- Deploy with the **CLI** (`supabase functions deploy <name>`) or MCP `deploy_edge_function`
  (deploy is fine via MCP — only *migrations* have the truncation bug, §4).
- Set secrets with `supabase secrets set KEY=value` — never commit them; never put them in `VITE_*`.
- **Reserved prefixes:** custom Edge Function secrets may NOT start with `SUPABASE_` or `SB_` —
  both are reserved for platform-injected variables (`SUPABASE_URL`, `SUPABASE_SECRET_KEYS`,
  `SB_REGION`, `SB_EXECUTION_ID`, …). Name our own secrets by service, e.g. `TURNSTILE_SECRET_KEY`,
  `ANTHROPIC_API_KEY`.
- A `verify_jwt` setting may need to be **off** for these functions since we use custom sessions, not
  Supabase Auth JWTs — confirm per function.

### CORS (PWA calls these from the browser)
- Allow only the app's real origin(s) in production (not `*`). Handle the `OPTIONS` preflight.
- Echo only the headers you actually use (`authorization`/your session header, `apikey`,
  `content-type`).

---

## Sources
- [Migrating to publishable and secret API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Upcoming changes to Supabase API Keys — Changelog](https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys)
- [Breaking Change: Tables not exposed to Data and GraphQL API automatically — Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Securing your API — Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Security Retro: 2025](https://supabase.com/blog/supabase-security-2025-retro)
- [Turnstile — Server-side validation — Cloudflare Docs](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Storage Access Control — Supabase Docs](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage Buckets Fundamentals — Supabase Docs](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Edge Functions — Supabase Docs](https://supabase.com/docs/guides/functions)
- [Edge Functions: Secrets / Environment Variables — Supabase Docs](https://supabase.com/docs/guides/functions/secrets)
