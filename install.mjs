#!/usr/bin/env node
// Richtet Agent-Board in den Claude-Code-Einstellungen ein (oder entfernt es wieder).
//   node install.mjs              Hooks + Statusline eintragen (vorher Sicherungskopie)
//   node install.mjs --codex      stattdessen die Codex-Hooks (~/.codex/hooks.json) eintragen
//   node install.mjs --dry-run    nur zeigen, was sich aendern wuerde
//   node install.mjs --uninstall  alle Agent-Board-Eintraege entfernen
//   --settings <datei>            andere Einstellungsdatei (Standard: ~/.claude/settings.json bzw. ~/.codex/hooks.json)
//   node install.mjs --doctor     Selbsttest: Hooks, Datenordner, Node, Port, letztes Ereignis (Exit-Code 1 bei Fehlern)
//   --no-statusline               Statusline nicht anfassen
// Fremde Hooks bleiben unangetastet. Eine vorhandene eigene Statusline wird nicht ersetzt,
// sondern ueber AGENT_BOARD_STATUSLINE_NEXT weiter angezeigt.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, unlinkSync, openSync, readSync, fstatSync, closeSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure',
  'Notification', 'PreCompact', 'PostCompact', 'TaskCreated', 'TaskCompleted',
]
// Codex kennt weniger Ereignisse, aber dieselben Namen und Felder (https://learn.chatgpt.com/docs/hooks)
export const CODEX_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'SubagentStart', 'SubagentStop', 'Stop', 'PreCompact', 'PostCompact', 'Interrupt',
]

// Jeder eingetragene Befehl ruft node direkt auf (kein bash-Skript dazwischen, damit es auch unter
// Windows laeuft) und traegt am Ende das Argument --agent-board als Markierung, damit wir spaeter nur
// unsere eigenen Eintraege finden - nie fremde Skripte, die zufaellig auch collector.mjs heissen.
// Ein Argument statt eines Shell-Kommentars, weil nicht jede Shell '#' als Kommentar kennt.
const MARK = '--agent-board'
const LEGACY_MARK = '# agent-board' // Eintraege aus Version 1.0 (hook.sh & Co.)
// Pfade immer mit '/', in doppelten Anfuehrungszeichen: funktioniert in bash, sh und Git Bash unter Windows
const toPosix = (p) => p.replace(/\\/g, '/')
const quote = (p) => `"${toPosix(p).replace(/(["$`\\])/g, '\\$1')}"`
export const commandFor = (dir, file, ...args) => ['node', quote(join(dir, file)), ...args, MARK].join(' ')

// Was installiert wird: Art -> [Skript, Zusatzargumente, Dateiname der alten 1.0-Huelle]
export const ENTRIES = {
  hook: ['collector.mjs', [], 'hook.sh'],
  status: ['statusline.mjs', [], 'statusline.sh'],
  subagents: ['statusline.mjs', ['subagents'], 'subagent-statusline.sh'],
  codex: ['collector.mjs', ['codex'], null],
}
const entryCommand = (dir, kind) => commandFor(dir, ENTRIES[kind][0], ...ENTRIES[kind][1])

