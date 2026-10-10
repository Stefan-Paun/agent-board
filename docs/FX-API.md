# FX-API für Erweiterungen (public/fx/*.js)

Erweiterungen sind einfache Skripte (kein Modul, kein Build), die NACH `app.js` geladen werden:
`<script src="fx/<name>.js"></script>`. Sie greifen nur über `window.AgentBoard` (kurz `AB`) zu.
Pro Datei ein IIFE: `(() => { 'use strict'; const AB = window.AgentBoard; ... })()`.

## Zwei Zeichenebenen

Seit dem Pixel-Umbau gibt es zwei Canvas-Kontexte:

- **Kunst-Pixel-Puffer** (niedrig aufgelöst, `actx` in app.js): die eigentliche Szene (Boden,
  Zimmer, Möbel, Figuren, Partikel). Wird jeden Frame komplett neu gezeichnet und dann unscharf-frei
  (nearest-neighbor) auf die volle Canvas-Größe hochskaliert. Für echte Pixelkanten NUR ganzzahlige
  Koordinaten verwenden (`AB.toArt(x, y)` wandelt eine CSS-Pixel-Weltkoordinate in eine ganzzahlige
  Kunst-Pixel-Koordinate um) und möglichst `fillRect` statt Kurven/Pfaden - jede Kurve wird beim
  Hochskalieren treppig, was gewollt aussieht, aber nicht mehr "scharf".
- **Scharfe Überlagerung** (normaler `ctx`, CSS-Pixel-Raum, mit `dpr` skaliert): Text (Namen,
  Stationsbeschriftungen) und die Status-Abzeichen/Sprechblase aus `status.js`. Bleibt lesbar,
  weil Text bei der Kunst-Pixel-Auflösung schnell matschig würde.

Die Hook-Phasen `bg`/`stations`/`under` laufen VOR dem Hochskalieren und bekommen `actx` (Kunst-Pixel,
ganzzahlige Koordinaten verwenden). Die Phasen `agents`/`top` laufen NACH dem Hochskalieren und
bekommen den scharfen `ctx` (normale CSS-Pixel-Koordinaten, wie `AB.geo` sie liefert).

## Daten

- `AB.S.agents`: `Map` id → Agent `{ id, name, role, color, x, y, vx, vy, st (Station|null), stIdx, state ('active'|'idle'|'done'|'error'), born, last, doneAt, errAt, what, count, slot, alpha }`
- `AB.S.leads`: Map Lead-ID -> Kommandant `{ name ('Claude', 'Claude 2', 'Codex' ...), src ('claude'|'codex'), num, proj, born, seenAt, endedAt, state ('active'|'idle'), last, tool, station, ping, what, count }`, eine je Session. `AB.S.main` (nur lesen, fuer aeltere Erweiterungen) ist der Kommandant der zuletzt aktiven Claude-Session.
- Akteur-IDs: Lead-ID `'<src>:<sid>'` (z.B. `'claude:3f9a1c2e'`, `'codex:0199a1b2'`) oder die `aid` eines Subagents; Agents tragen `lead` (die Lead-ID ihrer Session). Helfer: `AB.actorId(ev)`, `AB.leadOf(ev)`, `AB.isLead(id)`, `AB.lead(id)`, `AB.leadColor(id)`, `AB.leadsShown()` (Kommandanten mit Tisch, hoechstens 4), `AB.leadsAll()` (alle, mit Tisch zuerst), `AB.statusLead()` (Session der Statusline), `AB.deskPos(id)` (Tischmitte in CSS-Pixeln)
- `AB.S.tools`, `AB.S.log` (`{t, who, text, color}`), `AB.S.stCount` (Station-id → Zähler)
- `AB.geo`: `{ w, h, cx, cy, u, dpr }` in CSS-Pixeln. `u` = grober UI-Skalierungsfaktor (1 bis 2).
- `AB.COL` (amber, mint, coral, dim, line, ink), `AB.HUES`, `AB.STATIONS` (`{id, label, icon, row: 'top'|'bottom', col, tools}`), `AB.stationPos(st)` (Raummitte in CSS-Pixeln), `AB.stationFor(tool)`
- `AB.reduce`: true bei prefers-reduced-motion (dann keine großen Bewegungen, keine Blitze)
- `AB.mode()`: 'live' | 'demo' | 'off'

## Hooks

`AB.on(phase, fn)`; Fehler in einer Erweiterung werden abgefangen und einmal geloggt.

