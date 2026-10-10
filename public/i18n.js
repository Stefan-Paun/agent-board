// Uebersetzungen der Oberflaeche. Laedt als erstes Skript, vor app.js und den fx-Modulen.
// Sprache: ?lang=en|de|es (wird gemerkt), sonst gespeicherte Wahl, sonst Browsersprache (de* -> Deutsch,
// es* -> Spanisch, alles andere -> Englisch). Neue Sprache: eine weitere Spalte in D, ein Eintrag in LANGS und LOCALES (und die Erkennung in detect).
// Werte sind Texte mit {platzhaltern} oder Funktionen (vars) => Text (z.B. fuer Einzahl/Mehrzahl).
(() => {
'use strict'
const LANGS = ['en', 'de', 'es']
const tryLS = (fn) => { try { return fn() } catch { return null } }

function detect() {
  const q = new URLSearchParams(location.search).get('lang')
  if (q && LANGS.includes(q)) { tryLS(() => localStorage.setItem('ab-lang', q)); return q }
  const saved = tryLS(() => localStorage.getItem('ab-lang'))
  if (saved && LANGS.includes(saved)) return saved
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || ''
  return /^de\b/i.test(nav) ? 'de' : /^es\b/i.test(nav) ? 'es' : 'en'
}
const lang = detect()
const LOCALES = { en: 'en-GB', de: 'de-AT', es: 'es-ES' }
const col = LANGS.indexOf(lang)

// key: [Englisch, Deutsch, Spanisch]
const D = {
  // ---------- Seite (index.html) ----------
  'page.desc': ['A calm overview of your coding agents: who is doing what, as a little pixel apartment.', 'Ruhige Übersicht über deine Coding-Agents: wer gerade was macht, als kleine Pixel-Wohnung.', 'Una vista tranquila de tus agentes de programación: quién hace qué, como un pequeño piso en píxeles.'],
  'stats.label': ['Counters', 'Zähler', 'Contadores'],
  'stats.active': ['Active', 'Aktiv', 'Activos'],
  'stats.done': ['Done', 'Fertig', 'Listos'],
  'stats.err': ['Errors', 'Fehler', 'Errores'],
  'stats.tools': ['Tools', 'Werkzeuge', 'Herramientas'],
  'map.label': ['Map of the agents. A list of all agents is on the right.', 'Karte der Agents. Eine Liste mit allen Agents steht rechts.', 'Mapa de los agentes. A la derecha hay una lista con todos los agentes.'],
  'empty.text': ['Nobody here yet. As soon as a Claude Code (or Codex) session runs with the hooks (once: <code>node install.mjs</code>), the agents move in.', 'Noch ist niemand da. Sobald eine Claude-Code- (oder Codex-)Session mit den Hooks läuft (einmalig <code>node install.mjs</code>), ziehen hier die Agents ein.', 'Aún no hay nadie. En cuanto una sesión de Claude Code (o Codex) funcione con los hooks (una vez: <code>node install.mjs</code>), los agentes se mudan aquí.'],
  'empty.demo': ['Start demo', 'Demo starten', 'Iniciar demo'],
  'crew.title': ['Crew', 'Besatzung', 'Tripulación'],
  'controls.label': ['Commands for the chat', 'Befehle für den Chat', 'Comandos para el chat'],
  'btn.stop': ['Stop', 'Stopp', 'Parar'],
  'cmd.stop': ['stop', 'stopp', 'para'],
  'btn.continue': ['Continue', 'Weiter', 'Seguir'],
  'cmd.continue': ['continue', 'mach weiter', 'sigue'],
  'btn.status': ['Status', 'Status', 'Estado'],
  'cmd.status': ['What is the status? Which agents are running and what are they doing right now?', 'Wie ist der Stand? Welche Agents laufen und was machen sie gerade?', '¿Cómo va todo? ¿Qué agentes están activos y qué están haciendo ahora?'],
  'btn.newRound': ['New round', 'Neue Runde', 'Nueva ronda'],
  'cmd.newRound': ['start a new round', 'starte eine neue Runde', 'empieza una nueva ronda'],
  'msg.to': ['To', 'An', 'Para'],
  'msg.all': ['all agents', 'alle Agents', 'todos los agentes'],
  'msg.text': ['Message', 'Nachricht', 'Mensaje'],
  'msg.placeholder': ['Message to an agent …', 'Nachricht an einen Agent …', 'Mensaje para un agente …'],
  'msg.copy': ['Copy', 'Kopieren', 'Copiar'],
  'msg.toOne': ['Tell {to}: {txt}', 'Sag {to}: {txt}', 'Dile a {to}: {txt}'],
  'msg.toAll': ['Tell all running agents: {txt}', 'Sag allen laufenden Agents: {txt}', 'Diles a todos los agentes activos: {txt}'],
  'toast.copied': ['Copied: “{text}”. Paste it into the chat.', 'Kopiert: „{text}“. Im Chat einfügen.', 'Copiado: «{text}». Pégalo en el chat.'],
  'sound.on': ['Sound on', 'Ton an', 'Con sonido'],
  'sound.off': ['Sound off', 'Ton aus', 'Sin sonido'],
  'sound.saved': ['Sound is saved as on; one click turns it on (browser rule).', 'Ton ist gespeichert an; ein Klick aktiviert ihn (Browser-Regel).', 'El sonido está guardado como activado; un clic lo enciende (regla del navegador).'],
  'conn.live': ['Live', 'Live', 'En vivo'],
  'conn.demo': ['Demo', 'Demo', 'Demo'],
  'conn.off': ['Offline', 'Offline', 'Sin conexión'],
  'lang.label': ['Language', 'Sprache', 'Idioma'],

  // ---------- Raeume ----------
  'room.archiv': ['Archive', 'Archiv', 'Archivo'],
  'room.werkstatt': ['Workshop', 'Werkstatt', 'Taller'],
  'room.terminal': ['Terminal', 'Terminal', 'Terminal'],
  'room.funkturm': ['Radio tower', 'Funkturm', 'Torre de radio'],
  'room.leitstand': ['Control room', 'Leitstand', 'Sala de control'],
  'room.pausenraum': ['Break room', 'Pausenraum', 'Sala de descanso'],

  // ---------- Kern: Zustaende, Verlauf ----------
  'state.active': ['active', 'aktiv', 'activo'],
  'state.idle': ['ready', 'bereit', 'listo'],
  'state.done': ['done', 'fertig', 'terminado'],
  'state.error': ['error', 'Fehler', 'error'],
  'desk.working': ['working', 'arbeitet', 'trabajando'],
  'desk.waiting': ['waiting', 'wartet', 'esperando'],
  'role.commander': ['Commander', 'Kommandant', 'Comandante'],
  'crew.noSubs': ['No subagents yet.', 'Noch keine Subagents.', 'Todavía no hay subagentes.'],
  'unit.calls': ['{n} tool calls', '{n} Werkzeug-Aufrufe', '{n} llamadas a herramientas'],
  'log.system': ['System', 'System', 'Sistema'],
  'log.newPrompt': ['New task from you', 'Neuer Auftrag von dir', 'Nueva tarea tuya'],
  'log.started': ['started ({role})', 'gestartet ({role})', 'empezó ({role})'],
  'log.errorAt': ['Error in {tool}', 'Fehler bei {tool}', 'Error en {tool}'],
  'log.tool': ['tool', 'Werkzeug', 'herramienta'],
  'log.done': ['done', 'fertig', 'terminado'],
  'log.waitsForYou': ['waiting for you', 'wartet auf dich', 'te espera'],
  'log.interrupted': ['interrupted', 'abgebrochen', 'interrumpido'],
  'log.notification': ['Notification', 'Benachrichtigung', 'Notificación'],
  'log.sessionStart': ['{name} session started', '{name}-Session gestartet', 'Sesión de {name} iniciada'],
  'log.sessionStartIn': ['{name} session started in {proj}', '{name}-Session gestartet in {proj}', 'Sesión de {name} iniciada en {proj}'],
  'log.sessionEnd': ['{name} session ended', '{name}-Session beendet', 'Sesión de {name} terminada'],

  // ---------- fx/attention.js ----------
  'att.someAgent': ['An agent', 'Ein Agent', 'Un agente'],
  'att.idle': ['{who} is done and waiting for you', '{who} ist fertig und wartet auf dich', '{who} ha terminado y te espera'],
  'att.input': ['{who} needs your input', '{who} braucht deine Eingabe', '{who} necesita tu respuesta'],
  'att.perm': ['{who} is waiting for your permission{det}', '{who} wartet auf deine Erlaubnis{det}', '{who} espera tu permiso{det}'],
  'att.bellOn': ['Notifications on: you get an alert when someone is waiting for you and the tab is in the background', 'Benachrichtigen ist an: Meldung, wenn jemand auf dich wartet und der Tab im Hintergrund ist', 'Avisos activados: recibes un aviso cuando alguien te espera y la pestaña está en segundo plano'],
  'att.bellBlocked': ['Notifications are blocked in the browser', 'Benachrichtigungen sind im Browser blockiert', 'Los avisos están bloqueados en el navegador'],
  'att.bellOff': ['Notify me when someone is waiting for me (only while the tab is in the background)', 'Benachrichtigen, wenn jemand auf dich wartet (nur wenn der Tab im Hintergrund ist)', 'Avisarme cuando alguien me espera (solo con la pestaña en segundo plano)'],
  'att.bellLabel': ['Notifications', 'Benachrichtigen', 'Avisos'],
  'att.connLost': ['Connection to the board lost – reconnecting …', 'Verbindung zum Board unterbrochen – versuche neu …', 'Se perdió la conexión con el tablero – reconectando …'],
  'ago.now': ['just now', 'gerade eben', 'ahora mismo'],
  'ago.s': ['{n} s ago', 'vor {n} s', 'hace {n} s'],
  'ago.min': ['{n} min ago', 'vor {n} min', 'hace {n} min'],
  'ago.h': ['{n} h ago', 'vor {n} h', 'hace {n} h'],
  'ago.d': ['{n} days ago', 'vor {n} Tagen', 'hace {n} días'],
  'att.lastEvent': ['last event {ago}', 'letztes Ereignis {ago}', 'último evento {ago}'],

  // ---------- fx/crew.js ----------
  'crew.waitsForYou': ['waiting for you', 'wartet auf dich', 'te espera'],
  'crew.errTool': ['⚠ Error', '⚠ Fehler', '⚠ Error'],
  'crew.waitNext': ['waiting for your next message', 'wartet auf deine nächste Nachricht', 'espera tu próximo mensaje'],
  'crew.needsOk': ['needs your OK', 'braucht dein OK', 'necesita tu OK'],
  'crew.needsOkFor': ['{target} – needs your OK', '{target} – braucht dein OK', '{target} – necesita tu OK'],
  'crew.waitAnswer': ['waiting for your answer', 'wartet auf deine Antwort', 'espera tu respuesta'],
  'crew.calls': [(v) => (v.n === 1 ? ' call' : ' calls'), (v) => (v.n === 1 ? ' Aufruf' : ' Aufrufe'), (v) => (v.n === 1 ? ' llamada' : ' llamadas')],
  'crew.tokens': ['{n} tokens', '{n} Tokens', '{n} tokens'],
  'crew.curveTokens': [' – curve: token usage', ' – Kurve: Token-Verbrauch', ' – curva: uso de tokens'],
  'crew.curveTools': ['curve: tool calls in the last minute', 'Kurve: Werkzeugaufrufe der letzten Minute', 'curva: llamadas a herramientas en el último minuto'],
  'crew.clickDetails': ['{name}{tok} – click for details', '{name}{tok} – Klick für Details', '{name}{tok} – clic para ver detalles'],
  'crew.sumWork': [(v) => `${v.n} working`, (v) => `${v.n} ${v.n === 1 ? 'arbeitet' : 'arbeiten'}`, (v) => `${v.n} ${v.n === 1 ? 'trabaja' : 'trabajan'}`],
  'crew.sumWait': ['{n} waiting', '{n} wartet', (v) => `${v.n} ${v.n === 1 ? 'espera' : 'esperan'}`],
  'crew.sumDone': ['{n} done', '{n} fertig', (v) => `${v.n} ${v.n === 1 ? 'terminado' : 'terminados'}`],
  'crew.sumErr': [(v) => `${v.n} with ${v.n === 1 ? 'an error' : 'errors'}`, '{n} mit Fehler', (v) => `${v.n} con ${v.n === 1 ? 'error' : 'errores'}`],
  'crew.allReady': ['all ready', 'alle bereit', 'todos listos'],
  'crew.nobody': ['nobody out yet', 'noch niemand unterwegs', 'nadie en marcha todavía'],
  'crew.subsTokens': ['Subagents together: {n} tokens', 'Subagents zusammen: {n} Tokens', 'Subagentes en total: {n} tokens'],
  'crew.cost': ['Cost so far about ${n}', 'Kosten bisher ca. {n} $', 'Coste hasta ahora aprox. {n} $'],
  'crew.empty': ['No subagents yet. The commander is waiting for backup.', 'Noch keine Subagents. Der Kommandant wartet auf Verstärkung.', 'Todavía no hay subagentes. El comandante espera refuerzos.'],

  // ---------- fx/health.js ----------
  'h.verb.Read': ['reads', 'liest', 'lee'],
  'h.verb.Grep': ['searches', 'durchsucht', 'busca en'],
  'h.verb.Glob': ['looks for', 'sucht', 'busca'],
  'h.verb.WebFetch': ['loads', 'lädt', 'carga'],
  'h.verb.WebSearch': ['searches for', 'sucht nach', 'busca'],
  'h.doBash': ['runs “{what}” again and again', 'führt „{what}“ wiederholt aus', 'ejecuta «{what}» una y otra vez'],
  'h.doVerb': ['{verb} {what} again and again', '{verb} {what} wiederholt', '{verb} {what} una y otra vez'],
  'h.doTool': ['uses {tool} ({what}) again and again', 'nutzt {tool} ({what}) wiederholt', 'usa {tool} ({what}) una y otra vez'],
  'h.tool': ['Tool', 'Werkzeug', 'Herramienta'],
  'h.hangReason': ['{tool} running for {dur}{what}', '{tool} läuft seit {dur}{what}', '{tool} lleva {dur} en marcha{what}'],
  'h.hangHint': ['{name} seems to be stuck ({tool}{what} running for {dur}). Please check and cancel it or try another approach if needed.', '{name} scheint zu hängen ({tool}{what} läuft seit {dur}). Bitte prüfen und ggf. abbrechen oder anders vorgehen.', '{name} parece estar atascado ({tool}{what} lleva {dur} en marcha). Revísalo y, si hace falta, cancélalo o prueba otro camino.'],
  'h.hang': ['Stuck?', 'Hängt?', '¿Atascado?'],
  'h.loop': ['Loop?', 'Schleife?', '¿Bucle?'],
  'h.loopRun': ['{tool} {what} {n}× in a row', '{tool} {what} {n}× hintereinander', '{tool} {what} {n}× seguidas'],
  'h.loopWin': ['{tool} {what} {n}× in the last {win} calls', '{tool} {what} {n}× in den letzten {win} Aufrufen', '{tool} {what} {n}× en las últimas {win} llamadas'],
  'h.loopHint': ['{name} seems to be stuck in a loop ({doing}). Please check and try another approach.', '{name} scheint in einer Schleife zu sein ({doing}). Bitte prüfen und anders vorgehen.', '{name} parece estar en un bucle ({doing}). Revísalo y prueba otro camino.'],
  'h.pauseUntil': ['Paused until {time}', 'Pause bis {time}', 'Pausa hasta las {time}'],
  'h.pauseLimit': ['Paused – limit reached', 'Pause – Limit erreicht', 'Pausa – límite alcanzado'],
  'h.limitSoon': ['Limit almost reached', 'Limit bald erreicht', 'Límite casi alcanzado'],
  'h.popLabel': ['Note about the agent', 'Hinweis zum Agent', 'Aviso sobre el agente'],
  'h.copyHint': ['Copy note', 'Hinweis kopieren', 'Copiar aviso'],
  'h.copied': ['Note copied. Paste it into the chat.', 'Hinweis kopiert. Im Chat einfügen.', 'Aviso copiado. Pégalo en el chat.'],
  'h.copyFailed': ['Copying did not work.', 'Kopieren ging nicht.', 'No se pudo copiar.'],
  'h.copiedBtn': ['Copied', 'Kopiert', 'Copiado'],

  // ---------- fx/inspect.js ----------
  'i.waitPerm': ['waiting for you (permission)', 'wartet auf dich (Erlaubnis)', 'te espera (permiso)'],
  'i.working': ['working', 'arbeitet', 'trabajando'],
  'i.waiting': ['waiting for you', 'wartet auf dich', 'te espera'],
  'i.done': ['done', 'fertig', 'terminado'],
  'i.error': ['error', 'Fehler', 'error'],
  'i.resting': ['resting', 'ruht gerade', 'en reposo'],
  'i.closeLabel': ['Close card', 'Karte schliessen', 'Cerrar tarjeta'],
  'i.closeTitle': ['Close (Esc)', 'Schliessen (Esc)', 'Cerrar (Esc)'],
  'i.details': ['Details for {name}', 'Details zu {name}', 'Detalles de {name}'],
  'i.task': ['Task', 'Auftrag', 'Tarea'],
  'i.noTask': ['no task known', 'kein Auftrag bekannt', 'ninguna tarea conocida'],
  'i.justNow': [' · just now', ' · gerade eben', ' · ahora mismo'],
  'i.since': [' · for {dur}', ' · seit {dur}', ' · desde hace {dur}'],
  'i.now': ['Now', 'Gerade', 'Ahora'],
  'i.noTool': ['no tool open', 'kein Werkzeug offen', 'ninguna herramienta abierta'],
  'i.running': ['running', 'läuft', 'en marcha'],
  'i.failed': ['error', 'Fehler', 'error'],
  'i.ok': ['done', 'erledigt', 'hecho'],
  'i.recent': ['Recent', 'Zuletzt', 'Últimas'],
  'i.noRecent': ['no tools yet', 'noch keine Werkzeuge', 'todavía sin herramientas'],
  'i.round': ['Round', 'Runde', 'Ronda'],
  'i.runtime': ['Runtime', 'Laufzeit', 'Duración'],
  'i.finished': [' (done)', ' (fertig)', ' (terminado)'],

  // ---------- fx/status.js, kino.js, daynight.js, sound.js ----------
  'st.waitBubble': ['WAITING FOR YOU', 'WARTET AUF DICH', 'TE ESPERA'],
  'st.waitShort': ['WAITING', 'WARTET', 'ESPERA'],
  'kino.btn': ['Cinema', 'Kino', 'Cine'],
  'kino.off': ['Cinema off', 'Kino aus', 'Salir del cine'],
  'kino.title': ['Cinema mode (key K): full screen, just the map', 'Kino-Modus (Taste K): Vollbild, nur die Karte', 'Modo cine (tecla K): pantalla completa, solo el mapa'],
  'dn.compacting': ['Tidying up context', 'Kontext wird aufgeräumt', 'Ordenando el contexto'],
  'dn.context': ['Context {n} %', 'Kontext {n} %', 'Contexto {n} %'],
  'snd.volume': ['Volume', 'Lautstärke', 'Volumen'],
  'snd.music': ['Music', 'Musik', 'Música'],
  'snd.musicTitle': ['Quiet lo-fi music in the background (only plays while sound is on)', 'Leise Lo-Fi-Musik im Hintergrund (spielt nur, wenn der Ton an ist)', 'Música lo-fi suave de fondo (solo suena con el sonido activado)'],

  // ---------- fx/timeline.js ----------
  'tl.errorAt': ['Error in {tool}', 'Fehler bei {tool}', 'Error en {tool}'],
  'tl.tool': ['tool', 'Werkzeug', 'herramienta'],
  'tl.denied': ['Permission denied{tool}', 'Erlaubnis abgelehnt{tool}', 'Permiso denegado{tool}'],
  'tl.abort': ['Aborted: {err}', 'Abbruch: {err}', 'Cancelado: {err}'],
  'tl.error': ['error', 'Fehler', 'error'],
  'tl.title': ['History', 'Verlauf', 'Historial'],
  'tl.toggle': ['Show/hide the session timeline', 'Zeitleiste der Session ein-/ausklappen', 'Mostrar/ocultar la línea de tiempo de la sesión'],
  'tl.lgWait': ['waiting', 'wartet', 'espera'],
  'tl.lgErr': ['Error', 'Fehler', 'Error'],
  'tl.lgComp': ['Compaction', 'Kompaktierung', 'Compactación'],
  'tl.scroll': ['Timeline, scrolls horizontally', 'Zeitleiste, waagrecht scrollbar', 'Línea de tiempo, se desplaza en horizontal'],
  'tl.empty': ['Nothing has happened yet.', 'Noch nichts passiert.', 'Todavía no ha pasado nada.'],
  'tl.comp': ['Compaction{trig}', 'Kompaktierung{trig}', 'Compactación{trig}'],
  'tl.manual': [' (manual)', ' (manuell)', ' (manual)'],
  'tl.auto': [' (automatic)', ' (automatisch)', ' (automática)'],
  'tl.stillRunning': ['still running', 'läuft noch', 'todavía en marcha'],
  'tl.waitPerm': ['{name} is waiting for permission', '{name} wartet auf Erlaubnis', '{name} espera un permiso'],
  'tl.since': ['for ', 'seit ', 'desde hace '],
  'tl.deniedShort': [' · denied', ' · abgelehnt', ' · denegado'],
  'tl.runningFor': ['running for {dur}', 'läuft seit {dur}', 'en marcha desde hace {dur}'],
  'tl.errShort': [' · error', ' · Fehler', ' · error'],
  'tl.aria': ['Timeline: {tracks} tracks, {calls} tool calls since {t}', 'Zeitleiste: {tracks} Spuren, {calls} Werkzeug-Aufrufe seit {t}', 'Línea de tiempo: {tracks} pistas, {calls} llamadas a herramientas desde las {t}'],
  'sum.title': ['Round done', 'Runde fertig', 'Ronda terminada'],
  'sum.dur': ['Duration', 'Dauer', 'Duración'],
  'sum.agents': ['Agents', 'Agents', 'Agentes'],
  'sum.tools': ['Tools', 'Werkzeuge', 'Herramientas'],
  'sum.errs': ['Errors', 'Fehler', 'Errores'],
  'sum.permsLong': ['Permission requests', 'Erlaubnis-Anfragen', 'Solicitudes de permiso'],
  'sum.compsLong': ['Compactions', 'Kompaktierungen', 'Compactaciones'],
  'sum.perms': ['Permission', 'Erlaubnis', 'Permisos'],
  'sum.comps': ['Compacted', 'Kompaktiert', 'Compactado'],
  'sum.rooms': ['Busiest rooms', 'Meiste Zimmer', 'Salas más usadas'],
  'sum.label': ['Round done, summary', 'Runde fertig, Zusammenfassung', 'Ronda terminada, resumen'],
  'sum.close': ['Close summary', 'Zusammenfassung schliessen', 'Cerrar resumen'],
  'sum.copy': ['Copy summary', 'Zusammenfassung kopieren', 'Copiar resumen'],
  'sum.copied': ['Copied ✓', 'Kopiert ✓', 'Copiado ✓'],
  'sum.copyFailed': ['Copying did not work', 'Kopieren ging nicht', 'No se pudo copiar'],

  // ---------- Demo ----------
  'demo.task0': ['Search the code for ask()', 'Code nach ask() durchsuchen', 'Buscar ask() en el código'],
  'demo.task1': ['Build notifications', 'Benachrichtigung bauen', 'Crear notificaciones'],
  'demo.task2': ['Write tests for notify', 'Tests für notify schreiben', 'Escribir tests para notify'],
  'demo.task3': ['Research a weather API', 'Wetter-API recherchieren', 'Investigar una API del tiempo'],
  'demo.taskMain': ['Add notifications', 'Benachrichtigungen einbauen', 'Añadir notificaciones'],
  'demo.stopMain': ['Notifications are in, 4 tests green.', 'Benachrichtigungen sind eingebaut, 4 Tests grün.', 'Las notificaciones ya están, 4 tests en verde.'],
  'demo.stopCodex': ['Homepage rebuilt, build and tests pass.', 'Startseite umgebaut, Build und Tests laufen.', 'Página de inicio renovada, build y tests en verde.'],
  'demo.stopClaude2': ['Found and fixed the alarm bug.', 'Wecker-Bug gefunden und behoben.', 'Encontré y arreglé el fallo del despertador.'],
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
  document.documentElement.lang = LOCALES[lang]
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

// Sprachwahl in der Kopfzeile: zugeklappt nur das Kuerzel ("DE"), aufgeklappt "DE · Deutsch" usw.
// Merkt die Wahl und laedt die Seite in der neuen Sprache; die Sprache steht danach auch in der
// Adresse, damit es ohne localStorage (privates Fenster) klappt.
function wireSwitch() {
  const sel = document.getElementById('lang')
  if (!sel) return
  const full = new Map([...sel.options].map((o) => [o, o.textContent]))
  const short = () => { for (const o of sel.options) o.textContent = o.value.toUpperCase() }
  const long = () => { for (const o of sel.options) o.textContent = full.get(o) }
  sel.value = lang
  short()
  // beim Aufklappen die vollen Namen zeigen, danach wieder nur das Kuerzel
  sel.addEventListener('pointerdown', long)
  sel.addEventListener('keydown', long)
  sel.addEventListener('blur', short)
  sel.addEventListener('change', () => {
    const l = sel.value
    if (l === lang || !LANGS.includes(l)) { short(); return }
    tryLS(() => localStorage.setItem('ab-lang', l))
    const url = new URL(location.href)
    url.searchParams.set('lang', l)
    location.assign(url.href)
  })
}

window.AgentBoardI18n = { lang, langs: LANGS, t, apply, locale: LOCALES[lang], table: D }
apply(document)
wireSwitch()
})()
