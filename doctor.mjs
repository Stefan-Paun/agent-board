// Selbstcheck fuer die Installation: node install.mjs --doctor
// Jeder Punkt liefert { status: 'ok' | 'warn' | 'fail', label, detail, hint }.
// Nur 'fail' macht den Exit-Code 1; 'warn' ist ein Hinweis (z.B. Plugin + Installer doppelt).
import { readFileSync, existsSync, accessSync, constants, openSync, readSync, closeSync, statSync, fstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// Pfad der collector.mjs aus einem von install.mjs geschriebenen Befehl: node "<pfad>" ... --agent-board
export function collectorPath(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim().endsWith('--agent-board')) return null
  const m = cmd.match(/^node "((?:[^"\\]|\\.)*\/collector\.mjs)"/)
  return m ? m[1].replace(/\\(["$`\\])/g, '$1') : null
}

export function humanAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 90) return `${s}s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 129600) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

// Zeitstempel (ms) der letzten Zeile von events.jsonl; liest nur das Dateiende
export function lastEventTime(file) {
  let fd = null
  try {
    // erst öffnen, dann am Handle messen: kein Fenster zwischen Prüfen und Lesen
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    if (!size) return null
    const len = Math.min(size, 65536), buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const t = Number(JSON.parse(lines[i]).t); if (t > 0) return t } catch { /* halbe Zeile */ }
    }
  } catch { /* keine Datei */ } finally { if (fd !== null) closeSync(fd) }
  return null
}

async function probeServer(port, timeoutMs) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    if (!r.ok) return { up: false, error: `HTTP ${r.status}` }
    return { up: true, health: await r.json().catch(() => null) }
  } catch (e) { return { up: false, error: e?.cause?.code || e?.name || 'error' } }
}

const writable = (p) => { try { accessSync(p, constants.W_OK); return true } catch { return false } }

// Hinweistexte mit festem Schluessel: das Terminal zeigt sie englisch, das Board uebersetzt sie
// ueber 'doctor.h.<schluessel>' in public/i18n.js (dieselben Platzhalter: cmd, path, port).
export const HINTS = {
  node: () => 'Install Node.js 20+ from https://nodejs.org and run the command again.',
  run: (v) => `Run: ${v.cmd}`,
  badjson: () => 'Fix the file by hand (a backup is made on every install), then run: node install.mjs',
  moved: (v) => `The project folder was moved or deleted. Run ${v.cmd} from the current folder.`,
  dup: () => 'Keep only one: /plugin uninstall agent-board@agent-board, or node install.mjs --uninstall',
  permdir: (v) => `Fix the permissions, e.g. chmod u+w "${v.path}", or set AGENT_BOARD_DATA to another folder.`,
  permfile: (v) => `Fix the permissions, e.g. chmod u+w "${v.path}"`,
  datadir: () => 'Set AGENT_BOARD_DATA to a folder you can write to.',
  server: (v) => `Start it with: npm start (other port: AGENT_BOARD_PORT=<port>). Is another program using port ${v.port}?`,
  noevents: () => 'Start a new Claude Code session (running ones need /hooks opened once) and send a message.',
  quiet: () => 'Quiet for over a day. If you used Claude Code since then, open /hooks in a running session or start a new one.',
}
// Feste Kennung je Pruefpunkt (fuer die Uebersetzung der Beschriftung im Board)
const IDS = { 'Node.js version': 'node', 'Hooks installed': 'hooks', 'Plugin variant': 'plugin', 'Data folder writable': 'data', 'Server running': 'server', 'Last event': 'last' }

// opts: settingsFile, home, dataDir, port, now, nodeVersion, events (erwartete Hook-Ereignisse),
//       codex, probe (Ersatz fuer den HTTP-Check in Tests)
export async function diagnose(opts = {}) {
  const home = opts.home || homedir()
  const env = opts.env || process.env
  const codex = !!opts.codex
  const settingsFile = opts.settingsFile
    || (codex ? join(env.CODEX_HOME || join(home, '.codex'), 'hooks.json') : join(home, '.claude', 'settings.json'))
  const dataDir = opts.dataDir || env.AGENT_BOARD_DATA || join(home, '.local', 'share', 'agent-board')
  const port = Number(opts.port ?? (env.AGENT_BOARD_PORT || 4777))
  const now = opts.now ?? Date.now()
  const nodeVersion = opts.nodeVersion || process.versions.node
  const events = opts.events || []
  const out = []
  // hintKey: Schluessel aus HINTS (oder nichts), vars: Werte fuer dessen Platzhalter
  const add = (status, label, detail, hintKey, vars = {}) => out.push({ status, id: IDS[label], label, detail, hint: hintKey ? HINTS[hintKey](vars) : undefined, hintKey, vars: hintKey ? vars : undefined })
  const cmd = `node install.mjs${codex ? ' --codex' : ''}`

  // 1. Node
  const major = Number(String(nodeVersion).split('.')[0])
  if (major >= 20) add('ok', 'Node.js version', `v${nodeVersion}`)
  else add('fail', 'Node.js version', `v${nodeVersion} (need 20 or newer)`, 'node')

  // 2. Hooks in der Einstellungsdatei
  let settings = null, settingsOk = false
  if (!existsSync(settingsFile)) {
    add('fail', 'Hooks installed', `${settingsFile} does not exist`, 'run', { cmd })
  } else {
    try { settings = JSON.parse(readFileSync(settingsFile, 'utf8') || '{}'); settingsOk = isObj(settings) } catch { /* unten */ }
    if (!settingsOk) add('fail', 'Hooks installed', `${settingsFile} is not valid JSON`, 'badjson')
  }
  const plugin = !codex && detectPlugin(settings, home)
  let hookCount = 0
  if (settingsOk) {
    const missing = [], broken = new Set()
    for (const ev of events) {
      const groups = isObj(settings.hooks) && Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : []
      const paths = groups.flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks : [])).map((h) => collectorPath(isObj(h) ? h.command : null)).filter(Boolean)
      if (!paths.length) { missing.push(ev); continue }
      hookCount++
      for (const p of paths) if (!existsSync(p)) broken.add(p)
    }
    if (broken.size) add('fail', 'Hooks installed', `collector.mjs not found at ${[...broken].join(', ')}`, 'moved', { cmd })
    else if (hookCount === 0 && plugin) add('ok', 'Hooks installed', 'none in settings, events come from the plugin')
    else if (hookCount === 0) add('fail', 'Hooks installed', `no Agent-Board hooks in ${settingsFile}`, 'run', { cmd })
    else if (missing.length) add('fail', 'Hooks installed', `${hookCount}/${events.length} events, missing: ${missing.join(', ')}`, 'run', { cmd })
    else add('ok', 'Hooks installed', `${hookCount} events point to an existing collector.mjs`)
    // 3. Plugin doppelt?
    if (!codex) {
      if (plugin && hookCount > 0) add('warn', 'Plugin variant', 'plugin AND installer hooks are active, every event is reported twice', 'dup')
      else if (plugin) add('ok', 'Plugin variant', 'plugin detected, no duplicate registration')
      else add('ok', 'Plugin variant', 'not used')
    }
  } else if (!codex) {
    add(plugin ? 'warn' : 'ok', 'Plugin variant', plugin ? 'plugin detected (settings file unreadable, cannot check for duplicates)' : 'not used')
  }

  // 4. Datenordner und events.jsonl
  const eventsFile = join(dataDir, 'events.jsonl')
  if (existsSync(dataDir)) {
    if (!writable(dataDir)) add('fail', 'Data folder writable', `${dataDir} is not writable`, 'permdir', { path: dataDir })
    else if (existsSync(eventsFile) && !writable(eventsFile)) add('fail', 'Data folder writable', `${eventsFile} is not writable`, 'permfile', { path: eventsFile })
    else add('ok', 'Data folder writable', dataDir)
  } else {
    let p = dirname(dataDir)
    while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
    if (writable(p)) add('ok', 'Data folder writable', `${dataDir} does not exist yet, will be created by the first event`)
    else add('fail', 'Data folder writable', `${dataDir} cannot be created (${p} is not writable)`, 'datadir')
  }

  // 5. Server
  const probe = await (opts.probe || probeServer)(port, 1500)
  if (probe.up) add('ok', 'Server running', `http://127.0.0.1:${port}`)
  else add('fail', 'Server running', `nothing answers on port ${port} (${probe.error})`, 'server', { port })

  // 6. Letztes Ereignis
  const last = (probe.up && Number(probe.health?.lastEventAt)) || lastEventTime(eventsFile)
  if (!last) add('warn', 'Last event', 'no events recorded yet', 'noevents')
  else {
    const age = now - last
    if (age > 24 * 3600e3) add('warn', 'Last event', `${humanAge(age)} ago`, 'quiet')
    else add('ok', 'Last event', `${humanAge(age)} ago`)
  }
  return out
}

