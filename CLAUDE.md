# CLAUDE.md — Governance & Engineering Standards

> AUDIENCE: this document is written for an AI coding agent, not a human. Read it in full at the
> start of every session and treat it as binding instructions. It governs *how* we build.
> The Master Spec governs *what* we build. When this file conflicts with your defaults, habits, or
> training, **this file wins.** When this file conflicts with an explicit human request, **say so
> and ask** before proceeding.

---

## 0. Prime Directives (apply to every action, every turn)

1. **There is time to do it right, but not time to do it twice.** Correctness over speed. No
   shortcut that creates rework. If "fast" and "right" disagree, choose right.
2. **Stop and ask when you do not know.** Do not guess, do not invent APIs/flags/file paths, do not
   assume intent. Verify against the actual code/docs, or ask. A blocked question costs minutes; a
   wrong assumption costs days.
3. **Do not over-optimize.** Build what is needed, well. No speculative abstraction, no premature
   performance work, no "while I'm here" rewrites. Solve the actual problem.
4. **Be a surgeon, never a butcher.** Make the smallest precise change that fully solves the problem.
   Touch only what the task requires. Never mass-delete, mass-refactor, reformat, or "clean up"
   unrelated code without explicit approval. Understand before you cut.
5. **No half-done work.** Not "done" until typed, linted, tested (real, all passing), error-handled,
   and meeting the Definition of Done (§13). "It mostly works" is not done.
6. **The human approves.** AI suggests; the human decides. Mandatory for anything touching minors'
   data, money, security, deletion, migrations, or external communication — propose, then wait.
7. **Verify, do not assume success.** After a change, actually run the types/lint/tests and read the
   output. Report real results. If something failed, say so with the output. Never claim done on
   faith.
8. **Read before you write.** Read the existing code, conventions, and neighbors before editing.
   Match the surrounding style. Do not introduce a new pattern when one already exists.

---

## 1. Governance (Royal Diadem — minors' safety)

- Platform for **at-risk young women ages 11–19**. Safety and dignity before features.
- **No AI communicates directly with a minor unsupervised.** All AI output (e.g. encouragement
  messages) is admin-reviewed before any student sees it.
- **COPPA from day one** — no child data collected before verified guardian consent.
- AI guardrails are enforced at the **tool/server layer**, not the prompt layer (prompts can be
  injected; server validation cannot be talked around).
- SIC Method™ gate for every feature: (1) Does it serve the product? (2) Can the AI-assisted
  workflow sustain it? (3) Can a new hire run it from this doc without the builder?

---

## 2. Stop-and-Ask list (never proceed on assumption)

- Deleting files; dropping tables/columns; any destructive migration.
- Adding a dependency, framework, or external service.
- Changing auth, RLS, grants, secrets, or anything security-related.
- Changing the public contract (signature/return/behavior) of a shared module.
- Sending data to an external service or contacting a user.
- Touching minors' PII or consent records.
- Ambiguous/underspecified requirements, or the spec is silent. **Silence is not permission.**

---

## 3. Hard gates (code that violates these is not done)

- **No `any`** (TS), no untyped/`Any` (Python) — see §4, §5.
- **Lint + format clean, zero warnings.** Do not disable rules to pass; fix the cause. Any
  `eslint-disable`/`# noqa`/`# type: ignore` requires an inline justification and is a rare exception.
- **Strict type checking on**, no type errors.
- **Real tests, 100% passing, 0 skipped** — §11.
- **Errors handled, no silent failures** — §12.
- **Rate limiting on public/abuse-prone endpoints** — §10.
- **No secrets in client code or commits** — see `docs/SUPABASE_RULES.md`.
- **No dead code, debug logs, or leftover TODOs** in delivered work.

---

## 4. TypeScript — mistakes (DON'T → DO → WHY)

> Dominant failure mode: **silencing the type checker instead of satisfying it.** Never do that.

