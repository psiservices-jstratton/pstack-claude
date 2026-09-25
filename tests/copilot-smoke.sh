#!/usr/bin/env bash
# GitHub Copilot install smoke test for the pstack plugin.
#
# Installs this checkout into a throwaway COPILOT_HOME, with HOME also pointed at
# a throwaway directory so a stray write to a literal ~/.copilot path cannot reach
# the real one (sign-in lives in the system keychain, not HOME), and
# proves, from each session's events.jsonl rather than the model's say-so:
#   1. the marketplace install reports every skill directory
#   2. the SessionStart hook injects the routing mandate as JSON additionalContext
#   3. `session hook: off` in the Copilot sheet suppresses it
#   4. both plugin agents register, and a pstack:poteto-agent dispatch with an
#      explicit model runs on that model
#   5. with no model sheet, a multi-model skill runs setup-pstack first
#   6. setup-pstack writes only model IDs the CLI accepts, with multi-vendor panels
#
# Needs the `copilot` CLI signed in, `jq`, and network. Each probe is one
# short -p session (about 5 premium requests in all with the default model).
# Skips with exit 0 when `copilot` is missing. CI does not run it.
#
#   tests/copilot-smoke.sh            # default probe model claude-haiku-4.5
#   SMOKE_MODEL=gpt-5-mini tests/copilot-smoke.sh
#   KEEP=1 tests/copilot-smoke.sh     # keep the temp COPILOT_HOME for inspection
set -euo pipefail

if ! command -v copilot >/dev/null 2>&1; then
  echo "skip: copilot CLI not found"
  exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required" >&2; exit 1; }

repo="$(cd "$(dirname "$0")/.." && pwd -P)"
model="${SMOKE_MODEL:-claude-haiku-4.5}"
root="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/pstack-copilot-smoke.XXXXXX")" && pwd -P)"
home="$root/home"
work="$root/inventory-service"
user="$root/user"
mkdir -p "$home" "$work" "$user"
cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: $root"; else rm -rf "$root"; fi
}
trap cleanup EXIT

export COPILOT_HOME="$home" HOME="$user"
failures=0
pass() { printf 'ok: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }

# Run one -p session from the scratch workdir; print its events.jsonl path.
probe() {
  local before after
  before="$(ls "$home/session-state" 2>/dev/null | sort || true)"
  (cd "$work" && copilot -s --model "$model" --no-ask-user "$@" >"$root/last-reply.txt" 2>"$root/last-stderr.txt") || true
  after="$(ls "$home/session-state" 2>/dev/null | sort || true)"
  local id
  id="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -1)"
  [ -n "$id" ] || { echo "no new session for probe; stderr:" >&2; cat "$root/last-stderr.txt" >&2; return 1; }
  printf '%s\n' "$home/session-state/$id/events.jsonl"
}

hook_context() {
  jq -r 'select(.type == "hook.end") | .data.output.additionalContext? // empty' "$1"
}

# 1. Install from the local checkout; Copilot loads it live, nothing copied.
skills="$(find "$repo/plugins/pstack/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"
copilot plugin marketplace add "$repo" >/dev/null
install_out="$(copilot plugin install pstack@pstack-claude 2>&1)"
if [[ "$install_out" == *"Installed $skills skills"* ]]; then
  pass "install reports all $skills skills"
else
  fail "install did not report $skills skills: $install_out"
fi
version="$(tr -d '[:space:]' <"$repo/VERSION")"
list_out="$(copilot plugin list 2>&1)"
if [[ "$list_out" == *"pstack@pstack-claude (v$version) (enabled)"* ]]; then
  pass "plugin list shows pstack@pstack-claude v$version enabled"
else
  fail "plugin list does not show pstack v$version enabled"
fi

# 2 + 4a. Routing context and agent registration, no tools.
events="$(probe -p 'Use no tools. Reply with two lines. Line 1: "ROUTING: yes" if your context contains a block that begins with "You have pstack.", else "ROUTING: no". Line 2: "AGENTS:" followed by every agent_type value of your task tool that begins with "pstack:", comma-separated.')"
context="$(hook_context "$events")"
if [[ "$context" == *"You have pstack."* && "$context" == *"On GitHub Copilot, load pstack skills by their bare names"* ]]; then
  pass "SessionStart injected the mandate and Copilot addendum as additionalContext"
else
  fail "no pstack additionalContext in hook.end ($events)"
fi
setup_first="This Copilot home has no pstack model sheet yet"
if [[ "$context" == *"$setup_first"* ]]; then pass "no sheet: context carries the setup-first line"; else fail "no sheet: setup-first line missing"; fi
system_prompt="$(jq -r 'select(.type == "system.message") | .data.content' "$events")"
listed="$(grep -c '<location>plugin</location>' <<<"$system_prompt" || true)"
if [ "$listed" -gt 0 ] && [[ "$system_prompt" == *"<name>poteto-mode</name>"* ]]; then
  pass "system prompt lists $listed plugin skills including poteto-mode (Copilot truncates long skill lists)"
else
  fail "system prompt lists no pstack skills"
fi
reply="$(cat "$root/last-reply.txt")"
if [[ "$reply" == *"ROUTING: yes"* ]]; then pass "model sees the routing mandate"; else fail "model did not see the mandate: $reply"; fi
if [[ "$reply" == *"pstack:poteto-agent"* && "$reply" == *"pstack:comment-sicko"* ]]; then
  pass "task tool offers pstack:poteto-agent and pstack:comment-sicko"
else
  fail "agents missing from the task tool: $reply"
fi

# 3. session hook: off suppresses the hook.
printf 'session hook: off\n' >"$home/pstack-models.md"
events="$(probe -p 'Use no tools. Reply with the single word READY.')"
if jq -e 'select(.type == "hook.end")' "$events" >/dev/null && [ -z "$(hook_context "$events" | grep 'You have pstack.' || true)" ]; then
  pass "session hook: off ran the hook and injected nothing"
else
  fail "session hook: off did not suppress the mandate ($events)"
fi

# 4b. A pstack:poteto-agent dispatch with an explicit model; with a sheet
# present the setup-first line is gone.
printf 'session hook: on\n' >"$home/pstack-models.md"
events="$(probe --allow-all-tools -p "Call the task tool exactly once with agent_type \"pstack:poteto-agent\", model \"$model\", mode \"sync\", name \"probe\", and prompt \"Use no tools. Reply with exactly PROBE-OK.\". Then reply with the subagent's answer and nothing else.")"
dispatch="$(jq -c --arg m "$model" 'select(.type == "tool.execution_start" and .data.toolName == "task"
  and .data.arguments.agent_type == "pstack:poteto-agent" and .data.arguments.model == $m) | .data.toolCallId' "$events" | head -1)"
