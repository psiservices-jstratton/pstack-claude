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
#   6. setup-pstack writes no sheet without answers, and exactly the supplied IDs
#   7. without --allow-all-paths, and with the temp dir outside the sandbox, the
#      saved model choices reach the session with no read of the sheet, and a
#      plugin playbook loads, with no path-access request at all
#   8. opt-in, SMOKE_GITHUB=owner/repo@ref: check 7 again on a GitHub
#      marketplace install under $COPILOT_HOME/installed-plugins (pushed code)
#
# Needs the `copilot` CLI signed in, `jq`, and network. Each probe is one
# short -p session (about 7 premium requests in all with the default model).
# Skips with exit 0 when `copilot` is missing. CI does not run it.
#
#   tests/copilot-smoke.sh            # default probe model claude-haiku-4.5
#   SMOKE_MODEL=gpt-5-mini tests/copilot-smoke.sh
#   SMOKE_SETUP_MODEL=claude-sonnet-5 tests/copilot-smoke.sh   # setup probes 5 and 6
#   KEEP=1 tests/copilot-smoke.sh     # keep the temp COPILOT_HOME for inspection
#   SMOKE_GITHUB=psiservices-jstratton/pstack-claude@copilot-build tests/copilot-smoke.sh
set -euo pipefail

if ! command -v copilot >/dev/null 2>&1; then
  echo "skip: copilot CLI not found"
  exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required" >&2; exit 1; }

repo="$(cd "$(dirname "$0")/.." && pwd -P)"
model="${SMOKE_MODEL:-claude-haiku-4.5}"
# The setup probes (5 and 6) need a model that follows setup-pstack over a
# request to "save the sheet"; claude-haiku-4.5 wrote guessed models in about
# half its runs.
setup_model="${SMOKE_SETUP_MODEL:-gpt-5.4-mini}"
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