### 4.1 Types & the type checker
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| `any` (explicit or implicit) | Precise type, generic, or `unknown` + narrowing | `any` disables checking and spreads silently |
| `value as SomeType` to force it | Validate/parse (e.g. `zod`) or narrow | Casts lie to the compiler; runtime shape may differ |
| `as unknown as T` | Fix the real mismatch | "I give up" in syntax form; hides bugs |
| `@ts-ignore` / `@ts-expect-error` | Resolve the error | Suppression ships the bug |
| `value!` non-null assertion | Check and handle null/undefined | Asserts a lie; runtime crash |
| `Function`, `Object`, `{}`, `any[]` | Specific signatures / `Record<K,V>` / `unknown[]` | These accept almost anything |
| `[k: string]: any` index signatures | Define the real shape | `any` through the back door |
| `enum` by default | `as const` union types | Enums have runtime cost + quirks |
| Trusting `JSON.parse`/`fetch` results | Parse then **validate** against a schema | External data is `any`-shaped and untrusted |
| Inconsistent return shapes | One type, discriminated union if needed | Callers can't reason about it |
| `// @ts-nocheck` on a file | Type the file | Blinds the checker for the whole module |
| Optional everything `x?: T` | Model required vs optional honestly | Hides missing-data bugs |

### 4.2 Async & control flow
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Floating promise `doAsync()` | `await` it or handle `.catch()` | Unhandled rejection, races, silent loss |
| `await` inside a loop for independent work | `Promise.all` / batched | Serial latency; but keep ordered when dependent |
| `Promise.all` ignoring a rejection | Handle partial failure (`allSettled` when apt) | One failure rejects the batch |
| `async` function with no error handling | try/catch with context, or let a boundary catch | Silent failures |
| `catch (e) {}` empty | Handle, log w/ context, or rethrow; type `e: unknown` | Invisible production failures |
| Mixing `await` and `.then()` chains | Pick one style (prefer `await`) | Subtle ordering bugs |
| `setTimeout`/intervals without clearing | Clear on cleanup | Leaks, double-fires |

### 4.3 Correctness & semantics
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| `==` / `!=` | `===` / `!==` | Coercion surprises (`0 == ''`, `null == undefined`) |
| Mutating props/state/args | Return new values; treat inputs immutable | Hidden side effects, broken renders |
| `var` | `const` default, `let` when reassigned | Hoisting/scoping bugs |
| `number` for money/db ids | integer cents; string ids | Float math + id precision loss |
| `new Date(str)` ignoring tz | Store UTC, format at the edge | Off-by-hours across users |
| `parseInt(x)` no radix | `parseInt(x, 10)` / `Number()` | Surprising base parsing |
| Array methods that mutate (`sort`,`reverse`,`splice`) on shared arrays | Copy first (`[...a].sort()`) | Mutates caller's data |
| Truthiness checks on `0`/`''`/`false` | Explicit `=== undefined`/`=== null` | Valid falsy values get dropped |

### 4.4 React / frontend
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Array index as `key` | Stable unique id | Index keys corrupt list state on reorder |
| `useEffect` wrong/missing deps | Correct deps; extract stable callbacks | Stale closures or infinite loops |
| Effects/listeners/subscriptions w/o cleanup | Return cleanup fn | Leaks, ghost state after unmount |
| Derived state stored in `useState` | Compute during render / `useMemo` if costly | State desync bugs |
| Fetch with only a success path | Handle loading/empty/error explicitly | Hanging spinners on failure |
| Prop drilling everything | Context/composition where appropriate | Unmaintainable; but don't over-engineer |
| Inline new objects/fns as deps each render | Memoize when it matters | Needless re-renders / effect loops |
| `dangerouslySetInnerHTML` with user content | Sanitize or avoid | XSS |
| No Error Boundary | Wrap app + major routes | One crash = white screen for a kid on a phone |

### 4.5 Project-specific
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Hardcode colors/names/logos/URLs | Read from branding/config (Spec §3) | White-label is non-negotiable |
| Secrets via `VITE_` | Client = public keys only; secrets server-side | `VITE_*` is shipped to the browser |
| `import _ from 'lodash'` (whole lib) | Import one function or use native | Bundle bloat (PWA budget) |
| Deep relative imports `../../../..` | Path aliases | Fragile; breaks on move |
| Magic strings/numbers | Named constants/config | One source of truth |
| `console.log` left in | Remove or use a leveled logger | Noise + data leaks |

