#!/bin/bash
# Stop hook: TypeScript check + change summary
set -euo pipefail

# Check if we're in a git repo with commits
if ! git rev-parse --is-inside-work-tree &> /dev/null; then
  exit 0
fi
if ! git rev-parse HEAD &>/dev/null 2>&1; then
  exit 0
fi

git_root=$(git rev-parse --show-toplevel)

# ═══ TypeScript Type Check (blocking) ═══
ts_files=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
if [[ -n "$ts_files" ]]; then
  # Find tsconfig
  tsconfig_dir=""
  for dir in "$git_root" "$git_root/react-app" "$git_root/src" "$git_root/app"; do
    if [[ -f "$dir/tsconfig.json" ]]; then
      tsconfig_dir="$dir"
      break
    fi
  done

  if [[ -n "$tsconfig_dir" ]]; then
    echo ""
    echo "═══════════════════════════════════════════"
    echo "         TYPESCRIPT TYPE CHECK"
    echo "═══════════════════════════════════════════"
    tsc_output=$(cd "$tsconfig_dir" && npx tsc --noEmit 2>&1) || true
    tsc_exit=$?
    if [[ $tsc_exit -ne 0 ]]; then
      echo "❌ TypeScript errors:"
      echo "$tsc_output"
      echo "Fix the errors above before finishing."
      exit 1
    else
      echo "✅ No TypeScript errors"
    fi
  fi
fi

# ═══ Change Summary (informational) ═══
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

echo ""
echo "═══════════════════════════════════════════"
echo "         SESSION CHANGE SUMMARY"
echo "═══════════════════════════════════════════"
echo ""
echo "📊 Stats:"
git diff --stat HEAD 2>/dev/null || git diff --stat
echo ""
echo "📁 Files:"
git diff --name-status HEAD 2>/dev/null || git diff --name-status
echo ""

exit 0
