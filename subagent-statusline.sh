#!/bin/bash
# subagentStatusLine-Huelle: schreibt subagents.json fuers Agent-Board, gibt nichts aus
# (Claude Code zeigt dann weiter seine Standard-Zeilen).
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/statusline.mjs" subagents 2>/dev/null
exit 0