**Config:** `tsconfig` `strict: true`, `noUncheckedIndexedAccess`, `noImplicitAny`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes` where feasible.
ESLint `@typescript-eslint` strict + `no-floating-promises`, `no-explicit-any`, `no-unsafe-*` as
**errors**. Prettier enforced.

---

## 5. Python — mistakes (DON'T → DO → WHY)

### 5.1 Errors & control flow
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| `except:` / `except Exception: pass` | Catch specific exceptions; handle or re-raise w/ context | Hides bugs; swallows `KeyboardInterrupt`/`SystemExit` |
| Return `None` to signal error | Raise a specific exception (or `Result` type) | Silent `None` crashes far from the cause |
| Catch then `print`/`pass` and continue | Recover, retry (bounded), or fail loudly | Half-handled errors leave corrupt state |
| `assert` for runtime validation | Explicit `if ...: raise` | `assert` is stripped under `-O` |
| Broad `try` around many statements | Wrap only the line that can fail | Masks where the error came from |

### 5.2 Types & data
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| No type hints / `Any` | Full hints; `mypy`/`pyright` strict | Untyped Python rots; `Any` defeats checking |
| Validate dicts by hand | `pydantic`/dataclasses | Typed, centralized input boundaries |
| `== None` / `== True` | `is None` / truthiness | Identity vs equality |
| `==` on floats | `math.isclose()` | Floats aren't exactly comparable |
| Mutable default arg `def f(x=[])` | `x=None` then `x = x or []` | Default shared across all calls |
| Mutating a list while iterating | Iterate a copy / build new | Skips elements |
| Shadowing builtins (`list`,`id`,`type`,`dict`,`input`) | Rename | Breaks the builtin later |

### 5.3 I/O, time, process
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| `open(f)` without `with` | `with open(...) as fh:` | Leaks handles; not exception-safe |
| Read/write without `encoding` | `encoding="utf-8"` | Locale-dependent decode failures |
| `os.path` string juggling | `pathlib.Path` | Cross-platform, safer |
| Naive `datetime.now()` | `datetime.now(timezone.utc)` | Naive datetimes corrupt tz logic |
| `requests.get(url)` no timeout | Always `timeout=` | A hung dependency hangs the service |
| `print()` for diagnostics | `logging` w/ levels | Can't filter/route; leaks in prod |
| `subprocess(..., shell=True)` w/ input | `shell=False`, arg list | Shell injection |

### 5.4 Security & concurrency
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| f-string/`%` SQL with input | Parameterized queries / ORM binding | SQL injection |
| Secrets in code / committed `.env` | Env + secret manager; `.env` gitignored | Leaked credentials |
| Blocking I/O in `async def` | Async libs or `run_in_executor` | Stalls the event loop |
| Global mutable state | Pass deps explicitly | Hidden coupling; race conditions; untestable |
| `eval`/`exec`/`pickle` on untrusted input | Safe parsers (`json`, `ast.literal_eval`) | RCE |
| `from module import *` | Import names explicitly | Namespace pollution/shadowing |

**Config:** `ruff` (lint+format) clean; `mypy`/`pyright` strict; `pytest`. No suppression without an
inline justified `# noqa: CODE  # reason` / `# type: ignore[code]  # reason`.

---

## 6. Cross-cutting — security mistakes (any language)
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Trust client-sent ids/roles | Authorize server-side against the session | Client is hostile/forgeable |
| Validate only on the client | Validate on the server too | Client checks are bypassable |
| Log secrets/PII/tokens | Redact; log ids not contents | Logs leak; minors' data is sensitive |
| Verbose errors to the client | Generic message + status; detail server-side | Leaks internals/attack surface |
| Reflect user input into HTML | Sanitize/escape | XSS |
| Long-lived/global API keys in app | Scoped, server-only, rotatable keys | Blast radius on leak |
| Skip authz "because UI hides it" | Enforce on every endpoint | UI is not a security boundary |
| Compare secrets with `==` | Constant-time compare | Timing attacks |

---

## 7. Concurrency & data integrity
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Read-modify-write without atomicity | Transactions / atomic ops / optimistic locking | Lost updates under concurrency |
| Assume operations run in order | Make idempotent; use keys | Retries/races duplicate effects |
| N+1 queries in a loop | Batch / join / `in (...)` | Performance collapse at scale |
| No pagination on list endpoints | Paginate + bound page size | Unbounded payloads/DoS |
| Ignore migration ↔ code ordering | Backward-compatible migrations | Deploy-time breakage |

---

