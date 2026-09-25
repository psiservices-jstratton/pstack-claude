# Replaces the marker in the stamped Copilot context with the sheet's role
# lines, escaped as JSON string content. POSIX awk, run under LC_ALL=C.
function esc(s,    out, i, c) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == "\"") out = out "\\\""
    else if (c == "\t") out = out "\\t"
    else if (c == "\r") out = out "\\r"
    else if (!(c in ctl)) out = out c
  }
  return out
}

BEGIN {
  marker = "@PSTACK_SAVED_MODEL_CHOICES@"
  sheet = ENVIRON["PSTACK_SHEET"]
  cap = 4096
  for (i = 1; i < 32; i++) ctl[sprintf("%c", i)] = 1
  ctl[sprintf("%c", 127)] = 1
  delete ctl["\t"]
  delete ctl["\r"]
  body = ""; kept = 0; seen = 0; truncated = 0
  while ((getline line < sheet) > 0) {
    seen += length(line) + 1
    if (seen > 16 * cap) { truncated = 1; break }
    sub(/\r$/, "", line)
    if (line !~ /^[A-Za-z][A-Za-z0-9 ,\/_()-]*:[ \t]*[^ \t]/ || line ~ /^session hook:/) continue
    if (kept + length(line) + 1 > cap) { truncated = 1; break }
    kept += length(line) + 1
    body = body (body == "" ? "" : "\\n") esc(line)
  }
  close(sheet)
  if (body == "") body = "(no role lines: every role omits `model`)"
  if (truncated) body = body "\\n(truncated: the sheet has more than the plugin hook injects; view it for the rest)"
}

{
  i = index($0, marker)
  if (i) $0 = substr($0, 1, i - 1) body substr($0, i + length(marker))
  print
}
