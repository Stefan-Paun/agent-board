#!/bin/bash
# Schneller Hook-Wrapper: liest stdin, startet den Collector im Hintergrund,
# damit Claude Code nicht auf node warten muss. Gibt nie etwas aus, endet immer mit 0.
DIR="$(cd "$(dirname "$0")" && pwd)"
input=$(cat 2>/dev/null)
printf '%s' "$input" | node "$DIR/collector.mjs" > /dev/null 2>&1 &
exit 0
