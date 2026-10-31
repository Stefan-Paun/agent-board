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

const api = { INSTALL_CMD, shouldShow }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardEmpty = api
})()