// Unser Eintrag: neuer markierter Befehl, alter 1.0-Eintrag mit Markierung, oder ein alter
// unmarkierter Eintrag, der genau auf <...>/agent-board/<huelle> bzw. auf diesen Projektordner zeigt.
function isOurs(cmd, kind, dir) {
  if (typeof cmd !== 'string') return false
  const [file, args, legacy] = ENTRIES[kind]
  if (cmd.trim().endsWith(MARK)) {
    const rest = cmd.slice(cmd.indexOf(`/${file}"`) + file.length + 2).replace(MARK, '').trim()
    return cmd.includes(`/${file}"`) && rest === args.join(' ')
  }
  if (!legacy) return false
  if (cmd.includes(LEGACY_MARK)) return cmd.includes(`/${legacy}'`)
  const c = toPosix(cmd.trim().replace(/^['"]|['"]$/g, ''))
  return c === toPosix(join(dir, legacy)) || c.endsWith('/agent-board/' + legacy)
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// Reine Funktion: alte Einstellungen + Projektordner -> neue Einstellungen (testbar ohne Dateisystem)
// codex: true -> Codex-hooks.json (eigene Ereignisliste, keine Statusline - die hat Codex nicht)
export function apply(settings, dir, { uninstall = false, statusline = true, codex = false } = {}) {
  const kind = codex ? 'codex' : 'hook'
  if (codex) statusline = false
  if (settings != null && !isObj(settings)) throw new Error('Die Einstellungsdatei ist kein JSON-Objekt.')
  const out = structuredClone(settings || {})
  if (out.hooks != null && !isObj(out.hooks)) throw new Error('"hooks" in der Einstellungsdatei ist kein Objekt.')
  out.hooks = out.hooks || {}
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue // unbekanntes Format: unangetastet lassen
    const kept = out.hooks[ev]
      .map((g) => (isObj(g) && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !(isObj(h) && isOurs(h.command, kind, dir))) } : g))
      .filter((g) => !(isObj(g) && Array.isArray(g.hooks) && g.hooks.length === 0))
    if (kept.length) out.hooks[ev] = kept
    else delete out.hooks[ev]
  }
  if (!uninstall) {
    for (const ev of codex ? CODEX_EVENTS : EVENTS) {
      const cur = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []
      const hook = { type: 'command', command: entryCommand(dir, kind), async: true }
      if (codex) hook.timeout = 10 // Codex wartet sonst bis zu 600 s auf einen haengenden Hook
      out.hooks[ev] = [...cur, { hooks: [hook] }]
    }
  }
  if (!Object.keys(out.hooks).length) delete out.hooks

  if (statusline) {
    for (const [key, kind, envKey] of [
      ['statusLine', 'status', 'AGENT_BOARD_STATUSLINE_NEXT'],
      ['subagentStatusLine', 'subagents', 'AGENT_BOARD_SUBAGENT_STATUSLINE_NEXT'],
    ]) {
      const cur = isObj(out[key]) ? out[key] : null
      const ours = cur && isOurs(cur.command, kind, dir)
      if (uninstall) {
        if (!ours) continue
        const prev = isObj(out.env) && out.env[envKey]
        if (prev) { const { command, ...rest } = cur; out[key] = { ...rest, command: prev } } else delete out[key]
        if (isObj(out.env)) delete out.env[envKey]
      } else {
        if (cur && !ours && cur.command) out.env = { ...(isObj(out.env) ? out.env : {}), [envKey]: cur.command }
        // weitere Felder einer vorhandenen Statusline (z.B. padding) bleiben erhalten
        out[key] = { ...(cur || (key === 'statusLine' ? { padding: 0 } : {})), type: 'command', command: entryCommand(dir, kind) }
      }
    }
    if (isObj(out.env) && !Object.keys(out.env).length) delete out.env
  }
  return out
}

// ---- --doctor: Selbsttest ---------------------------------------------------------------------

// Pfade vergleichen: aufgeloest, Schraegstriche vereinheitlicht, unter Windows/macOS ohne Gross-/Kleinschreibung
export const samePath = (a, b, platform = process.platform) => {
  const n = (p) => toPosix(resolve(p)).replace(/\/+$/, '')
  return platform === 'linux' ? n(a) === n(b) : n(a).toLowerCase() === n(b).toLowerCase()
}

// Befehle eines Hook-Blocks, die von uns stammen (Markierung am Ende): [{ ev, file, args }]
function ourCommands(settings, file) {
  const found = []
  if (!isObj(settings) || !isObj(settings.hooks)) return found
  for (const [ev, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) for (const h of (isObj(g) && Array.isArray(g.hooks) ? g.hooks : [])) {
      const cmd = isObj(h) ? h.command : null
      if (typeof cmd !== 'string' || !cmd.trim().endsWith(MARK)) continue
      const m = cmd.match(/^node "((?:[^"\\]|\\.)*)"/)
      if (!m) continue
      const path = m[1].replace(/\\(.)/g, '$1')
      const rest = cmd.slice(m[0].length).replace(MARK, '').trim()
      if (path.endsWith('/' + file) && (rest === '' || rest === 'codex')) found.push({ ev, path, codex: rest === 'codex' })
    }
  }
  return found
}

function readJson(file) {
  if (!existsSync(file)) return { missing: true }
  try { const raw = readFileSync(file, 'utf8'); return { data: raw.trim() ? JSON.parse(raw) : {} } } catch (e) {
    // Nur die Position melden: Node 20/22 haengt an e.message einen Ausschnitt des Inhalts an,
    // und Doctor-Ausgaben landen in Issues (settings.json kann Tokens enthalten)
    const pos = /position (\d+)/.exec(e.message || '')
    return { error: pos ? `invalid JSON at position ${pos[1]}` : 'invalid JSON' }
  }
}

