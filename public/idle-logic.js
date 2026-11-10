// idle-logic.js: Leerlauf-Zeitlimit der Schreibtische ("45 Minuten") und "zuletzt gesehen". Reine Logik ohne DOM,
// getestet in test/idle.test.mjs. Der Server liest dieselbe Datei (vm) und meldet den Wert ueber /health.
(() => {
'use strict'

const DEFAULT_MIN = 45
const MAX_MIN = 24 * 60

// AGENT_BOARD_IDLE_MINUTES: ganze Minuten 1..1440, sonst der Standard (45)
function parseMinutes(v) {
  if (v === undefined || v === null || String(v).trim() === '') return DEFAULT_MIN
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= MAX_MIN ? n : DEFAULT_MIN
}

// Session ohne Ereignis seit mehr als `minutes` -> Schreibtisch verschwindet
function isExpired(seenAt, now, minutes = DEFAULT_MIN) {
  return now - seenAt > parseMinutes(minutes) * 60000
}

// Abstand fuer "zuletzt gesehen vor ...": { unit: 'now'|'s'|'min'|'h'|'d', n } (Schluessel ago.* in i18n.js)
function agoParts(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return { unit: 'now', n: 0 }
  if (s < 60) return { unit: 's', n: s }
  if (s < 3600) return { unit: 'min', n: Math.floor(s / 60) }
  if (s < 86400) return { unit: 'h', n: Math.floor(s / 3600) }
  return { unit: 'd', n: Math.floor(s / 86400) }
}

const api = { DEFAULT_MIN, parseMinutes, isExpired, agoParts }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardIdle = api
})()