| Phase | Signatur | Wann | Kontext |
|---|---|---|---|
| `event` | `(ev, silent)` | nach jedem Ereignis; `silent` = Replay beim Laden, dann KEINE Effekte/Töne | - |
| `bg` | `(actx, time, dt)` | nach dem Boden, vor Zimmern | Kunst-Pixel |
| `stations` | `(actx, time, dt)` | nach Zimmern/Türen, vor Kommandant | Kunst-Pixel |
| `under` | `(actx, time, dt)` | nach dem Schreibtisch, vor den Figuren | Kunst-Pixel |
| `agents` | `(ctx, time, dt)` | nach dem Hochskalieren, über allen Figuren | scharf |
| `top` | `(ctx, time, dt)` | ganz zuletzt | scharf |
| `ui` | `()` | alle 500 ms nach dem DOM-Update | - |

`ev` = `{ t, ev, aid, at, tool, what, ok, msg }`, `ev.ev` ∈ SubagentStart, SubagentStop, PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, Notification, SessionStart, SessionEnd. `aid` fehlt beim Kommandanten.

Setze nach dem Zeichnen `globalAlpha`, `globalCompositeOperation`, `setLineDash([])` zurück (oder nutze save/restore).

## Überschreibungen (je höchstens EINE Erweiterung)

- `AB.drawShip = (actx, agent, farbe, time, artX, artY) => {}` zeichnet die Figur in den Kunst-Pixel-Puffer. `artX/artY` sind BEREITS ganzzahlige Kunst-Pixel-Koordinaten (Fußpunkt) - nur `fillRect` mit ganzzahligen Offsets darauf verwenden, siehe `fx/people.js` als Referenz.
- `AB.renderCrew = (ulElement, agentsSortiert, main) => {}` baut die Besatzungsliste (DOM, nur `textContent`, nie `innerHTML` mit Daten).
- `AB.playSound = (art, audioCtx) => {}` spielt `art` ∈ tool, click, spawn, done, error, prompt, stop, alert. Rückgabe `false` = Standardton nutzen. Nur aufgerufen, wenn Ton an ist.

## Helfer

`AB.ring(x, y, farbe, max)`, `AB.burst(x, y, farbe, n)` (Positionen in CSS-Pixeln, werden intern nach Kunst-Pixeln umgerechnet), `AB.roomPoint(station, lx, ly)` (lokaler Punkt im Raum → CSS-Pixel-Weltkoordinate; `ly` positiv = von der Tür weg, ins Zimmer hinein), `AB.toArt(x, y)` (CSS-Pixel → ganzzahlige Kunst-Pixel-Koordinate), `AB.onResize.push(fn)`.

Texte: `AB.t(key, vars)` liefert den Text in der aktuellen Sprache (`AB.lang` = 'en' | 'de' | 'es', `AB.locale` fuer Zahlen und Uhrzeiten). Neue Texte als `'key': ['English', 'Deutsch', 'Español']` in `public/i18n.js` eintragen, nie fest im Modul; Platzhalter `{name}`, fuer Einzahl/Mehrzahl ist der Wert eine Funktion `(vars) => text`.

## Regeln

- Keine externen Bibliotheken, keine Netzwerkzugriffe, keine Webfonts.
- Sichtbare Texte nur ueber `AB.t` (siehe Helfer), damit jede Sprache vollstaendig ist.
- Im Kunst-Pixel-Puffer: nur `fillRect` mit ganzzahligen Koordinaten (kein `arc`/`ellipse`/Gradient - die verschwimmen beim Hochskalieren). Diagonalen als gestufte kleine Rechtecke zeichnen (klassische Pixel-Art-Treppe), siehe `funkturm`-Antenne in `app.js`.
- 60 fps: kein `shadowBlur`, kein `ctx.filter` pro Objekt, kein `getImageData` im Loop.
- Bei `AB.reduce`: Effekte stark reduzieren.
- Eigene CSS-Datei möglich: `public/fx/<name>.css`.
- Zum Testen ohne index.html-Änderung: `?demo=1&fx=<name1>,<name2>` lädt `fx/<name>.js` und `fx/<name>.css` nach.
- Test: `AGENT_BOARD_DATA=$(mktemp -d) AGENT_BOARD_PORT=<eigener Port> node server.mjs`, dann `http://localhost:<port>/?demo=1`.

## Erweiterungs-Vertrag Runde "alles" (gemeinsame Grundlage fuer alle Module)

### Neue Hook-Phasen
| Phase | Signatur | Wann | Kontext |
|---|---|---|---|
| `scene` | `(actx, time, dt)` | ganz zuletzt im Kunst-Pixel-Durchgang (nach Figuren/Partikeln), vor dem Hochskalieren - fuer Licht/Tageszeit-Overlays und Ereignis-Pops | Kunst-Pixel |
| `status` | `(status)` | wenn neue Statusline-Daten kommen (live per SSE `status`, in der Demo alle 2 s) | - |
| `click` | `(hit)` | Klick auf die Szene; `hit = { agent (Agent-Objekt oder null), main (true wenn ein Kommandanten-Tisch), lead (Lead-ID beim Tisch), x, y }` in CSS-Pixeln | - |

