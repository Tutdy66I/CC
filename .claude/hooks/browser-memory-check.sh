#!/usr/bin/env bash
# PreToolUse hook: if the bash command involves browser/Playwright, inject Edge memory
if grep -qiE 'playwright|--browser[= ]|npx playwright|chromium|chrome[^a-z]|PWCLI'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"REMINDER: Use --browser=msedge for Playwright. Never install chromium. Edge: C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}}'
else
  echo '{}'
fi
