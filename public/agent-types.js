// Hemdfarben nach Subagent-Typ (agent_type) plus Legende. Reine Funktionen ohne DOM,
// getestet in test/agent-types.test.mjs. Eine feste Tabelle, unbekannte Typen sind neutral grau.
// Die Namen ("Agent 1", "Agent 2") bleiben, nur das Hemd verraet, wer recherchiert und wer baut.
(function (root) {
'use strict'
const TYPES = [
  { key: 'explore', label: 'Explore', color: '#2a9fb8' },
  { key: 'plan', label: 'Plan', color: '#8a5cc8' },
  { key: 'general-purpose', label: 'general-purpose', color: '#e07a1f' },
]
const OTHER = { key: 'other', label: '', color: '#8a8578' }
// Codex nennt den Recherche-Typ "explorer"
const ALIAS = { explorer: 'explore' }

function norm(type) {
  const k = String(type == null ? '' : type).trim().toLowerCase()
  return ALIAS[k] || k
}
const entryFor = (type) => TYPES.find((t) => t.key === norm(type)) || OTHER
const colorFor = (type) => entryFor(type).color

// Legende: nur Typen, die gerade vorkommen, in Tabellenreihenfolge; "other" (neutral) zuletzt.
function legendFor(types) {
  const seen = new Set((types || []).map((t) => entryFor(t).key))
  return [...TYPES, OTHER].filter((t) => seen.has(t.key)).map((t) => ({ key: t.key, label: t.label, color: t.color }))
}

root.AgentBoardTypes = { TYPES, OTHER, colorFor, legendFor }
})(typeof window !== 'undefined' ? window : globalThis)