`event` bekommt zusaetzlich `{ ev: '__reset' }`, wenn der Zustand geleert wird (Replay-Neustart, Demo-Start) - Module sollen dann ihre eigenen Puffer leeren.

### Neue Event-Felder (Collector -> Board)
Bestehend: `{ t, ev, sid, aid, at, proj, tool, what, ok, len, msg }`. Neu (alle optional):
- `tid` - tool_use_id (Pre/PostToolUse, PostToolUseFailure), gekuerzt
- `dur` - duration_ms (PostToolUse/PostToolUseFailure)
- `nt` - notification_type (Notification): z.B. `permission_prompt`, `idle_prompt`, `agent_needs_input`
- `err` - Fehlerart (StopFailure.error, z.B. `rate_limit`, `overloaded`, `billing`, `server_error`)
- `trig` - `manual`/`auto` (PreCompact/PostCompact)
- `task` - kurzer Aufgabentitel (TaskCreated/TaskCompleted)
Neue Event-Namen, die durchgereicht werden: `PermissionRequest` (mit `tool`, `what`, `aid`), `PermissionDenied`, `PreCompact`, `PostCompact`, `StopFailure`, `TaskCreated`, `TaskCompleted`. `Stop.msg` kann einen gekuerzten Schlusssatz enthalten.

### Status-Daten (`AB.S.status`, Phase `status`)
```
{ t, ctxPct, costUsd, model,
  rl5h: { usedPct, resetsAt (ms) }, rl7d: { usedPct, resetsAt },
  subagents: [ { id, label, status, tokens, tokenSamples: [..], model } ] }
```
Alles optional - Module muessen mit fehlenden Feldern leben (z.B. wenn die Statusline-Huelle nicht installiert ist).

### Neuer Zustand im Kern (`AB.S`)
- `S.events` - Rohereignisse (inkl. Replay), max. 4000, aelteste zuerst
- `S.lastEventAt` - Wanduhr-Zeit des letzten LIVE empfangenen Ereignisses; `S.lastPingAt` - letzter Server-Herzschlag (SSE `ping`)
- Jeder Agent und `S.main`: `recent` (letzte 20 Werkzeuge `{t, tool, what, tid, dur, ok}`), `openTool` (`{t, tool, what, tid}` oder null, solange kein Post-Event kam), Agents zusaetzlich `task` (Beschreibung des Agent-Aufrufs, der ihn gestartet hat)
- `AB.targetFor = (agent, time) => {x, y} | null` - Ueberschreibung des Laufziels (CSS-Pixel), z.B. fuer "wartet auf dich"

### Neue Helfer
`AB.PX`, `AB.lightPool(cx, cy, r, staerke)` (Kunst-Pixel), `AB.apartmentBoundsCss()`, `AB.roomWcss()`, `AB.roomHcss()`, `AB.livingHalfHcss()`, `AB.stationById(id)`, `AB.artToCss(v)`, `AB.hitTest(x, y)`, `AB.setStatus(obj)`, `AB.logLine(t, wer, text, farbe)`.

### Demo
`?demo=1` simuliert jetzt: Pre/Post-Paare mit `tid`/`dur`, Agent-Auftraege, eine Erlaubnis-Anfrage (Agent 2, ~7 s), eine Read-Schleife (Agent 1 liest config.js 4x), Kompaktierung bei ~85 % Kontext, Status-Daten alle 2 s, `Stop` mit Schlusssatz und danach `Notification idle_prompt`. `?demo=1&ratelimit=1` schickt zusaetzlich ein `StopFailure` mit `err: 'rate_limit'`.

### Nachtrag nach dem Zusammenfuehren
- `AB.run(phase, ...args)` - Phase von aussen ausloesen (z.B. crew.js oeffnet die Info-Karte mit `AB.run('click', {agent, main, x, y})`).
- `AB.labelRects` - pro Frame die Rechtecke aller scharfen Beschriftungen `{x, y (Mitte), w, h}` in CSS-Pixeln; Abzeichen weichen ihnen aus.
- `AB.night` - 0..1, gesetzt von fx/daynight.js; der Kern gibt Beschriftungen nachts einen hellen Rand.
- `AB.waiting()` (fx/attention.js) - aktuelle Warte-Zustaende; `AB.__healthHit` - Klick wurde von einem Abzeichen (fx/health.js) beansprucht, inspect.js oeffnet dann keine Karte.
- `AB.soundOn()`, `AB.setLofi(bool)`, `AB.lofiOn()` (fx/sound.js); Klangnamen stehen im Kopfkommentar von sound.js.
- URL-Schalter zum Testen: `?demo=1`, `&ratelimit=1`, `&hang=<s>` (Haengt?-Schwelle), `&hour=<0-24>` (Tageszeit).