# Run one -p session from the scratch workdir on $PROBE_MODEL, else $model;
# print its events.jsonl path.
probe() {
  local before after
  before="$(ls "$home/session-state" 2>/dev/null | sort || true)"
  (cd "$work" && copilot -s --model "${PROBE_MODEL:-$model}" --no-ask-user "$@" >"$root/last-reply.txt" 2>"$root/last-stderr.txt") || true
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
events="$(PROBE_MODEL=$setup_model probe --allow-all-tools --excluded-tools task -p 'Use the arena skill to decide whether a function that adds two integers should be named add or sum. Keep it brief.')"
order="$(jq -r 'select(.type == "tool.execution_start" and .data.toolName == "skill") | .data.arguments.skill' "$events" | tr '\n' ' ')"
if [[ "$order" == *"setup-pstack"* ]]; then
  pass "missing sheet: setup-pstack ran (skill calls: $order)"
else
  fail "missing sheet did not trigger setup-pstack (skill calls: ${order:-none}) ($events)"
fi
if [ -e "$user/.copilot/pstack-models.md" ]; then
  fail "setup wrote the sheet to ~/.copilot instead of \$COPILOT_HOME"
else
  pass "nothing landed in ~/.copilot"
fi
if [ -e "$home/pstack-models.md" ]; then
  fail "missing sheet: setup wrote a sheet without asking ($events): $(grep -E '^[a-z][a-z ,-]*: ' "$home/pstack-models.md" | tr '\n' '|')"
else
  pass "missing sheet: setup without ask_user wrote no sheet"
fi

# 6. setup-pstack never picks models for the user. A -p session cannot ask, so
# with no answers it writes no sheet; with every answer in the request it writes
# exactly those IDs. The panel takes the first GPT and Gemini IDs from the CLI's
# own `model` setting list, next to the probe model. These run on $setup_model.
known="$(copilot help config 2>/dev/null | awk '/^ *`model`:/{on=1; next} on && /^ *- "/{gsub(/[ "]/, ""); sub(/^-/, ""); print; next} on && NF==0{exit}')"
rm -f "$home/pstack-models.md"
events="$(PROBE_MODEL=$setup_model probe --allow-all-tools -p 'Run the setup-pstack skill now and save the sheet.')"
if [ -e "$home/pstack-models.md" ]; then
  fail "setup-pstack wrote a sheet with no answers from the user ($events): $(tr '\n' ' ' <"$home/pstack-models.md")"
else
  pass "no answers and no ask_user: setup-pstack wrote no sheet"
fi
gpt="$(grep -m1 '^gpt-' <<<"$known" || true)"
gemini="$(grep -m1 '^gemini-' <<<"$known" || true)"
if [ -z "$gpt" ] || [ -z "$gemini" ]; then
  fail "the CLI's model list has no GPT or Gemini ID: $known"
else
  panel="$model, $gpt, $gemini"
  events="$(PROBE_MODEL=$setup_model probe --allow-all-tools -p "Run the setup-pstack skill now and save the sheet. My answers: default model $model. Strongest model $model. Panel models $panel, in that order, and no more. No role overrides. Session hook on.")"
  sheet="$home/pstack-models.md"
  if [ ! -e "$sheet" ]; then
    fail "setup-pstack wrote no sheet from supplied answers ($events)"
  else
    wrong=""
    for role in "feature, refactoring" "judgment and prose" "how explorer" "how explainer" "why investigators" "why synthesizer" \
      "reflect tooling" "reflect judgment, divergent, synthesizer" "swarm workers" "bug-fix" "perf-issue" "hillclimb" "strongest judgment"; do
      grep -qxF "$role: $model" "$sheet" || wrong="$wrong; $role"
    done
    for role in "arena runners" "arena cross-judge pool" "architect runners" "interrogate reviewers"; do
      grep -qxF "$role: $panel" "$sheet" || wrong="$wrong; $role"
    done
    grep -qxF "session hook: on" "$sheet" || wrong="$wrong; session hook"
    if [ -z "$wrong" ]; then
      pass "supplied answers: the sheet holds exactly those IDs for all 17 roles"
    else
      fail "supplied answers: wrong or missing lines${wrong} ($sheet: $(tr '\n' '|' <"$sheet"))"
    fi
  fi
fi

# 7. Copilot's path sandbox covers only the workspace and the temp dir, and the
# sheet and plugin sit outside $work. --disallow-temp-dir takes the temp dir out
# too, so this runs as a real install does; a -p session cannot ask, so any
# read outside the sandbox would show up as a denied permission request.
sandboxed() {
  local label="$1" playbook="$2/skills/poteto-mode/playbooks/bug-fix.md" events reply
  printf '# pstack models\narena runners: smoke-alpha-1, smoke-beta-2\nsession hook: on\n' >"$home/pstack-models.md"
  events="$(probe --allow-all-tools --disallow-temp-dir -p 'Answer from your pstack instructions. Reply with two lines. Line 1: "ARENA:" followed by the models the pstack arena runners role uses for me. Line 2: the first line of '"$playbook"', read with the view tool.')"
  reply="$(cat "$root/last-reply.txt")"
  if [[ "$reply" == *smoke-alpha-1* && "$reply" == *smoke-beta-2* ]]; then
    pass "$label: model reports the injected saved choices"
  else
    fail "$label: saved choices missing from the reply: $reply"
  fi
  if jq -e 'select(.type == "tool.execution_start") | select(.data.arguments | tostring | contains("pstack-models.md"))' "$events" >/dev/null; then
    fail "$label: a tool call touched the sheet ($events)"
  else
    pass "$label: no tool call touched the sheet"
  fi
  local view
  view="$(jq -c 'select(.type == "tool.execution_start" and .data.toolName == "view"
    and .data.arguments.path == $p) | .data.toolCallId' --arg p "$playbook" "$events" | head -1)"
  if [ -n "$view" ] && jq -e --argjson id "$view" 'select(.type == "tool.execution_complete" and .data.toolCallId == $id and .data.success == true)' "$events" >/dev/null; then
    pass "$label: view of the plugin playbook succeeded"
  else
    fail "$label: no successful view of the plugin playbook ($events)"
  fi
  if jq -e 'select(.type | startswith("permission."))' "$events" >/dev/null; then
    fail "$label: path access was requested: $(jq -c 'select(.type | startswith("permission.")) | .data' "$events" | head -2)"
  else
    pass "$label: no permission request in the session"
  fi
}
sandboxed "local install" "$repo/plugins/pstack"

# 8. The same on a GitHub marketplace install, which Copilot copies under
# $COPILOT_HOME/installed-plugins. It installs pushed code, not this checkout.
if [ -n "${SMOKE_GITHUB:-}" ]; then
  home="$root/github-home"
  mkdir -p "$home"
  export COPILOT_HOME="$home"
  jq -n --arg repo "${SMOKE_GITHUB%@*}" --arg ref "${SMOKE_GITHUB#*@}" \
    '{extraKnownMarketplaces: {"pstack-claude": {source: {source: "github", repo: $repo, ref: $ref}}}}' >"$home/settings.json"
  copilot plugin install pstack@pstack-claude >/dev/null 2>&1 || true
  if [ -e "$home/installed-plugins/pstack-claude/pstack/hooks/pre-tool-use" ]; then
    pass "GitHub install copied the plugin under installed-plugins"
    sandboxed "GitHub install" "$home/installed-plugins/pstack-claude/pstack"
  else
    fail "GitHub install of $SMOKE_GITHUB left no hooks/pre-tool-use under $home/installed-plugins/pstack-claude/pstack"
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed; rerun with KEEP=1 to inspect $home"
  exit 1
fi
echo "all Copilot smoke checks passed"