// Zeit des letzten Ereignisses aus dem Ende der JSONL (nur die letzten 64 KB lesen)
function lastEventTime(file) {
  if (!existsSync(file)) return null
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size, len = Math.min(size, 65536), buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').reverse()
    for (const l of lines) { try { const t = JSON.parse(l).t; if (Number.isFinite(t)) return t } catch { /* halbe Zeile */ } }
  } finally { closeSync(fd) }
  return null
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

// Ist der Port frei? true = frei, false = belegt
export const portFree = (port) => new Promise((ok) => {
  const srv = createServer()
  srv.once('error', () => ok(false))
  srv.listen(port, '127.0.0.1', () => srv.close(() => ok(true)))
})

// Liefert eine Liste { id, ok, label, hint? }. ok: true (gut), false (Fehler); hint bei ok:true = Hinweis.
// Pfade fuer die Ausgabe: Home als ~ (Doctor-Ausgaben werden in Issues gepostet)
const kurz = (p, home = homedir()) => {
  const s = String(p); const h = String(home).replace(/[\\/]+$/, '')
  return h && s.toLowerCase().startsWith(h.toLowerCase()) && (s.length === h.length || '\\/'.includes(s[h.length])) ? '~' + s.slice(h.length) : s
}

export async function doctor({
  home = homedir(), env = process.env, port = Number(env.AGENT_BOARD_PORT || 4777), now = Date.now(),
  fetchFn = globalThis.fetch, nodeVersion = process.versions.node, isPortFree = portFree,
  dataDir = env.AGENT_BOARD_DATA || join(home, '.local', 'share', 'agent-board'),
  claudeFile = join(home, '.claude', 'settings.json'),
  codexFile = join(env.CODEX_HOME || join(home, '.codex'), 'hooks.json'),
} = {}) {
  const out = []
  const k = (p) => kurz(p, home)   // Pfade relativ zum geprueften Home
  const add = (id, ok, label, hint) => out.push({ id, ok, label, ...(hint ? { hint } : {}) })

  const major = Number(String(nodeVersion).split('.')[0])
  major >= 20 ? add('node', true, `Node ${nodeVersion}`)
    : add('node', false, `Node ${nodeVersion} is too old (need 20 or newer)`, 'Install Node 20+ from https://nodejs.org and run the command again.')

  const here = dirname(fileURLToPath(import.meta.url))
  for (const [id, file, codex, cmd] of [['hooks', claudeFile, false, 'node install.mjs'], ['codex', codexFile, true, 'node install.mjs --codex']]) {
    const r = readJson(file)
    if (r.error) { add(id, false, `${k(file)} is not valid JSON (${r.error})`, 'Fix or remove the file, then run: ' + cmd); continue }
    const ours = r.missing ? [] : ourCommands(r.data, 'collector.mjs').filter((c) => c.codex === codex)
    const name = codex ? 'Codex hooks' : 'Claude Code hooks'
    if (!ours.length) {
      if (codex) continue // Codex ist optional: nur melden, wenn konfiguriert
      // Plugin-Nutzer haben die Hooks in hooks/hooks.json des Plugins, nicht in settings.json
      const plugins = r.data?.enabledPlugins
      if (plugins && plugins['agent-board@agent-board']) add(id, true, `${name} installed as plugin (agent-board@agent-board)`, 'The plugin does not start the server or set the status line; see README.')
      else add(id, false, `${name} not found in ${k(file)}`, `Run: ${cmd} (or install the plugin: /plugin install agent-board@agent-board)`)
      continue
    }
    const wanted = codex ? CODEX_EVENTS : EVENTS
    const have = new Set(ours.map((c) => c.ev))
    const missing = wanted.filter((e) => !have.has(e))
    const gone = [...new Set(ours.map((c) => c.path))].filter((p) => !existsSync(p))
    if (gone.length) add(id, false, `${name} point to a missing file: ${gone[0]}`, `The folder was moved or deleted. Run ${cmd} from the current agent-board folder.`)
    else if (missing.length) add(id, false, `${name}: ${missing.length} of ${wanted.length} events missing (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})`, `Run: ${cmd}`)
    else {
      const other = ours.some((c) => !samePath(dirname(c.path), here))
      add(id, true, `${name} installed (${wanted.length} events) in ${k(file)}`, other ? `Hooks point to a different agent-board folder than this one (${k(dirname(ours[0].path))}).` : undefined)
    }
  }

  const probe = join(dataDir, `.doctor-${process.pid}-${now}`)
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(probe, 'ok'); unlinkSync(probe)
    add('data', true, `Data folder writable: ${k(dataDir)}`)
  } catch (e) {
    add('data', false, `Data folder not writable: ${k(dataDir)} (${e.code || e.message})`, 'Check the permissions of the folder, or set AGENT_BOARD_DATA to another folder.')
  }

  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    const body = res.ok ? await res.json() : null
    if (isObj(body) && body.ok === true && 'events' in body) { add('port', true, `Server is running on port ${port}`) }
    else add('port', false, `Port ${port} is used by another program`, 'Stop that program or start the board on another port: AGENT_BOARD_PORT=4778 npm start')
  } catch {
    if (await isPortFree(port)) add('port', true, `Port ${port} is free (server not running)`, 'Start the board with: npm start')
    else add('port', false, `Port ${port} is used by another program`, 'Stop that program or start the board on another port: AGENT_BOARD_PORT=4778 npm start')
  }

  const t = lastEventTime(join(dataDir, 'events.jsonl'))
  t == null ? add('events', true, 'No events yet', 'Start a new Claude Code session (or open /hooks once in a running one) and use any tool.')
    : add('events', true, `Last event ${ago(now - t)}`)
  return out
}

