#!/usr/bin/env bash
# CLAUDE.md enforcement guard.
# Fires on PreToolUse(Bash); acts only when the command contains `git commit`.
# Blocks the commit (deny) if staged changes violate CLAUDE.md §3/§11:
#   - introduce `any` (typed) in TypeScript
#   - introduce @ts-ignore / @ts-nocheck
#   - introduce console.* (use the audit logger only; logger/audit files are exempt)
#   - introduce a skipped/focused test (.skip/.only/xit/fit/@pytest.mark.skip/...)
#   - fail the lint / typecheck / test gates (only run if that npm script exists)
# Scans ADDED lines only (git diff --cached), so it flags what THIS commit introduces.
# Markdown/docs and this script are never scanned (only *.ts/*.tsx and test files are).
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
  added="$(git diff --cached -U0 -- "$f" 2>/dev/null | grep -E '^\+[^+]' || true)"
  [ -n "$added" ] || continue

  case "$f" in
    *.ts|*.tsx)
      hit="$(printf '%s\n' "$added" | grep -nE '(:[[:space:]]*any\b|<any>|as[[:space:]]+any\b|\bany\[\]|Array<any>|,[[:space:]]*any>)' || true)"
      [ -n "$hit" ] && violations+=("no-any — $f introduces \`any\`:"$'\n'"$hit")
      ig="$(printf '%s\n' "$added" | grep -nE '@ts-ignore|@ts-nocheck' || true)"
      [ -n "$ig" ] && violations+=("no-suppress — $f introduces @ts-ignore/@ts-nocheck:"$'\n'"$ig")
      # console.* is banned (audit logger only); exempt the logger/audit implementation files.
      case "$f" in
        *logger*|*Logger*|*audit*|*Audit*) : ;;
        *)
          cl="$(printf '%s\n' "$added" | grep -nE '\bconsole\.[a-zA-Z]' || true)"
          [ -n "$cl" ] && violations+=("no-console — $f uses console.* (use the audit logger):"$'\n'"$cl")
          ;;
      esac
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
