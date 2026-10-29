# Agent-Board

Pixel-Art-Live-Ansicht für Claude-Code-Agenten (Hooks, optional Codex). Node >= 20, ohne Abhängigkeiten. Öffentliches Repo Stefan-Paun/agent-board.

## Befehle

- Start: `npm start` (Server auf 127.0.0.1:4777); Demo im Browser mit `?demo=1`.
- Hooks installieren: `node install.mjs` (Codex: `node install.mjs --codex`).
- Unit-Tests: `npm test`. Den Exit-Code prüfen (`echo $?`), nicht nur die Ausgabe, schon einmal wurde mit roten Tests gepusht.
- Browser-Test: `npm run test:browser` (braucht Chrome, in CI manchmal wackelig wegen Debugport-Timeout: Rerun).
- Syntax-Check wie in CI: `for f in *.mjs public/*.js public/fx/*.js; do node --check "$f"; done`

## Regeln

- Das Repo ist öffentlich: keine privaten Pfade, Mails, Schlüssel oder Screenshots mit persönlichen Daten.
- UI-Texte gehören in `public/i18n.js` als `'key': ['English','Deutsch','Español']`. `test/i18n.test.mjs` prüft Vollständigkeit; neue DOM-Aufrufe in `i18n.js` brauchen einen Stub in diesem Test.
- Neue Tests kommen in die Liste im `test`-Skript in `package.json`.
- Neue Hooks und Tools laufen auch unter Windows (Pfade, Shell); die CI-Matrix testet ubuntu, macos und windows.

## Git

- Commit-Autor: `Stefan Paun <340585820+Stefan-Paun@users.noreply.github.com>`. Eine private Mail im Verlauf macht es nötig, das Repo neu anzulegen.
- Nie lokale Alt-Branches pushen (z. B. `history-old`: enthält private Autor-Mail). Immer nur den eigenen Branch pushen, von `origin/main` aus.
- Nur Branches und PRs, Stefan mergt und veröffentlicht Releases selbst. Vor dem Commit `git branch --show-current` prüfen (parallele Sitzungen wechseln gern den Branch).
- Die Nachtschicht-Routine nimmt das älteste offene Issue mit Label `nachtschicht`, arbeitet auf `nachtschicht/<datum>-issue-<n>` und öffnet nur einen Draft-PR. Zwei Branches, die Tests am Ende von `test/browser.test.mjs` anhängen, konfligieren: beide Tests behalten.
