// Uebersetzungen der Oberflaeche. Laedt als erstes Skript, vor app.js und den fx-Modulen.
// Sprache: ?lang=en|de (wird gemerkt), sonst gespeicherte Wahl, sonst Browsersprache (de* -> Deutsch,
// alles andere -> Englisch). Neue Sprache: eine weitere Spalte in D und ein Eintrag in LANGS.
// Werte sind Texte mit {platzhaltern} oder Funktionen (vars) => Text (z.B. fuer Einzahl/Mehrzahl).
(() => {
'use strict'
const LANGS = ['en', 'de']
const tryLS = (fn) => { try { return fn() } catch { return null } }

function detect() {
  const q = new URLSearchParams(location.search).get('lang')
  if (q && LANGS.includes(q)) { tryLS(() => localStorage.setItem('ab-lang', q)); return q }
  const saved = tryLS(() => localStorage.getItem('ab-lang'))
  if (saved && LANGS.includes(saved)) return saved
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || ''
  return /^de\b/i.test(nav) ? 'de' : 'en'
}
const lang = detect()
const col = LANGS.indexOf(lang)

// key: [Englisch, Deutsch]
const D = {
  // ---------- Seite (index.html) ----------
  'page.desc': ['A calm overview of your coding agents: who is doing what, as a little pixel apartment.', 'Ruhige Übersicht über deine Coding-Agents: wer gerade was macht, als kleine Pixel-Wohnung.'],
  'stats.label': ['Counters', 'Zähler'],
  'stats.active': ['Active', 'Aktiv'],
  'stats.done': ['Done', 'Fertig'],
  'stats.err': ['Errors', 'Fehler'],
  'stats.tools': ['Tools', 'Werkzeuge'],
  'map.label': ['Map of the agents. A list of all agents is on the right.', 'Karte der Agents. Eine Liste mit allen Agents steht rechts.'],
  'empty.text': ['Nobody here yet. As soon as a Claude Code (or Codex) session runs with the hooks (once: <code>node install.mjs</code>), the agents move in.', 'Noch ist niemand da. Sobald eine Claude-Code- (oder Codex-)Session mit den Hooks läuft (einmalig <code>node install.mjs</code>), ziehen hier die Agents ein.'],
  'empty.demo': ['Start demo', 'Demo starten'],
  'crew.title': ['Crew', 'Besatzung'],
  'controls.label': ['Commands for the chat', 'Befehle für den Chat'],
  'btn.stop': ['Stop', 'Stopp'],
  'cmd.stop': ['stop', 'stopp'],
  'btn.continue': ['Continue', 'Weiter'],
  'cmd.continue': ['continue', 'mach weiter'],
  'btn.status': ['Status', 'Status'],
  'cmd.status': ['What is the status? Which agents are running and what are they doing right now?', 'Wie ist der Stand? Welche Agents laufen und was machen sie gerade?'],
  'btn.newRound': ['New round', 'Neue Runde'],
  'cmd.newRound': ['start a new round', 'starte eine neue Runde'],
  'msg.to': ['To', 'An'],
  'msg.all': ['all agents', 'alle Agents'],
  'msg.text': ['Message', 'Nachricht'],
  'msg.placeholder': ['Message to an agent …', 'Nachricht an einen Agent …'],
  'msg.copy': ['Copy', 'Kopieren'],
  'msg.toOne': ['Tell {to}: {txt}', 'Sag {to}: {txt}'],
  'msg.toAll': ['Tell all running agents: {txt}', 'Sag allen laufenden Agents: {txt}'],
  'toast.copied': ['Copied: “{text}”. Paste it into the chat.', 'Kopiert: „{text}“. Im Chat einfügen.'],
  'sound.on': ['Sound on', 'Ton an'],
  'sound.off': ['Sound off', 'Ton aus'],
  'sound.saved': ['Sound is saved as on; one click turns it on (browser rule).', 'Ton ist gespeichert an; ein Klick aktiviert ihn (Browser-Regel).'],
  'conn.live': ['Live', 'Live'],
  'conn.demo': ['Demo', 'Demo'],
  'conn.off': ['Offline', 'Offline'],

  // ---------- Raeume ----------
  'room.archiv': ['Archive', 'Archiv'],
  'room.werkstatt': ['Workshop', 'Werkstatt'],
  'room.terminal': ['Terminal', 'Terminal'],
  'room.funkturm': ['Radio tower', 'Funkturm'],
  'room.leitstand': ['Control room', 'Leitstand'],
  'room.pausenraum': ['Break room', 'Pausenraum'],

  // ---------- Kern: Zustaende, Verlauf ----------
  'state.active': ['active', 'aktiv'],
  'state.idle': ['ready', 'bereit'],
  'state.done': ['done', 'fertig'],
  'state.error': ['error', 'Fehler'],
  'desk.working': ['working', 'arbeitet'],
  'desk.waiting': ['waiting', 'wartet'],
  'role.commander': ['Commander', 'Kommandant'],
  'crew.noSubs': ['No subagents yet.', 'Noch keine Subagents.'],
  'unit.calls': ['{n} tool calls', '{n} Werkzeug-Aufrufe'],
  'log.system': ['System', 'System'],
  'log.newPrompt': ['New task from you', 'Neuer Auftrag von dir'],
  'log.started': ['started ({role})', 'gestartet ({role})'],
  'log.errorAt': ['Error in {tool}', 'Fehler bei {tool}'],
  'log.tool': ['tool', 'Werkzeug'],
  'log.done': ['done', 'fertig'],
  'log.waitsForYou': ['waiting for you', 'wartet auf dich'],
  'log.interrupted': ['interrupted', 'abgebrochen'],
  'log.notification': ['Notification', 'Benachrichtigung'],
  'log.sessionStart': ['{name} session started', '{name}-Session gestartet'],
  'log.sessionStartIn': ['{name} session started in {proj}', '{name}-Session gestartet in {proj}'],
  'log.sessionEnd': ['{name} session ended', '{name}-Session beendet'],

  // ---------- fx/attention.js ----------
  'att.someAgent': ['An agent', 'Ein Agent'],
  'att.idle': ['{who} is done and waiting for you', '{who} ist fertig und wartet auf dich'],
  'att.input': ['{who} needs your input', '{who} braucht deine Eingabe'],
  'att.perm': ['{who} is waiting for your permission{det}', '{who} wartet auf deine Erlaubnis{det}'],
  'att.bellOn': ['Notifications on: you get an alert when someone is waiting for you and the tab is in the background', 'Benachrichtigen ist an: Meldung, wenn jemand auf dich wartet und der Tab im Hintergrund ist'],
  'att.bellBlocked': ['Notifications are blocked in the browser', 'Benachrichtigungen sind im Browser blockiert'],
  'att.bellOff': ['Notify me when someone is waiting for me (only while the tab is in the background)', 'Benachrichtigen, wenn jemand auf dich wartet (nur wenn der Tab im Hintergrund ist)'],
  'att.bellLabel': ['Notifications', 'Benachrichtigen'],
  'att.connLost': ['Connection to the board lost – reconnecting …', 'Verbindung zum Board unterbrochen – versuche neu …'],
  'ago.now': ['just now', 'gerade eben'],
  'ago.s': ['{n} s ago', 'vor {n} s'],
  'ago.min': ['{n} min ago', 'vor {n} min'],
  'ago.h': ['{n} h ago', 'vor {n} h'],
  'ago.d': ['{n} days ago', 'vor {n} Tagen'],
  'att.lastEvent': ['last event {ago}', 'letztes Ereignis {ago}'],

  // ---------- fx/crew.js ----------
  'crew.waitsForYou': ['waiting for you', 'wartet auf dich'],
  'crew.errTool': ['⚠ Error', '⚠ Fehler'],
  'crew.waitNext': ['waiting for your next message', 'wartet auf deine nächste Nachricht'],
  'crew.needsOk': ['needs your OK', 'braucht dein OK'],
  'crew.needsOkFor': ['{target} – needs your OK', '{target} – braucht dein OK'],
  'crew.waitAnswer': ['waiting for your answer', 'wartet auf deine Antwort'],
  'crew.calls': [(v) => (v.n === 1 ? ' call' : ' calls'), (v) => (v.n === 1 ? ' Aufruf' : ' Aufrufe')],
  'crew.tokens': ['{n} tokens', '{n} Tokens'],
  'crew.curveTokens': [' – curve: token usage', ' – Kurve: Token-Verbrauch'],
  'crew.curveTools': ['curve: tool calls in the last minute', 'Kurve: Werkzeugaufrufe der letzten Minute'],
  'crew.clickDetails': ['{name}{tok} – click for details', '{name}{tok} – Klick für Details'],
  'crew.sumWork': [(v) => `${v.n} working`, (v) => `${v.n} ${v.n === 1 ? 'arbeitet' : 'arbeiten'}`],
  'crew.sumWait': ['{n} waiting', '{n} wartet'],
  'crew.sumDone': ['{n} done', '{n} fertig'],
  'crew.sumErr': [(v) => `${v.n} with ${v.n === 1 ? 'an error' : 'errors'}`, '{n} mit Fehler'],
  'crew.allReady': ['all ready', 'alle bereit'],
  'crew.nobody': ['nobody out yet', 'noch niemand unterwegs'],
  'crew.subsTokens': ['Subagents together: {n} tokens', 'Subagents zusammen: {n} Tokens'],
  'crew.cost': ['Cost so far about ${n}', 'Kosten bisher ca. {n} $'],
  'crew.empty': ['No subagents yet. The commander is waiting for backup.', 'Noch keine Subagents. Der Kommandant wartet auf Verstärkung.'],

  // ---------- fx/health.js ----------
  'h.verb.Read': ['reads', 'liest'],
  'h.verb.Grep': ['searches', 'durchsucht'],
  'h.verb.Glob': ['looks for', 'sucht'],
  'h.verb.WebFetch': ['loads', 'lädt'],
  'h.verb.WebSearch': ['searches for', 'sucht nach'],
  'h.doBash': ['runs “{what}” again and again', 'führt „{what}“ wiederholt aus'],
  'h.doVerb': ['{verb} {what} again and again', '{verb} {what} wiederholt'],
  'h.doTool': ['uses {tool} ({what}) again and again', 'nutzt {tool} ({what}) wiederholt'],
  'h.tool': ['Tool', 'Werkzeug'],
  'h.hangReason': ['{tool} running for {dur}{what}', '{tool} läuft seit {dur}{what}'],
  'h.hangHint': ['{name} seems to be stuck ({tool}{what} running for {dur}). Please check and cancel it or try another approach if needed.', '{name} scheint zu hängen ({tool}{what} läuft seit {dur}). Bitte prüfen und ggf. abbrechen oder anders vorgehen.'],
  'h.hang': ['Stuck?', 'Hängt?'],
  'h.loop': ['Loop?', 'Schleife?'],
  'h.loopRun': ['{tool} {what} {n}× in a row', '{tool} {what} {n}× hintereinander'],
  'h.loopWin': ['{tool} {what} {n}× in the last {win} calls', '{tool} {what} {n}× in den letzten {win} Aufrufen'],
  'h.loopHint': ['{name} seems to be stuck in a loop ({doing}). Please check and try another approach.', '{name} scheint in einer Schleife zu sein ({doing}). Bitte prüfen und anders vorgehen.'],
  'h.pauseUntil': ['Paused until {time}', 'Pause bis {time}'],
  'h.pauseLimit': ['Paused – limit reached', 'Pause – Limit erreicht'],
  'h.limitSoon': ['Limit almost reached', 'Limit bald erreicht'],
  'h.popLabel': ['Note about the agent', 'Hinweis zum Agent'],
  'h.copyHint': ['Copy note', 'Hinweis kopieren'],
  'h.copied': ['Note copied. Paste it into the chat.', 'Hinweis kopiert. Im Chat einfügen.'],
  'h.copyFailed': ['Copying did not work.', 'Kopieren ging nicht.'],
  'h.copiedBtn': ['Copied', 'Kopiert'],

  // ---------- fx/inspect.js ----------
  'i.waitPerm': ['waiting for you (permission)', 'wartet auf dich (Erlaubnis)'],
  'i.working': ['working', 'arbeitet'],
  'i.waiting': ['waiting for you', 'wartet auf dich'],
  'i.done': ['done', 'fertig'],
  'i.error': ['error', 'Fehler'],
  'i.resting': ['resting', 'ruht gerade'],
  'i.closeLabel': ['Close card', 'Karte schliessen'],
  'i.closeTitle': ['Close (Esc)', 'Schliessen (Esc)'],
  'i.details': ['Details for {name}', 'Details zu {name}'],
  'i.task': ['Task', 'Auftrag'],
  'i.noTask': ['no task known', 'kein Auftrag bekannt'],
  'i.justNow': [' · just now', ' · gerade eben'],
  'i.since': [' · for {dur}', ' · seit {dur}'],
  'i.now': ['Now', 'Gerade'],
  'i.noTool': ['no tool open', 'kein Werkzeug offen'],
  'i.running': ['running', 'läuft'],
  'i.failed': ['error', 'Fehler'],
  'i.ok': ['done', 'erledigt'],
  'i.recent': ['Recent', 'Zuletzt'],
  'i.noRecent': ['no tools yet', 'noch keine Werkzeuge'],
  'i.round': ['Round', 'Runde'],
  'i.runtime': ['Runtime', 'Laufzeit'],
  'i.finished': [' (done)', ' (fertig)'],

  // ---------- fx/status.js, kino.js, daynight.js, sound.js ----------
  'st.waitBubble': ['WAITING FOR YOU', 'WARTET AUF DICH'],
  'st.waitShort': ['WAITING', 'WARTET'],
  'kino.btn': ['Cinema', 'Kino'],
  'kino.off': ['Cinema off', 'Kino aus'],
  'kino.title': ['Cinema mode (key K): full screen, just the map', 'Kino-Modus (Taste K): Vollbild, nur die Karte'],
  'dn.compacting': ['Tidying up context', 'Kontext wird aufgeräumt'],
  'dn.context': ['Context {n} %', 'Kontext {n} %'],
  'snd.volume': ['Volume', 'Lautstärke'],
  'snd.music': ['Music', 'Musik'],
  'snd.musicTitle': ['Quiet lo-fi music in the background (only plays while sound is on)', 'Leise Lo-Fi-Musik im Hintergrund (spielt nur, wenn der Ton an ist)'],

  // ---------- fx/timeline.js ----------
  'tl.errorAt': ['Error in {tool}', 'Fehler bei {tool}'],
  'tl.tool': ['tool', 'Werkzeug'],
  'tl.denied': ['Permission denied{tool}', 'Erlaubnis abgelehnt{tool}'],
  'tl.abort': ['Aborted: {err}', 'Abbruch: {err}'],
  'tl.error': ['error', 'Fehler'],
  'tl.title': ['History', 'Verlauf'],
  'tl.toggle': ['Show/hide the session timeline', 'Zeitleiste der Session ein-/ausklappen'],
  'tl.lgWait': ['waiting', 'wartet'],
  'tl.lgErr': ['Error', 'Fehler'],
  'tl.lgComp': ['Compaction', 'Kompaktierung'],
  'tl.scroll': ['Timeline, scrolls horizontally', 'Zeitleiste, waagrecht scrollbar'],
  'tl.empty': ['Nothing has happened yet.', 'Noch nichts passiert.'],
  'tl.comp': ['Compaction{trig}', 'Kompaktierung{trig}'],
  'tl.manual': [' (manual)', ' (manuell)'],
  'tl.auto': [' (automatic)', ' (automatisch)'],
  'tl.stillRunning': ['still running', 'läuft noch'],
  'tl.waitPerm': ['{name} is waiting for permission', '{name} wartet auf Erlaubnis'],
  'tl.since': ['for ', 'seit '],
  'tl.deniedShort': [' · denied', ' · abgelehnt'],
  'tl.runningFor': ['running for {dur}', 'läuft seit {dur}'],
  'tl.errShort': [' · error', ' · Fehler'],
  'tl.aria': ['Timeline: {tracks} tracks, {calls} tool calls since {t}', 'Zeitleiste: {tracks} Spuren, {calls} Werkzeug-Aufrufe seit {t}'],
  'sum.title': ['Round done', 'Runde fertig'],
  'sum.dur': ['Duration', 'Dauer'],
  'sum.agents': ['Agents', 'Agents'],
  'sum.tools': ['Tools', 'Werkzeuge'],
  'sum.errs': ['Errors', 'Fehler'],
  'sum.permsLong': ['Permission requests', 'Erlaubnis-Anfragen'],
  'sum.compsLong': ['Compactions', 'Kompaktierungen'],
  'sum.perms': ['Permission', 'Erlaubnis'],
  'sum.comps': ['Compacted', 'Kompaktiert'],
  'sum.rooms': ['Busiest rooms', 'Meiste Zimmer'],
  'sum.label': ['Round done, summary', 'Runde fertig, Zusammenfassung'],
  'sum.close': ['Close summary', 'Zusammenfassung schliessen'],
  'sum.copy': ['Copy summary', 'Zusammenfassung kopieren'],
  'sum.copied': ['Copied ✓', 'Kopiert ✓'],
  'sum.copyFailed': ['Copying did not work', 'Kopieren ging nicht'],

  // ---------- Demo ----------
  'demo.task0': ['Search the code for ask()', 'Code nach ask() durchsuchen'],
  'demo.task1': ['Build notifications', 'Benachrichtigung bauen'],
  'demo.task2': ['Write tests for notify', 'Tests für notify schreiben'],
  'demo.task3': ['Research a weather API', 'Wetter-API recherchieren'],
  'demo.taskMain': ['Add notifications', 'Benachrichtigungen einbauen'],
  'demo.stopMain': ['Notifications are in, 4 tests green.', 'Benachrichtigungen sind eingebaut, 4 Tests grün.'],
  'demo.stopCodex': ['Homepage rebuilt, build and tests pass.', 'Startseite umgebaut, Build und Tests laufen.'],
  'demo.stopClaude2': ['Found and fixed the alarm bug.', 'Wecker-Bug gefunden und behoben.'],
}

function t(key, vars) {
  const row = D[key]
  let v = row ? (row[col] != null ? row[col] : row[0]) : key
  if (typeof v === 'function') return v(vars || {})
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  return v
}

// Text mit <code>…</code>-Stellen als DOM-Knoten einsetzen (ohne innerHTML; alles andere bleibt reiner Text)
function setRich(n, text) {
  n.textContent = ''
  text.split(/(<code>[^<]*<\/code>)/).forEach((part) => {
    const m = /^<code>([^<]*)<\/code>$/.exec(part)
    if (m) { const c = document.createElement('code'); c.textContent = m[1]; n.append(c) } else if (part) n.append(part)
  })
}

// Statische Texte der Seite: data-i18n="key" (Text), data-i18n-html="key" (Text mit <code>-Stellen),
// data-i18n-attr="attr:key;attr:key", data-i18n-cmd="key" (Befehl zum Kopieren)
function apply(root) {
  document.documentElement.lang = lang === 'de' ? 'de-AT' : 'en'
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n)
  for (const n of root.querySelectorAll('[data-i18n-html]')) setRich(n, t(n.dataset.i18nHtml))
  for (const n of root.querySelectorAll('[data-i18n-cmd]')) n.dataset.cmd = t(n.dataset.i18nCmd)
  for (const n of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of n.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':')
      if (attr && key) n.setAttribute(attr.trim(), t(key.trim()))
    }
  }
}

window.AgentBoardI18n = { lang, langs: LANGS, t, apply, locale: lang === 'de' ? 'de-AT' : 'en-GB' }
apply(document)
})()
