// machine-logic.js: zweiter Rechner (docs/SECOND-MACHINE.md). Reine Logik, haengt nicht am DOM, getestet in
// test/machines.test.mjs. Ereignisse eines anderen Rechners tragen `machine` (vom Server gestempelt, siehe
// ingest.mjs); lokale Ereignisse haben das Feld nicht. Filterwerte: 'all', 'this' (dieser Rechner) oder ein Name.
(() => {
'use strict'

const NAME = /^[a-z0-9][a-z0-9-]{0,15}$/
const RESERVED = ['all', 'this', 'local', 'localhost', 'claude', 'codex', 'gemini']

// Maschinenname eines Ereignisses, '' = dieser Rechner. Alles, was kein kurzer Name ist, zaehlt als lokal
// und wird nie angezeigt (die Anzeige vertraut dem Log nicht blind).
function machineOf(ev) {
  const m = ev && ev.machine
  return typeof m === 'string' && NAME.test(m) && !RESERVED.includes(m) ? m : ''
}

// Passt ein Ereignis (bzw. sein Maschinenname) zum Filter?
function matches(filter, machine) {
  if (filter === 'all' || !filter) return true
  if (filter === 'this') return machine === ''
  return machine === filter
}

// Auswahl fuer den Filter: alle / dieser Rechner / <Name>...; leer, solange kein zweiter Rechner da ist
function options(machines) {
  const names = [...new Set(machines)].filter((m) => typeof m === 'string' && NAME.test(m) && !RESERVED.includes(m)).sort()
  return names.length ? ['all', 'this', ...names] : []
}

// Ein Filter auf einen Rechner, den es (noch) nicht gibt, wuerde ein leeres Board zeigen: dann 'all'
function normalize(filter, machines) {
  if (filter === 'this') return 'this'
  return typeof filter === 'string' && machines.includes(filter) && NAME.test(filter) && !RESERVED.includes(filter) ? filter : 'all'
}

// Namenszusatz in der Szene: "Claude @pc-two"
function tag(name, machine) { return machine ? `${name} @${machine}` : name }

// Zwei Ereignislisten nach Zeit zusammenfuehren (gleiche Zeit: Reihenfolge bleibt, a vor b). Die Listen
// selbst muessen nicht sortiert sein: Ereignisse eines zweiten Rechners koennen etwas verspaetet ankommen.
function merge(a, b) {
  if (!b.length) return a
  if (!a.length) return b
  const t = (e) => Number(e && e.t) || 0
  return [...a, ...b].sort((x, y) => t(x) - t(y))
}

const api = { machineOf, matches, options, normalize, tag, merge }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardMachines = api
})()
