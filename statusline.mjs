// Statusline-Huelle fuer Claude Code: liest das statusLine-JSON (stdin), schreibt eine
// reduzierte Fassung nach status.json und gibt eine kurze Statuszeile aus.
// Mit Argument "subagents" (subagentStatusLine): schreibt subagents.json, gibt nichts aus
// (Claude Code behaelt dann seine Standard-Zeilen).
// Keine Abhaengigkeiten, stuerzt nie ab: jeder Fehler endet still mit Exit 0.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATA_DIR = process.env.AGENT_BOARD_DATA || join(homedir(), '.local', 'share', 'agent-board')
export const STATUS_FILE = join(DATA_DIR, 'status.json')
export const SUBAGENTS_FILE = join(DATA_DIR, 'subagents.json')
const MAX_SAMPLES = 20

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
const redact = (s) => String(s).replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…')
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// resets_at kommt in Unix-Sekunden; das Board erwartet Millisekunden
function limit(w) {
  if (!w || typeof w !== 'object') return undefined
  const usedPct = num(w.used_percentage ?? w.usedPct)
  let resetsAt = num(w.resets_at ?? w.resetsAt)
  if (resetsAt != null && resetsAt < 1e12) resetsAt *= 1000
  if (usedPct == null && resetsAt == null) return undefined
  return { usedPct: usedPct == null ? null : Math.round(usedPct * 10) / 10, resetsAt }
}

export function toStatus(p, now = Date.now()) {
  p = p && typeof p === 'object' ? p : {}
  const cw = p.context_window || {}
  const out = { t: now }
  const ctx = num(cw.used_percentage)
  if (ctx != null) out.ctxPct = Math.round(ctx)
  const cost = num(p.cost && p.cost.total_cost_usd)
  if (cost != null) out.costUsd = Math.round(cost * 1000) / 1000
  const m = p.model && typeof p.model === 'object' ? (p.model.id || p.model.display_name) : p.model
  if (m) out.model = clip(m, 40)
  const rl = p.rate_limits || {}
  const r5 = limit(rl.five_hour)
  const r7 = limit(rl.seven_day)
  if (r5) out.rl5h = r5
  if (r7) out.rl7d = r7
  return out
}

// Kurze, schlichte Zeile fuer das Terminal
export function line(s) {
  const parts = []
  if (s.ctxPct != null) parts.push(`Ctx ${s.ctxPct}%`)
  if (s.costUsd != null) parts.push(`$${s.costUsd.toFixed(2)}`)
  if (s.rl5h && s.rl5h.usedPct != null) parts.push(`5h ${Math.round(s.rl5h.usedPct)}%`)
  return parts.join(' · ') || 'Agent-Board'
}

// prev = bisheriger Inhalt von subagents.json; Token-Verlauf wird selbst mitgefuehrt
export function toSubagents(p, prev, now = Date.now()) {
  const tasks = p && Array.isArray(p.tasks) ? p.tasks : []
  const old = new Map()
  for (const s of (prev && Array.isArray(prev.subagents) ? prev.subagents : [])) if (s && s.id) old.set(s.id, s)
  const subagents = []
  for (const k of tasks) {
    if (!k || typeof k !== 'object' || !k.id) continue
    const id = clip(k.id, 40)
    const tokens = num(k.tokenCount ?? k.tokens)
    const before = old.get(id)
    let samples = before && Array.isArray(before.tokenSamples) ? before.tokenSamples.slice()
      : Array.isArray(k.tokenSamples) ? k.tokenSamples.map(num).filter((v) => v != null) : []
    if (tokens != null && samples[samples.length - 1] !== tokens) samples.push(tokens)
    samples = samples.slice(-MAX_SAMPLES)
    const e = { id, label: clip(redact(k.label || k.description || k.name || k.agentType || ''), 60), status: clip(k.status || 'running', 16), tokens, tokenSamples: samples }
    if (k.model) e.model = clip(k.model, 40)
    if (k.agentType) e.at = clip(k.agentType, 40)
    subagents.push(e)
  }
  return { t: now, subagents }
}

function writeAtomic(file, obj) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
  renameSync(tmp, file)
}

// Optional einen bisherigen Statusline-Befehl weiterverwenden (gleiches stdin)
function next(cmd, raw) {
  if (!cmd) return null
  try {
    const r = spawnSync('/bin/sh', ['-c', cmd], { input: raw, encoding: 'utf8', timeout: 3000 })
    return r.stdout ? r.stdout.replace(/\n+$/, '') : null
  } catch { return null }
}

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

function main() {
  const subMode = process.argv[2] === 'subagents'
  const raw = readStdin()
  let p = {}
  try { p = JSON.parse(raw) } catch { /* leer oder kaputt: trotzdem eine Zeile ausgeben */ }
  if (subMode) {
    try {
      let prev = null
      try { prev = JSON.parse(readFileSync(SUBAGENTS_FILE, 'utf8')) } catch { /* noch keine Datei */ }
      writeAtomic(SUBAGENTS_FILE, toSubagents(p, prev))
    } catch { /* ignorieren */ }
    const out = next(process.env.AGENT_BOARD_SUBAGENT_STATUSLINE_NEXT, raw)
    if (out) process.stdout.write(out + '\n')
    return
  }
  let s = { t: Date.now() }
  try {
    s = toStatus(p)
    writeAtomic(STATUS_FILE, s)
  } catch { /* ignorieren */ }
  const out = next(process.env.AGENT_BOARD_STATUSLINE_NEXT, raw)
  process.stdout.write((out || line(s)) + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main() } catch { /* nie abstuerzen */ }
  process.exitCode = 0
}
