#!/usr/bin/env bash
# CLAUDE.md enforcement guard.
# Fires on PreToolUse(Bash); acts only when the command contains `git commit`.
# Blocks the commit (deny) if staged changes violate CLAUDE.md §3/§11:
#   - introduce `any` (typed) in TypeScript
#   - introduce @ts-ignore / @ts-nocheck / @ts-expect-error / `as unknown as`
#   - introduce an eslint-disable without an inline `-- reason` justification
#   - introduce console.* (use the audit logger only; logger/audit files are exempt)
#   - introduce TODO/FIXME/HACK/XXX or not-implemented stubs in code files (§0.11)
#   - introduce a credential-shaped literal (private key, API key, JWT, VITE_ secret)
#     in ANY file, or stage a .env/*.local file at all
#   - write to client storage (localStorage/sessionStorage/cookies/IndexedDB) in src/
#     non-test code (§3: no PHI/PII in client storage)
#   - introduce a skipped/focused test (.skip/.only/xit/fit/@pytest.mark.skip/...)
#   - fail the lint / typecheck / test gates (only run if that npm script exists)
# Scans ADDED lines only (git diff --cached), so it flags what THIS commit introduces.
# node_modules/dist are never scanned. Markdown is scanned for secrets only.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"

# Only act on git commits; allow every other Bash command instantly.
case "$cmd" in
  *"git commit"*) : ;;
  *) exit 0 ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

violations=()

