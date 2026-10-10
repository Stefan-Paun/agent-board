#!/bin/bash
# NUR NOCH FUER INSTALLATIONEN AUS VERSION 1.0. Neue Installationen rufen node direkt auf;
# einfach `node install.mjs` erneut ausfuehren, dann wird diese Datei nicht mehr gebraucht.
# subagentStatusLine-Huelle: schreibt subagents.json fuers Agent-Board, gibt nichts aus
# (Claude Code zeigt dann weiter seine Standard-Zeilen).
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/statusline.mjs" subagents 2>/dev/null
exit 0
