#!/bin/bash
# statusLine-Huelle fuer Claude Code: schreibt status.json fuers Agent-Board, gibt eine kurze Zeile aus.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/statusline.mjs" 2>/dev/null