mapfile -t staged < <(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

is_test() {
  case "$1" in
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) return 0 ;;
    */__tests__/*) return 0 ;;
    test_*.py|*_test.py|*/test_*.py|*/tests/*.py|*/test/*.py) return 0 ;;
  esac
  return 1
}

for f in "${staged[@]:-}"; do
  [ -n "$f" ] || continue

  # Vendored/build output is never ours to police; this guard exempts itself
  # (its grep patterns literally contain the strings it bans).
  case "$f" in
    node_modules/*|*/node_modules/*|dist/*|*/dist/*|.claude/hooks/*) continue ;;
  esac

  # Secret-bearing files are never committed, whatever they contain.
  case "$f" in
    .env|.env.*|*/.env|*/.env.*)
      case "$f" in
        *.example|*.sample) : ;;
        *) violations+=("no-secret-files — $f: .env files are never committed (docs/SUPABASE_RULES.md)") ;;
      esac
      ;;
    *.local|*/*.local)
      violations+=("no-secret-files — $f: *.local files are never committed")
      ;;
  esac

  added="$(git diff --cached -U0 -- "$f" 2>/dev/null | grep -E '^\+[^+]' || true)"
  [ -n "$added" ] || continue

  # Secrets scan — every file type, tests and docs included.
  sec="$(printf '%s\n' "$added" | grep -nE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|sbp_[A-Za-z0-9]{16,}|sb_secret_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}|VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)' || true)"
  [ -n "$sec" ] && violations+=("no-secrets — $f introduces a credential-shaped literal (rotate it if real; secrets live server-side only):"$'\n'"$sec")

  # Stub/deferral markers — code files only (§0.11: build the real thing).
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.sql|*.sh)
      td="$(printf '%s\n' "$added" | grep -nE '\b(TODO|FIXME|HACK|XXX)\b|NotImplementedError|[Nn]ot [Ii]mplemented' || true)"
      [ -n "$td" ] && violations+=("no-stubs — $f introduces a TODO/FIXME/stub marker (§0.11 — build it or stop and ask):"$'\n'"$td")
      ;;
  esac

  case "$f" in
    *.ts|*.tsx)
      hit="$(printf '%s\n' "$added" | grep -nE '(:[[:space:]]*any\b|<any>|as[[:space:]]+any\b|\bany\[\]|Array<any>|,[[:space:]]*any>)' || true)"
      [ -n "$hit" ] && violations+=("no-any — $f introduces \`any\`:"$'\n'"$hit")
      ig="$(printf '%s\n' "$added" | grep -nE '@ts-ignore|@ts-nocheck|@ts-expect-error|\bas[[:space:]]+unknown[[:space:]]+as\b' || true)"
      [ -n "$ig" ] && violations+=("no-suppress — $f introduces a type-checker suppression (@ts-*/as unknown as):"$'\n'"$ig")
      ed="$(printf '%s\n' "$added" | grep -nE 'eslint-disable' | grep -vF ' -- ' || true)"
      [ -n "$ed" ] && violations+=("no-unjustified-disable — $f introduces eslint-disable without an inline \`-- reason\` (§3):"$'\n'"$ed")
      # Client storage is off-limits for app code (§3: no PHI/PII in client storage).
      # Tests are exempt (they assert storage stays empty / gets cleared).
      if ! is_test "$f"; then
        case "$f" in
          src/*)
            st="$(printf '%s\n' "$added" | grep -nE '\b(localStorage|sessionStorage)\.[A-Za-z]|document\.cookie|indexedDB\.' || true)"
            [ -n "$st" ] && violations+=("no-client-storage — $f touches localStorage/sessionStorage/cookies/IndexedDB (§3):"$'\n'"$st")
            ;;
        esac
      fi
      # console.* is banned (audit logger only); exempt the logger/audit implementation files.
      case "$f" in
        *logger*|*Logger*|*audit*|*Audit*) : ;;
        *)
          cl="$(printf '%s\n' "$added" | grep -nE '\bconsole\.[a-zA-Z]' || true)"
          [ -n "$cl" ] && violations+=("no-console — $f uses console.* (use the audit logger):"$'\n'"$cl")
          ;;
      esac
      ;;
    *.py)
      nq="$(printf '%s\n' "$added" | grep -nE '#[[:space:]]*(noqa|type:[[:space:]]*ignore)' | grep -vE '(noqa|type:[[:space:]]*ignore)[^#]*#[[:space:]]*[A-Za-z]' || true)"
      [ -n "$nq" ] && violations+=("no-unjustified-suppress — $f introduces # noqa / # type: ignore without an inline reason (§5):"$'\n'"$nq")
      ;;
  esac

  if is_test "$f"; then
    sk="$(printf '%s\n' "$added" | grep -nE '(\.skip\(|\.only\(|\bxit\(|\bxdescribe\(|\bfit\(|\bfdescribe\(|@pytest\.mark\.skip|@unittest\.skip|pytest\.skip\()' || true)"
    [ -n "$sk" ] && violations+=("no-skipped-tests — $f introduces a skipped/focused test:"$'\n'"$sk")
  fi
done

run_gate() {
  local label="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    return 0
  fi
  violations+=("gate-failed ($label) — \`$*\` exited nonzero:"$'\n'"$(printf '%s\n' "$out" | tail -n 30)")
  return 1
}

# Gates run only if the tooling exists, so this hook is a no-op until the project is scaffolded.
# NOTE: the `test` npm script MUST run once and exit (e.g. `vitest run`, not watch mode), or the
# hook will hang until its timeout.
if [ -f package.json ] && command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  has_script() { node -e "process.exit(((require('./package.json').scripts||{})['$1'])?0:1)" 2>/dev/null; }
  has_script lint      && run_gate "lint" npm run --silent lint
  has_script typecheck && run_gate "typecheck" npm run --silent typecheck
  has_script test      && run_gate "test" npm test --silent
fi

if [ "${#violations[@]}" -eq 0 ]; then
  exit 0
fi

reason="🚫 CLAUDE.md enforcement blocked this commit (CLAUDE.md §3 hard gates, §11 testing). Fix the cause — do NOT disable rules or bypass with --no-verify:"$'\n\n'
for v in "${violations[@]}"; do
  reason+="• ${v}"$'\n\n'
done
reason+="A deliberate, justified exception requires human approval first (CLAUDE.md §0.6 / §2)."

jq -cn --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
