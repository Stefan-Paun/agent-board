// Liest ein Hook-Ereignis von Claude Code, Codex oder Gemini CLI von stdin und haengt einen reduzierten
// Datensatz an events.jsonl an. Speichert nie Prompt-Texte.
//   node collector.mjs          Ereignis von Claude Code
//   node collector.mjs codex    Ereignis von Codex (gleiches Format, andere Werkzeugnamen)
//   node collector.mjs gemini   Ereignis von Gemini CLI (andere Ereignis- und Werkzeugnamen)
import { appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync, chmodSync, renameSync, rmdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATA_DIR = process.env.AGENT_BOARD_DATA || join(homedir(), '.local', 'share', 'agent-board')
export const EVENTS_FILE = join(DATA_DIR, 'events.jsonl')
const MAX_BYTES = 5 * 1024 * 1024
const KEEP_LINES = 1500
const KEEP_MS = 48 * 3600 * 1000 // alles aus den letzten 48 h bleibt, damit "Heute" nach dem Kuerzen stimmt
const MAX_LINES = 20000 // harte Obergrenze, damit die Datei nicht ungebremst waechst

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

// Dateinamen aus einem Codex-Patch ("*** Update File: pfad" usw.)
export function patchFiles(patch) {
  const files = []
  for (const m of String(patch || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.push(basename(m[1].trim()))
  return files
}

// Codex-Werkzeuge auf die Namen abbilden, die das Board kennt (Raeume, Zaehler, Zeitleiste)
export function codexTool(tool, input) {
  input = input && typeof input === 'object' ? input : {}
  const cmd = Array.isArray(input.command) ? input.command.join(' ') : input.command
  switch (tool) {
    case 'Bash': case 'exec_command': case 'shell': case 'local_shell': case 'container.exec':
      return { tool: 'Bash', input: { command: cmd || input.cmd || '' } }
    case 'apply_patch': {
      const patch = String(cmd || input.input || input.patch || '')
      const files = patchFiles(patch)
      const what = files.length > 1 ? `${files[0]} +${files.length - 1}` : files[0] || ''
      // nur neue Dateien angelegt -> Write, sonst Edit (beides landet in der Werkstatt)
      const onlyAdds = files.length > 0 && !/^\*\*\* (?:Update|Delete) File:/m.test(patch)
      return { tool: onlyAdds ? 'Write' : 'Edit', input: { file_path: what } }
    }
    case 'spawn_agent':
      return { tool: 'Agent', input: { description: input.description || input.agent_type || '' } }
    default:
      return { tool, input }
  }
}

// Gemini-CLI-Ereignisse auf die Ereignisnamen des Boards abbilden. Alles andere (BeforeModel,
// AfterModel, BeforeToolSelection, PreCompress ...) wird nicht gespeichert.
// Quelle: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
const GEMINI_EVENTS = {
  SessionStart: 'SessionStart', SessionEnd: 'SessionEnd', BeforeAgent: 'UserPromptSubmit', AfterAgent: 'Stop',
  BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', Notification: 'Notification',
}

// Gemini-Werkzeuge auf die Namen abbilden, die das Board kennt (Quelle: docs/reference/tools.md)
export function geminiTool(tool, input) {
  input = input && typeof input === 'object' ? input : {}
  switch (tool) {
    case 'run_shell_command':
      return { tool: 'Bash', input: { command: input.command || '' } }
    case 'read_file': case 'read_many_files':
      return { tool: 'Read', input: { file_path: input.file_path || (Array.isArray(input.include) ? input.include[0] : input.include) || '' } }
    case 'write_file':
      return { tool: 'Write', input: { file_path: input.file_path || '' } }
    case 'replace':
      return { tool: 'Edit', input: { file_path: input.file_path || '' } }
    case 'grep_search': case 'search_file_content':
      return { tool: 'Grep', input: { pattern: input.pattern || '' } }
    case 'glob':
      return { tool: 'Glob', input: { pattern: input.pattern || '' } }
    case 'list_directory':
      return { tool: 'Glob', input: { pattern: input.dir_path || '' } }
    case 'google_web_search':
      return { tool: 'WebSearch', input: { query: input.query || '' } }
    case 'web_fetch': // web_fetch bekommt nur einen Prompt mit der URL darin: nur der Host wird gebraucht
      return { tool: 'WebFetch', input: { url: (String(input.prompt || '').match(/https?:\/\/[^\s"'<>)]+/) || [''])[0] } }
    default:
      return { tool, input }
  }
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
    case 'Skill':
      return clip(redact(input.skill || input.name || ''), 40)
    case 'Agent': case 'Task':
      return clip(redact(input.description || input.subagent_type || ''), 40)
    default:
      return ''
  }
}

// TodoWrite: nur zaehlen, nie Aufgabentexte speichern. Status: completed / in_progress / pending.
export function countTodos(input) {
  const list = input && typeof input === 'object' && Array.isArray(input.todos) ? input.todos : null
  if (!list) return null
  const c = { done: 0, progress: 0, open: 0 }
  for (const t of list.slice(0, 500)) {
    const st = t && typeof t === 'object' ? t.status : ''
    if (st === 'completed') c.done++
    else if (st === 'in_progress') c.progress++
    else c.open++
  }
  return c
}

export function reduce(p, { src = 'claude' } = {}) {
  if (!p || typeof p !== 'object') return null
  let ev = String(p.hook_event_name || '')
  if (!ev) return null
  if (src === 'gemini') {
    ev = GEMINI_EVENTS[ev]
    if (!ev) return null
    // fehlgeschlagener Werkzeugaufruf: tool_response.error gesetzt
    if (ev === 'PostToolUse' && p.tool_response && typeof p.tool_response === 'object' && p.tool_response.error) ev = 'PostToolUseFailure'
  }
  const rec = {
    t: Date.now(),
    ev,
    sid: String(p.session_id || '').slice(0, 8),
    aid: p.agent_id ? String(p.agent_id).slice(0, 24) : null,
    at: p.agent_type ? clip(p.agent_type, 40) : null,
    proj: p.cwd ? basename(String(p.cwd)) : null,
  }
  if (src === 'codex' || src === 'gemini') rec.src = src
  if (p.tool_name) {
    const { tool, input } = src === 'codex' ? codexTool(String(p.tool_name), p.tool_input)
      : src === 'gemini' ? geminiTool(String(p.tool_name), p.tool_input)
      : { tool: p.tool_name, input: p.tool_input }
    rec.tool = clip(tool, 40)
    rec.what = summarize(tool, input)
    // nur PostToolUse: die App wertet nur den abgeschlossenen Aufruf aus (Pre waere doppelte Zeilen)
    if (tool === 'TodoWrite' && ev === 'PostToolUse') {
      const todos = countTodos(input)
      if (todos) rec.todos = todos
    }
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
  if (tid) rec.tid = String(tid).replace(/^(?:toolu|call)_/, '').slice(-12)
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

// Reine Auswahl beim Kuerzen: alle Zeilen der letzten 48 h (nach `t`), mindestens KEEP_LINES, hoechstens MAX_LINES.
export function trimLines(lines, now = Date.now()) {
  const cutoff = now - KEEP_MS
  const recent = lines.filter((l) => {
    try { return JSON.parse(l).t >= cutoff } catch { return false }
  })
  if (recent.length < KEEP_LINES) return lines.slice(-KEEP_LINES)
  return recent.slice(-MAX_LINES)
}

function rotate() {
  try {
    if (statSync(EVENTS_FILE).size < MAX_BYTES) return
    const lines = readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean)
    // erst in eine Temp-Datei, dann umbenennen: der Server liest nie eine halb geschriebene Datei
    const tmp = `${EVENTS_FILE}.${process.pid}.tmp`
    writeFileSync(tmp, trimLines(lines).join('\n') + '\n', { mode: 0o600 })
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
  const rec = reduce(payload, { src: process.argv.includes('gemini') ? 'gemini' : process.argv.includes('codex') ? 'codex' : 'claude' })
  if (!rec) return
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  withLock(() => {
    rotate()
    appendFileSync(EVENTS_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 })
  })
  try { chmodSync(EVENTS_FILE, 0o600) } catch { /* ignorieren */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {})   // nie Exit != 0 (Gemini wertet Exit 2 als Blockade)
