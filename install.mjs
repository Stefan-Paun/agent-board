#!/usr/bin/env node
// Richtet Agent-Board in den Claude-Code-Einstellungen ein (oder entfernt es wieder).
//   node install.mjs              Hooks + Statusline eintragen (vorher Sicherungskopie)
//   node install.mjs --dry-run    nur zeigen, was sich aendern wuerde
//   node install.mjs --uninstall  alle Agent-Board-Eintraege entfernen
//   --settings <datei>            andere Einstellungsdatei (Standard: ~/.claude/settings.json)
//   --no-statusline               Statusline nicht anfassen
// Fremde Hooks bleiben unangetastet. Eine vorhandene eigene Statusline wird nicht ersetzt,
// sondern ueber AGENT_BOARD_STATUSLINE_NEXT weiter angezeigt.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure',
  'Notification', 'PreCompact', 'PostCompact', 'TaskCreated', 'TaskCompleted',
]

// Jeder eingetragene Befehl traegt diese Markierung (Shell-Kommentar), damit wir spaeter nur
// unsere eigenen Eintraege finden - nie fremde Skripte, die zufaellig auch hook.sh heissen.
const MARK = '# agent-board'
const quote = (p) => `'${p.replace(/'/g, `'\\''`)}'`
export const commandFor = (dir, file) => `${quote(join(dir, file))} ${MARK}`

// Unser Eintrag: mit Markierung, oder ein alter unmarkierter Eintrag, der genau auf
// <...>/agent-board/<datei> bzw. auf diesen Projektordner zeigt.
function isOurs(cmd, file, dir) {
  if (typeof cmd !== 'string') return false
  if (cmd.includes(MARK)) return cmd.includes(`/${file}'`)
  const c = cmd.trim().replace(/^['"]|['"]$/g, '')
  return c === join(dir, file) || c.endsWith('/agent-board/' + file)
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
      .map((g) => (isObj(g) && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !(isObj(h) && isOurs(h.command, 'hook.sh', dir))) } : g))
      .filter((g) => !(isObj(g) && Array.isArray(g.hooks) && g.hooks.length === 0))
    if (kept.length) out.hooks[ev] = kept
    else delete out.hooks[ev]
  }
  if (!uninstall) {
    for (const ev of EVENTS) {
      const cur = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []
      out.hooks[ev] = [...cur, { hooks: [{ type: 'command', command: commandFor(dir, 'hook.sh'), async: true }] }]
    }
  }
  if (!Object.keys(out.hooks).length) delete out.hooks

  if (statusline) {
    for (const [key, file, envKey] of [
      ['statusLine', 'statusline.sh', 'AGENT_BOARD_STATUSLINE_NEXT'],
      ['subagentStatusLine', 'subagent-statusline.sh', 'AGENT_BOARD_SUBAGENT_STATUSLINE_NEXT'],
    ]) {
      const cur = isObj(out[key]) ? out[key] : null
      const ours = cur && isOurs(cur.command, file, dir)
      if (uninstall) {
        if (!ours) continue
        const prev = isObj(out.env) && out.env[envKey]
        if (prev) { const { command, ...rest } = cur; out[key] = { ...rest, command: prev } } else delete out[key]
        if (isObj(out.env)) delete out.env[envKey]
      } else {
        if (cur && !ours && cur.command) out.env = { ...(isObj(out.env) ? out.env : {}), [envKey]: cur.command }
        // weitere Felder einer vorhandenen Statusline (z.B. padding) bleiben erhalten
        out[key] = { ...(cur || (key === 'statusLine' ? { padding: 0 } : {})), type: 'command', command: commandFor(dir, file) }
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
  for (const f of ['hook.sh', 'statusline.sh', 'subagent-statusline.sh']) { try { chmodSync(join(dir, f), 0o755) } catch { /* fehlt */ } }
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
