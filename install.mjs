#!/usr/bin/env node
// Richtet Agent-Board in den Claude-Code-Einstellungen ein (oder entfernt es wieder).
//   node install.mjs              Hooks + Statusline eintragen (vorher Sicherungskopie)
//   node install.mjs --dry-run    nur zeigen, was sich aendern wuerde
//   node install.mjs --uninstall  alle Agent-Board-Eintraege entfernen
//   --settings <datei>            andere Einstellungsdatei (Standard: ~/.claude/settings.json)
//   --no-statusline               Statusline nicht anfassen
// Fremde Hooks bleiben unangetastet. Eine vorhandene eigene Statusline wird nicht ersetzt,
// sondern ueber AGENT_BOARD_STATUSLINE_NEXT weiter angezeigt.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure',
  'Notification', 'PreCompact', 'PostCompact', 'TaskCreated', 'TaskCompleted',
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
  if (cmd.includes(LEGACY_MARK)) return cmd.includes(`/${legacy}'`)
  const c = toPosix(cmd.trim().replace(/^['"]|['"]$/g, ''))
  return c === toPosix(join(dir, legacy)) || c.endsWith('/agent-board/' + legacy)
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// Reine Funktion: alte Einstellungen + Projektordner -> neue Einstellungen (testbar ohne Dateisystem)
export function apply(settings, dir, { uninstall = false, statusline = true } = {}) {
  if (settings != null && !isObj(settings)) throw new Error('Die Einstellungsdatei ist kein JSON-Objekt.')
  const out = structuredClone(settings || {})
  if (out.hooks != null && !isObj(out.hooks)) throw new Error('"hooks" in der Einstellungsdatei ist kein Objekt.')
  out.hooks = out.hooks || {}
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue // unbekanntes Format: unangetastet lassen
    const kept = out.hooks[ev]
      .map((g) => (isObj(g) && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !(isObj(h) && isOurs(h.command, 'hook', dir))) } : g))
      .filter((g) => !(isObj(g) && Array.isArray(g.hooks) && g.hooks.length === 0))
    if (kept.length) out.hooks[ev] = kept
    else delete out.hooks[ev]
  }
  if (!uninstall) {
    for (const ev of EVENTS) {
      const cur = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []
      out.hooks[ev] = [...cur, { hooks: [{ type: 'command', command: entryCommand(dir, 'hook'), async: true }] }]
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

function main(argv) {
  const has = (f) => argv.includes(f)
  const si = argv.indexOf('--settings')
  if (si >= 0 && (!argv[si + 1] || argv[si + 1].startsWith('--'))) { console.error('--settings braucht einen Dateipfad.'); process.exit(1) }
  const file = si >= 0 ? argv[si + 1] : join(homedir(), '.claude', 'settings.json')
  const dir = dirname(fileURLToPath(import.meta.url))
  let raw = null, before = {}
  if (existsSync(file)) {
    raw = readFileSync(file, 'utf8')
    try { before = raw.trim() ? JSON.parse(raw) : {} } catch (e) {
      console.error(`Konnte ${file} nicht lesen (${e.message}). Nichts geaendert.`); process.exit(1)
    }
  }
  let after
  try { after = apply(before, dir, { uninstall: has('--uninstall'), statusline: !has('--no-statusline') }) } catch (e) {
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
    : `Agent-Board in ${file} eingetragen (${EVENTS.length} Hook-Ereignisse${has('--no-statusline') ? '' : ' + Statusline'}).\nNeue Claude-Code-Sessions melden sich jetzt; laufende: einmal /hooks oeffnen.\nBoard starten: npm start  ->  http://localhost:4777`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
