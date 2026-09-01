#!/usr/bin/env bash
# Stop hook: blocks the turn from ending if Claude's final chat response
# contains an em dash, forcing a rewrite before the turn is allowed to
# finish. CLAUDE.md has a zero-tolerance em dash rule, but relying on
# Claude to self-check its own output proved unreliable (four violations
# in one session, including immediately after promising to check more
# carefully). This enforces the rule at the harness level instead.
set -euo pipefail

input="$(cat)"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  exit 0
fi

last_text="$(jq -s -r '
  [ .[] | select(.type=="assistant") ] | last
  | (.message.content // [])[]?
  | select(.type=="text")
  | .text
' "$transcript_path" 2>/dev/null || true)"

counter_file="/tmp/claude-emdash-block-count-${session_id}"

if [ -n "$last_text" ] && printf '%s' "$last_text" | grep -qF '—'; then
  count="$(cat "$counter_file" 2>/dev/null || echo 0)"
  count=$((count + 1))
  if [ "$count" -le 3 ]; then
    printf '%s\n' "$count" > "$counter_file"
    jq -n '{
      decision: "block",
      reason: "Your last response contains an em dash (—) character. This project (CLAUDE.md) has a zero-tolerance rule against em dashes anywhere, including chat responses. Find every em dash in your previous message and resend the corrected response with each one replaced by a comma, period, colon, or parentheses."
    }'
    exit 0
  fi
  rm -f "$counter_file"
  exit 0
fi

rm -f "$counter_file" 2>/dev/null || true
exit 0
