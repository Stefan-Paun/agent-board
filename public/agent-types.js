// Hemdfarben nach Subagent-Typ (agent_type) plus Legende. Reine Funktionen ohne DOM,
// getestet in test/agent-types.test.mjs. Eine feste Tabelle fuer die eingebauten Typen; eigene Typen bekommen eine stabile Farbe aus einem Hash des Namens.
// Die Namen ("Agent 1", "Agent 2") bleiben, nur das Hemd verraet, wer recherchiert und wer baut.
(function (root) {
'use strict'
const TYPES = [
  { key: 'explore', label: 'Explore', color: '#2a9fb8' },
  { key: 'plan', label: 'Plan', color: '#8a5cc8' },
  { key: 'general-purpose', label: 'general-purpose', color: '#e07a1f' },
  { key: 'claude-code-guide', label: 'claude-code-guide', color: '#d6b933' },
  { key: 'statusline-setup', label: 'statusline-setup', color: '#4fae5e' },
  { key: 'bash', label: 'bash', color: '#d9577f' },
]
const OTHER = { key: 'other', label: '', color: '#8a8578' }
// Codex nennt den Recherche-Typ "explorer"
const ALIAS = { explorer: 'explore' }

function norm(type) {
  const k = String(type == null ? '' : type).trim().toLowerCase()
  return ALIAS[k] || k
}
// Generic names carry no information and stay neutral grey
const GENERIC = new Set(['', 'agent', 'unknown', 'other'])

// FNV-1a: deterministic across reloads and platforms
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function hslHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
const customColor = (key) => hslHex(hash(key) % 360, 0.55, 0.55)

function entryFor(type) {
  const key = typeof type === 'string' ? norm(type) : ''
  const fixed = TYPES.find((t) => t.key === key)
  if (fixed) return fixed
  if (GENERIC.has(key)) return OTHER
  return { key, label: key.length > 24 ? key.slice(0, 23) + '\u2026' : key, color: customColor(key), custom: true }
}
const colorFor = (type) => entryFor(type).color

// Legende: nur Typen, die gerade vorkommen; feste Typen in Tabellenreihenfolge, danach eigene
// (alphabetisch), "other" (neutral) zuletzt.
function legendFor(types) {
  const seen = new Map()
  for (const t of types || []) { const e = entryFor(t); seen.set(e.key, e) }
  const fixed = [...TYPES, OTHER].filter((t) => seen.has(t.key) && t !== OTHER)
  const custom = [...seen.values()].filter((e) => e.custom).sort((x, y) => (x.key < y.key ? -1 : 1))
  const other = seen.has(OTHER.key) ? [OTHER] : []
  return [...fixed, ...custom, ...other].map((t) => ({ key: t.key, label: t.label, color: t.color }))
}

root.AgentBoardTypes = { TYPES, OTHER, colorFor, legendFor }
})(typeof window !== 'undefined' ? window : globalThis)
