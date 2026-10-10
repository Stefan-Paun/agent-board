// Liest ein Claude-Code-Hook-Ereignis von stdin und haengt einen reduzierten
// Datensatz an events.jsonl an. Speichert nie Prompt-Texte.
import { appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync, chmodSync, renameSync, rmdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATA_DIR = process.env.AGENT_BOARD_DATA || join(homedir(), '.local', 'share', 'agent-board')
export const EVENTS_FILE = join(DATA_DIR, 'events.jsonl')
const MAX_BYTES = 5 * 1024 * 1024
const KEEP_LINES = 1500

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Geheimnisse unkenntlich machen: lange schluesselaehnliche Folgen, bekannte Token-Praefixe,
// KEY=wert-Zuweisungen mit verdaechtigem Namen, Passwort-Optionen, Zugangsdaten in URLs und Auth-Header.
export const redact = (s) => String(s)
  .replace(/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASS(?:WORD)?|PWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH|CREDENTIALS?|COOKIE)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, '$1=…')
  .replace(/(--?(?:password|passwd|pass|token|secret|api-key|apikey|auth)[= ])\s*("[^"]*"|'[^']*'|\S+)/gi, '$1…')
  .replace(/(\s-p)(?=\S)\S+/g, '$1…')
  .replace(/(\s-u\s+[^\s:]+):\S+/g, '$1:…')
  .replace(/(\/\/[^\s/:@]+):[^\s@/]+@/g, '$1:…@')
  .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 …')
  .replace(/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|AKIA|ASIA|AIza)[-_A-Za-z0-9]{8,}/g, '…')
  .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, '…')

// erster vorhandener, nicht-leerer Wert aus mehreren moeglichen Feldnamen
const pick = (p, ...keys) => {
  for (const k of keys) if (p[k] != null && p[k] !== '') return p[k]
  return null
}

export function summarize(tool, input) {
  input = input && typeof input === 'object' ? input : {}
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit':
      return clip(basename(String(input.file_path || input.notebook_path || '')), 40)
    case 'Bash':
      return clip(redact(input.command || ''), 48)
    case 'Grep': case 'Glob':
      return clip(redact(input.pattern || ''), 32)
    case 'WebFetch':
      try { return new URL(String(input.url)).hostname } catch { return 'web' }
    case 'WebSearch':
      return clip(redact(input.query || ''), 40)
    case 'Agent': case 'Task':
      return clip(redact(input.description || input.subagent_type || ''), 40)
    default:
      return ''
  }
}

export function reduce(p) {
  const ev = String(p.hook_event_name || '')
  if (!ev) return null
  const rec = {
    t: Date.now(),
    ev,
    sid: String(p.session_id || '').slice(0, 8),
    aid: p.agent_id ? String(p.agent_id).slice(0, 24) : null,
    at: p.agent_type ? clip(p.agent_type, 40) : null,
    proj: p.cwd ? basename(String(p.cwd)) : null,
  }
  if (p.tool_name) {
    rec.tool = clip(p.tool_name, 40)
    rec.what = summarize(p.tool_name, p.tool_input)
  }
  if (ev === 'PostToolUseFailure') rec.ok = false
  if (ev === 'UserPromptSubmit') rec.len = String(p.prompt || '').length
  if (ev === 'Notification') {
    rec.msg = clip(redact(p.message || ''), 80)
    const nt = pick(p, 'notification_type', 'notificationType')
    if (nt) rec.nt = clip(nt, 40)
  }
  // tool_use_id: Praefix weg, nur das hintere Stueck behalten (reicht fuer Pre/Post-Paare)
  const tid = pick(p, 'tool_use_id', 'toolUseId')
  if (tid) rec.tid = String(tid).replace(/^toolu_/, '').slice(-12)
  const dur = Number(p.duration_ms ?? p.durationMs)
  if ((p.duration_ms ?? p.durationMs) != null && Number.isFinite(dur) && dur >= 0) rec.dur = Math.round(dur)
  if (ev === 'StopFailure') {
    const err = pick(p, 'error', 'error_type', 'errorType', 'reason')
    rec.err = clip(redact(err && typeof err === 'object' ? (err.type || err.code || 'unknown') : err || 'unknown'), 40)
  }
  if (ev === 'PermissionDenied') {
    const why = pick(p, 'reason')
    if (why) rec.msg = clip(redact(why), 60)
  }
  if (ev === 'PreCompact' || ev === 'PostCompact') {
    const trig = pick(p, 'trigger', 'compaction_trigger')
    if (trig) rec.trig = clip(trig, 12)
  }
  if (ev === 'TaskCreated' || ev === 'TaskCompleted') {
    const task = pick(p, 'task_subject', 'subject', 'task_title', 'title', 'task_description')
    if (task) rec.task = clip(redact(task), 60)
  }
  // Schlusssatz von Claude (keine Nutzereingabe), stark gekuerzt
  if (ev === 'Stop' || ev === 'SubagentStop') {
    const last = pick(p, 'last_assistant_message', 'lastAssistantMessage')
    if (last) rec.msg = clip(redact(last), 80)
  }
  return rec
}

function rotate() {
  try {
    if (statSync(EVENTS_FILE).size < MAX_BYTES) return
    const lines = readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean)
    // erst in eine Temp-Datei, dann umbenennen: der Server liest nie eine halb geschriebene Datei
    const tmp = `${EVENTS_FILE}.${process.pid}.tmp`
    writeFileSync(tmp, lines.slice(-KEEP_LINES).join('\n') + '\n', { mode: 0o600 })
    // unter Windows scheitert das, solange der Server die Datei gerade offen hat: dann beim naechsten Mal
    try { renameSync(tmp, EVENTS_FILE) } catch { try { unlinkSync(tmp) } catch { /* ignorieren */ } }
  } catch { /* Datei existiert noch nicht */ }
}

// Hooks laufen asynchron und gleichzeitig. Kuerzen und Anhaengen passieren deshalb unter einer
// Sperre (ein Ordner, mkdir ist atomar): sonst schreibt ein Hook mitten in eine gerade neu
// geschriebene Datei und es entstehen halbe Zeilen oder verlorene Ereignisse.
const LOCK_DIR = `${EVENTS_FILE}.lock`
const LOCK_WAIT_MS = 2000 // laenger nie warten - dann lieber ohne Sperre schreiben
const LOCK_STALE_MS = 10000 // Sperre eines abgestuerzten Prozesses
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function withLock(fn) {
  const deadline = Date.now() + LOCK_WAIT_MS
  let locked = false
  while (!locked) {
    try { mkdirSync(LOCK_DIR); locked = true } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > deadline) break
      try { if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) rmdirSync(LOCK_DIR) } catch { /* schon weg */ }
      pause(2)
    }
  }
  try { return fn() } finally { if (locked) try { rmdirSync(LOCK_DIR) } catch { /* ignorieren */ } }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let payload
  try { payload = JSON.parse(raw) } catch { return }
  const rec = reduce(payload)
  if (!rec) return
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  withLock(() => {
    rotate()
    appendFileSync(EVENTS_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 })
  })
  try { chmodSync(EVENTS_FILE, 0o600) } catch { /* ignorieren */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