function detectPlugin(settings, home) {
  if (isObj(settings?.enabledPlugins) && Object.entries(settings.enabledPlugins).some(([k, v]) => /^agent-board@/.test(k) && v !== false)) return true
  try {
    const inst = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
    const names = Object.keys(isObj(inst.plugins) ? inst.plugins : inst)
    if (names.some((k) => /^agent-board@/.test(k))) return !(isObj(settings?.enabledPlugins) && Object.entries(settings.enabledPlugins).some(([k, v]) => /^agent-board@/.test(k) && v === false))
  } catch { /* kein Plugin-Verzeichnis */ }
  return false
}

const MARKS = { ok: '✓', warn: '!', fail: '✗' }
export function format(results) {
  const lines = ['Agent-Board doctor', '']
  for (const r of results) {
    lines.push(`${MARKS[r.status]} ${r.label}: ${r.detail}`)
    if (r.hint && r.status !== 'ok') lines.push(`    -> ${r.hint}`)
  }
  const fails = results.filter((r) => r.status === 'fail').length, warns = results.filter((r) => r.status === 'warn').length
  lines.push('', fails ? `${fails} problem${fails > 1 ? 's' : ''} found.` : warns ? `All good, ${warns} warning${warns > 1 ? 's' : ''}.` : 'All good.')
  return lines.join('\n')
}