## 8. Dependencies & tooling
| ❌ Don't | ✅ Do | Why |
|---------|------|-----|
| Add a dep for a trivial helper | Write the few lines | Supply-chain + bundle cost |
| Unpinned/loose versions | Pin + lockfile committed | Reproducible builds |
| Add a dep without asking | Stop and ask (§2) | Scope/security/licensing |
| Upgrade majors mid-task | Separate, reviewed change | Hidden breakage |
| Ignore audit warnings | Triage known vulns | Shipping CVEs |

---

## 9. Git & workflow hygiene
- Never commit/push unless asked. If on `main`, branch first.
- Commits: small, focused, one logical change; clear messages.
- Never commit secrets, `.env`, build artifacts, or `node_modules`.
- Never force-push shared branches or rewrite shared history without approval.
- Don't bundle unrelated changes (surgeon, not butcher).

---

## 10. Rate limiting
- **Every public/abuse-prone endpoint** is rate limited — PIN/login, COPPA consent, share-post, flag
  submission, any AI-invoking endpoint.
- **PIN/login:** strict attempt limiting + lockout/backoff (short hashed PINs are brute-forceable).
  Pair with Turnstile (`docs/SUPABASE_RULES.md` §6).
- **AI endpoints:** rate limit *and* cap usage (cost); admin-gated; never an unbounded client-facing
  AI endpoint.
- **Server-side** (Edge Function/gateway), keyed by identity + IP, returning `429` + `Retry-After`.
  Client debounce is UX, not security.
- **Fail closed:** limiter unavailable → deny.

---

## 11. Testing — real tests, 100% pass, 0 skipped
- **Real tests against real behavior.** Mock only true external boundaries (3rd-party network, time,
  randomness). Never mock away the thing under test.
- **No fake-green:** no `.skip`, `xit`, `it.only` left in, `@pytest.mark.skip`, commented-out tests,
  `expect(true).toBe(true)`, or assertions that cannot fail.
- **100% passing, 0 skipped, 0 todo.** A skipped test is an untested path lying about coverage. If a
  test can't pass yet, the feature isn't done — finish it or stop and ask.
- **Cover unhappy paths:** null/empty, auth failure, permission denied, rate-limit hit, network
  error, malformed data.
- **Independent & deterministic:** no shared mutable state, no order dependence, no real clock/network
  unless an explicit integration test.
- **Bug fix = failing test first**, then the fix makes it pass.
- A feature with no tests is incomplete.

---

## 12. Error boundaries & error handling
- **React:** Error Boundary around the app and each major route/feature → calm fallback, not a white
  screen. Boundaries log server-side, never show stack traces to the user.
- **Async UI:** every fetch handles loading/empty/error. No infinite spinner on failure.
- **Server/Edge Functions:** fail closed (`docs/SUPABASE_RULES.md` §8). Catch specific errors, log
  with context server-side, return generic safe message + correct status. Never leak internals.
- **No silent catches.** Every catch recovers, retries (bounded), or rethrows.
- **Validate at every trust boundary:** client input, payloads, env at startup, external responses.

---

## 13. Definition of Done
A task is done only when ALL are true:
- [ ] Solves exactly what was asked — no scope creep, no less.
- [ ] No `any`/`Any`; strict type check passes; no type errors.
- [ ] Lint+format clean, zero warnings; no rule disabled without justified inline reason.
- [ ] Real tests added/updated; **100% pass, 0 skipped**; unhappy paths covered.
- [ ] Errors handled; boundaries in place; no silent catches; safe messages.
- [ ] Security: no secrets committed; rate limits where required; input validated; RLS/grants per
      `docs/SUPABASE_RULES.md`.
- [ ] Surgical: only intended files changed; no unrelated edits/refactors.
- [ ] No debug logs / dead code / leftover TODOs.
- [ ] Verified by actually running types/lint/tests and reading the output.
- [ ] Uncertainty → stopped and asked, did not guess.

---

## 14. References
- **`docs/SUPABASE_RULES.md`** — keys, Data API grants, migrations, Turnstile, storage, Edge
  Functions. Read before any backend work; overrides the spec on those topics.
- **`Royal_Diadem_Master_Spec.md`** — what we build (features, schema, branding, build order).

---

*AI session: apply §0 every turn. When in doubt, stop and ask. Be a surgeon, never a butcher.*
