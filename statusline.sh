#!/bin/bash
# NUR NOCH FUER INSTALLATIONEN AUS VERSION 1.0. Neue Installationen rufen node direkt auf;
# einfach `node install.mjs` erneut ausfuehren, dann wird diese Datei nicht mehr gebraucht.
# statusLine-Huelle fuer Claude Code: schreibt status.json fuers Agent-Board, gibt eine kurze Zeile aus.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/statusline.mjs" 2>/dev/null
