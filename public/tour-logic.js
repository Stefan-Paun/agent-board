// tour-logic.js: Erstbesuch-Tour und Zimmer-Legende (#69). Reine Logik ohne DOM, getestet in
// test/tour.test.mjs. Das DOM (Hervorhebung, Dialog, Legende in der Hilfe) baut fx/tour.js.
// Ziele mit '@' sind Bereiche auf der Karte (Canvas), die fx/tour.js selbst ausmisst; alles andere
// ist ein CSS-Selektor. Je Schritt gilt das erste vorhandene Ziel, fehlt jedes, entfaellt der Schritt.
(() => {
'use strict'

const STEPS = [
  { id: 'rooms', key: 'tour.rooms', targets: ['@rooms', '#city:not([hidden])', '.stage'] },
  { id: 'agent', key: 'tour.agent', targets: ['@agent', '@desk', '#crew'] },
  { id: 'badges', key: 'tour.badges', targets: ['@waiting', '.ab-att-bell', '#crew'] },
  { id: 'history', key: 'tour.history', targets: ['.ab-tl-btn'] },
  { id: 'today', key: 'tour.today', targets: ['.ab-day-btn:not(.ab-week-btn)'] },
  { id: 'settings', key: 'tour.settings', targets: ['header .tools'] },
]

// erstes Ziel, fuer das has(ziel) wahr ist, sonst null
function pickTarget(step, has) {
  for (const t of (step && step.targets) || []) {
    try { if (has(t)) return t } catch { /* Ziel nicht messbar: naechstes */ }
  }
  return null
}

// Schritte mit ihrem Ziel; Schritte ohne vorhandenes Ziel fallen weg
function plan(steps, has) {
  const out = []
  for (const s of steps || []) {
    const target = pickTarget(s, has)
    if (target) out.push({ id: s.id, key: s.key, target })
  }
  return out
}

// naechster Index: 'next' | 'prev' | 'first' | 'last'. Hinter dem letzten Schritt kommt -1 (= fertig).
function move(i, dir, n) {
  if (!(n > 0)) return -1
  if (dir === 'first') return 0
  if (dir === 'last') return n - 1
  if (dir === 'prev') return Math.max(0, i - 1)
  if (dir === 'next') return i + 1 >= n ? -1 : i + 1
  return i
}

// Taste im offenen Tour-Dialog -> Aktion (oder null). Enter heisst "weiter", ausser der Fokus liegt
// auf einem Knopf (onButton): dann loest der Knopf selbst aus.
function keyAction(e, onButton) {
  if (!e || typeof e.key !== 'string' || e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': return 'next'
    case 'ArrowLeft': case 'ArrowUp': return 'prev'
    case 'Home': return 'first'
    case 'End': return 'last'
    case 'Escape': return 'close'
    case 'Enter': return onButton ? null : 'next'
    case 'Tab': return e.shiftKey ? 'tabBack' : 'tab'
    default: return null
  }
}

// Startet die Tour von selbst? Nur beim ersten Besuch (seen), nie mit ?tour=0, immer mit ?tour=1.
// Sie wartet, bis es etwas zu zeigen gibt: Demo oder live mit mindestens einem Agent (sonst steht
// dort noch die Einrichtungs-Karte, die selbst erklaert, was zu tun ist).
function shouldAutoStart({ seen = false, query = '', mode = 'off', agents = 0 } = {}) {
  if (query === '0') return false
  if (query === '1') return true
  if (seen) return false
  return (mode === 'demo' || mode === 'live') && agents > 0
}

// Legende aus STATIONS (app.js): je Zimmer Name, ein Satz, die Werkzeuge. Neue Zimmer erscheinen
// von selbst; fehlt ihr Satz in i18n.js, schlaegt test/tour.test.mjs an.
function legend(stations) {
  return (stations || []).map((s) => ({
    id: s.id, icon: s.icon || s.id, nameKey: 'room.' + s.id, textKey: 'legend.room.' + s.id,
    tools: Array.isArray(s.tools) ? s.tools.slice() : [],
  }))
}

const api = { STEPS, pickTarget, plan, move, keyAction, shouldAutoStart, legend, SEEN_KEY: 'ab-tour-seen' }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardTour = api
})()