export const formatDoctor = (results) => results.map((r) => `${r.ok ? (r.hint && r.id === 'events' ? '!' : '✓') : '✗'} ${r.label}${r.hint ? `\n    ${r.ok ? 'Note' : 'Fix'}: ${r.hint}` : ''}`).join('\n')

async function main(argv) {
  const has = (f) => argv.includes(f)
  if (has('--doctor')) {
    const results = await doctor()
    console.log(formatDoctor(results))
    const bad = results.filter((r) => !r.ok).length
    console.log(bad ? `\n${bad} problem${bad > 1 ? 's' : ''} found.` : '\nAll good.')
    process.exitCode = bad ? 1 : 0   // kein process.exit: sonst kann die Ausgabe in einer Pipe abreissen
    return
  }
  const si = argv.indexOf('--settings')
  if (si >= 0 && (!argv[si + 1] || argv[si + 1].startsWith('--'))) { console.error('--settings braucht einen Dateipfad.'); process.exit(1) }
  const codex = has('--codex')
  const file = si >= 0 ? argv[si + 1]
    : codex ? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json')
    : join(homedir(), '.claude', 'settings.json')
  const dir = dirname(fileURLToPath(import.meta.url))
  let raw = null, before = {}
  if (existsSync(file)) {
    raw = readFileSync(file, 'utf8')
    try { before = raw.trim() ? JSON.parse(raw) : {} } catch (e) {
      console.error(`Konnte ${file} nicht lesen (${e.message}). Nichts geaendert.`); process.exit(1)
    }
  }
  let after
  try { after = apply(before, dir, { uninstall: has('--uninstall'), statusline: !has('--no-statusline'), codex }) } catch (e) {
    console.error(`${e.message} Nichts geaendert.`); process.exit(1)
  }
  const text = JSON.stringify(after, null, 2) + '\n'
  if (has('--dry-run')) { console.log(text); return }
  if (raw != null && JSON.stringify(before) === JSON.stringify(after)) { console.log(`Keine Aenderung noetig (${file}).`); return }
  mkdirSync(dirname(file), { recursive: true })
  if (raw != null) {
    const backup = `${file}.agent-board-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(file, backup)
    console.log(`Sicherungskopie: ${backup}`)
  }
  writeFileSync(file, text)
  console.log(has('--uninstall')
    ? `Agent-Board aus ${file} entfernt.`
    : codex
    ? `Agent-Board in ${file} eingetragen (${CODEX_EVENTS.length} Codex-Hook-Ereignisse).\nCodex fuehrt neue Hooks erst nach einer Freigabe aus: in Codex einmal /hooks oeffnen und die Agent-Board-Hooks erlauben.\nBoard starten: npm start  ->  http://localhost:4777`
    : `Agent-Board in ${file} eingetragen (${EVENTS.length} Hook-Ereignisse${has('--no-statusline') ? '' : ' + Statusline'}).\nNeue Claude-Code-Sessions melden sich jetzt; laufende: einmal /hooks oeffnen.\nBoard starten: npm start  ->  http://localhost:4777`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