if [ -n "$dispatch" ] && jq -e --argjson id "$dispatch" 'select(.type == "tool.execution_complete" and .data.toolCallId == $id and .data.success == true)' "$events" >/dev/null; then
  pass "pstack:poteto-agent dispatch with model $model succeeded"
else
  fail "no successful pstack:poteto-agent task call with model $model ($events)"
fi
if grep -q 'PROBE-OK' "$root/last-reply.txt"; then pass "subagent answered"; else fail "subagent answer missing: $(cat "$root/last-reply.txt")"; fi
context="$(hook_context "$events")"
if [[ "$context" == *"You have pstack."* && "$context" != *"$setup_first"* ]]; then
  pass "with a sheet: mandate injected without the setup-first line"
else
  fail "with a sheet: expected the mandate without the setup-first line ($events)"
fi
rm "$home/pstack-models.md"

# 5. No model sheet: a multi-model skill must run setup-pstack before any fan-out.
# The task tool is withheld so the probe cannot spend a panel.
events="$(probe --allow-all-tools --excluded-tools task -p 'Use the arena skill to decide whether a function that adds two integers should be named add or sum. Keep it brief.')"
order="$(jq -r 'select(.type == "tool.execution_start" and .data.toolName == "skill") | .data.arguments.skill' "$events" | tr '\n' ' ')"
if [[ "$order" == *"setup-pstack"* ]]; then
  pass "missing sheet: setup-pstack ran (skill calls: $order)"
else
  fail "missing sheet did not trigger setup-pstack (skill calls: ${order:-none}) ($events)"
fi
if [ -e "$user/.copilot/pstack-models.md" ]; then
  fail "setup wrote the sheet to ~/.copilot instead of \$COPILOT_HOME"
else
  pass "nothing landed in ~/.copilot (sheet under \$COPILOT_HOME: $([ -e "$home/pstack-models.md" ] && echo yes || echo no))"
fi

# 6. setup-pstack with the task tool available writes only real Copilot model IDs.
# The known IDs come from the CLI's own `model` setting list. That list can lag
# the task tool's model enum, so an ID missing from it is started once with
# --model: the CLI rejects an unavailable model before sending anything.
model_starts() {
  local out
  out="$(cd "$work" && copilot -s --model "$1" --available-tools view --no-ask-user -p 'Reply with OK.' 2>&1 || true)"
  [ -n "$out" ] && [[ "$out" != *"is not available"* ]]
}
rm -f "$home/pstack-models.md"
known="$(copilot help config 2>/dev/null | awk '/^ *`model`:/{on=1; next} on && /^ *- "/{gsub(/[ "]/, ""); sub(/^-/, ""); print; next} on && NF==0{exit}')"
events="$(probe --allow-all-tools -p 'Run the setup-pstack skill now and save the sheet. I accept every model you propose; do not ask me anything.')"
if [ ! -e "$home/pstack-models.md" ]; then
  fail "setup-pstack wrote no sheet under \$COPILOT_HOME ($events)"
else
  bad=""
  while IFS= read -r value; do
    case "$value" in "" | on | off | inherit-parent | auto) continue ;; esac
    grep -qxF "$value" <<<"$known" || model_starts "$value" || bad="$bad $value"
  done < <(grep -E '^[a-z][a-z ,-]*: ' "$home/pstack-models.md" | cut -d: -f2- | tr ',' '\n' | tr -d ' ')
  if [ -z "$bad" ]; then
    pass "setup-pstack wrote only real Copilot model IDs"
  else
    fail "setup-pstack wrote unknown model IDs:$bad"
  fi
  # Panels need distinct vendors (the ID prefix before the first dash).
  mono=""
  while IFS= read -r line; do
    vendors="$(cut -d: -f2- <<<"$line" | tr ',' '\n' | tr -d ' ' | { grep -vxE 'inherit-parent|auto|[[:space:]]*' || true; } | cut -d- -f1 | sort -u | wc -l | tr -d ' ')"
    [ "$vendors" -ge 2 ] || mono="$mono; $line"
  done < <(grep -E '^(arena runners|arena cross-judge pool|architect runners|interrogate reviewers): ' "$home/pstack-models.md")
  if [ -z "$mono" ]; then
    pass "setup-pstack drew each panel from at least two vendors"
  else
    fail "setup-pstack wrote single-vendor panels${mono}"
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed; rerun with KEEP=1 to inspect $home"
  exit 1
fi
echo "all Copilot smoke checks passed"
