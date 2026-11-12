// empty-logic.js: Leerzustand ("No session yet"). Reine Logik, haengt nicht am DOM, getestet in test/empty.test.mjs.
// Die Karte steht ueber Raum- und Stadtansicht und verschwindet mit dem ersten Ereignis oder im Demo-Modus.
(() => {
'use strict'

const INSTALL_CMD = 'node install.mjs'

// agents = Anzahl bekannter Agents, log = Anzahl Logzeilen (beides 0 = seit dem Start kein Ereignis),
// mode = 'live' | 'off' | 'demo'. Offline zeigt die Karte ebenfalls (Hilfe fuer die Ersteinrichtung).
function shouldShow({ agents = 0, log = 0, mode = 'off' } = {}) {
  if (agents > 0 || log > 0) return false
  return mode === 'live' || mode === 'off'
}

// Selbstcheck (/doctor) fuer die Karte aufbereiten. results kommt vom Server (doctor.mjs: publicResults),
// t ist die Uebersetzung. Beschriftung und Hinweis werden ueber id/hintKey uebersetzt; fehlt ein
// Schluessel (aelterer Server, neuer Pruefpunkt), bleibt der englische Text vom Server stehen.
// Ergebnis: Zeilen { status, mark, label, detail, hint }; detail/hint nur bei warn/fail.
const MARKS = { ok: '✓', warn: '!', fail: '✗' }
function doctorRows(results, t) {
  const tr = (key, vars, fallback) => { const v = t(key, vars); return v === key ? fallback : v }
  const str = (v) => (typeof v === 'string' ? v : '')
  return (Array.isArray(results) ? results : []).filter((r) => r && MARKS[r.status]).map((r) => {
    const bad = r.status !== 'ok'
    return {
      status: r.status, mark: MARKS[r.status],
      label: tr('doctor.l.' + str(r.id), null, str(r.label)),
      detail: bad ? str(r.detail) : '',
      hint: bad && r.hint ? tr('doctor.h.' + str(r.hintKey), r.vars && typeof r.vars === 'object' ? r.vars : {}, str(r.hint)) : '',
    }
  })
}

const api = { INSTALL_CMD, shouldShow, doctorRows }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardEmpty = api
})()