// Fuer die Route /doctor im Server: nur die Felder, die das Board braucht, und der Home-Ordner als "~"
// (keine Benutzernamen in der Antwort). Mehr als diese Liste verlaesst den Rechner nicht.
export function publicResults(results, home = homedir()) {
  // beide Schreibweisen (install.mjs schreibt Hook-Pfade auch unter Windows mit /), nur an einer Pfadgrenze,
  // unter Windows ohne Ruecksicht auf Gross-/Kleinschreibung
  const forms = home && home.length > 1 ? [...new Set([home, home.replace(/\\/g, '/')])] : []
  const res = forms.map((h) => new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\\\/"\'\\s,)]|$)', process.platform === 'win32' ? 'gi' : 'g'))
  const tilde = (v) => (typeof v === 'string' ? res.reduce((s, re) => s.replace(re, '~'), v) : v)
  return results.map((r) => ({
    status: r.status, id: r.id, label: r.label, detail: tilde(r.detail), hint: tilde(r.hint), hintKey: r.hintKey,
    vars: r.vars ? Object.fromEntries(Object.entries(r.vars).map(([k, v]) => [k, tilde(v)])) : undefined,
  }))
}

export async function runDoctor(opts = {}) {
  const results = await diagnose(opts)
  return { text: format(results), code: results.some((r) => r.status === 'fail') ? 1 : 0, results }
}
