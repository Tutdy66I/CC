#!/bin/bash
# Auto-format files after edits using prettier
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('tool_input', {}).get('file_path', ''))" 2>/dev/null)

if [[ -z "$file_path" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# Use project-local prettier if available
PRETTIER="npx prettier"
if [[ -f "$(dirname "$file_path")/node_modules/.bin/prettier" ]]; then
  PRETTIER="$(dirname "$file_path")/node_modules/.bin/prettier"
fi

# Format supported file types
case "$file_path" in
  *.js|*.jsx|*.ts|*.tsx|*.css|*.json|*.md|*.html|*.yaml|*.yml)
    $PRETTIER --write "$file_path" 2>&1 && echo "  ✓ Formatted: $file_path" || true
    ;;
esac

exit 0
