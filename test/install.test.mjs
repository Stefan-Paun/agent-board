import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, EVENTS, CODEX_EVENTS, GEMINI_EVENTS, commandFor } from '../install.mjs'
import { shellFor } from '../statusline.mjs'

const DIR = '/opt/agent board'
const HOOK = commandFor(DIR, 'collector.mjs')
const STATUS = commandFor(DIR, 'statusline.mjs')
const SUB = commandFor(DIR, 'statusline.mjs', 'subagents')

test('Befehle rufen node direkt auf, sind gequotet (Leerzeichen im Pfad) und markiert', () => {
  assert.equal(HOOK, `node "/opt/agent board/collector.mjs" --agent-board`)
  assert.equal(SUB, `node "/opt/agent board/statusline.mjs" subagents --agent-board`)
  assert.equal(commandFor("/x/it's", 'collector.mjs'), `node "/x/it's/collector.mjs" --agent-board`)
  assert.equal(commandFor('/x/a"b$c`d', 'collector.mjs'), 'node "/x/a\\"b\\$c\\`d/collector.mjs" --agent-board')
})

test('Windows-Pfade werden zu Schraegstrichen (laeuft in Git Bash)', () => {
  assert.equal(commandFor('C:\\Users\\Max Muster\\agent-board', 'collector.mjs'),
    'node "C:/Users/Max Muster/agent-board/collector.mjs" --agent-board')
})

test('weitergereichte Statusline: Git Bash unter Windows, sonst /bin/sh', () => {
  assert.equal(shellFor('darwin', {}), '/bin/sh')
  assert.equal(shellFor('linux', {}), '/bin/sh')
  assert.equal(shellFor('win32', {}), 'bash')
  assert.equal(shellFor('win32', { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe' }), 'C:\\Git\\bin\\bash.exe')
})

test('Upgrade von 1.0: alte hook.sh-/statusline.sh-Eintraege werden ersetzt, nicht verdoppelt', () => {
  const v1 = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `'/opt/agent board/hook.sh' # agent-board`, async: true }] }] },
    statusLine: { type: 'command', command: `'/opt/agent board/statusline.sh' # agent-board`, padding: 0 },
    subagentStatusLine: { type: 'command', command: `'/opt/agent board/subagent-statusline.sh' # agent-board` },
  }
  const after = apply(v1, DIR)
  assert.equal(after.hooks.Stop.length, 1)
  assert.equal(after.hooks.Stop[0].hooks[0].command, HOOK)
  assert.equal(after.statusLine.command, STATUS)
  assert.equal(after.subagentStatusLine.command, SUB)
  assert.equal(after.env, undefined) // alte eigene Eintraege sind keine "fremde" Statusline
  assert.deepEqual(apply(after, DIR, { uninstall: true }), {})
})

test('Statusline und Subagent-Statusline werden nicht verwechselt', () => {
  const after = apply({}, DIR)
  const swapped = { ...after, statusLine: { type: 'command', command: SUB } }
  const again = apply(swapped, DIR)
  assert.equal(again.env.AGENT_BOARD_STATUSLINE_NEXT, SUB)
})

test('install traegt alle Ereignisse async ein und laesst fremde Hooks stehen', () => {
  const before = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo fremd' }] }] } }
  const after = apply(before, DIR)
  assert.equal(after.model, 'opus')
  for (const ev of EVENTS) {
    const cmds = after.hooks[ev].flatMap((g) => g.hooks)
    assert.ok(cmds.some((h) => h.command === HOOK && h.async === true), ev)
  }
  assert.ok(after.hooks.PreToolUse.some((g) => g.matcher === 'Bash' && g.hooks[0].command === 'echo fremd'))
  assert.equal(after.statusLine.command, STATUS)
  assert.equal(after.subagentStatusLine.command, SUB)
})

test('install ist wiederholbar und ersetzt alte Agent-Board-Pfade', () => {
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/Users/x/agent-board/hook.sh' }] }] } }
  const once = apply(old, DIR), twice = apply(once, DIR)
  assert.deepEqual(once, twice)
  assert.equal(twice.hooks.Stop.length, 1)
  assert.equal(twice.hooks.Stop[0].hooks[0].command, HOOK)
})

test('fremde Skripte mit gleichem Dateinamen bleiben unangetastet', () => {
  const before = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/home/u/notify/hook.sh' }] }] },
    statusLine: { type: 'command', command: '~/.claude/statusline.sh', padding: 2 },
  }
  const after = apply(before, DIR)
  assert.ok(after.hooks.Stop.some((g) => g.hooks[0].command === '/home/u/notify/hook.sh'))
  assert.equal(after.env.AGENT_BOARD_STATUSLINE_NEXT, '~/.claude/statusline.sh')
  assert.equal(after.statusLine.padding, 2)
  assert.deepEqual(apply(after, DIR, { uninstall: true }), before)
})

test('vorhandene eigene Statusline wird weitergereicht und beim Entfernen wiederhergestellt', () => {
  const before = { statusLine: { type: 'command', command: '~/mein-status.sh' } }
  const after = apply(before, DIR)
  assert.equal(after.env.AGENT_BOARD_STATUSLINE_NEXT, '~/mein-status.sh')
  assert.deepEqual(apply(after, DIR, { uninstall: true }), before)
})

test('uninstall entfernt nur Agent-Board', () => {
  const before = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo fremd' }] }] } }
  assert.deepEqual(apply(apply(before, DIR), DIR, { uninstall: true }), before)
})

test('kaputte Formate werfen sauber statt zu zerstoeren', () => {
  assert.throws(() => apply([], DIR))
  assert.throws(() => apply({ hooks: [] }, DIR))
  const odd = { hooks: { Stop: [null, { hooks: {} }] } }
  const after = apply(odd, DIR)
  assert.deepEqual(after.hooks.Stop.slice(0, 2), [null, { hooks: {} }])
})

test('Codex: eigene Ereignisliste, markierter Befehl mit "codex", Timeout, keine Statusline', () => {
  const out = apply({}, DIR, { codex: true })
  assert.deepEqual(Object.keys(out.hooks).sort(), [...CODEX_EVENTS].sort())
  const h = out.hooks.PreToolUse[0].hooks[0]
  assert.equal(h.command, `node "/opt/agent board/collector.mjs" codex --agent-board`)
  assert.equal(h.async, true); assert.equal(h.timeout, 10)
  assert.equal(out.statusLine, undefined); assert.equal(out.subagentStatusLine, undefined)
})

test('Codex: fremde Hooks bleiben, erneutes Installieren verdoppelt nichts, Deinstallieren raeumt auf', () => {
  const mine = { hooks: [{ type: 'command', command: 'python3 check.py' }] }
  const before = { description: 'meine Hooks', hooks: { PreToolUse: [mine] } }
  const once = apply(before, DIR, { codex: true })
  assert.deepEqual(apply(once, DIR, { codex: true }), once)
  assert.equal(once.hooks.PreToolUse.length, 2)
  assert.deepEqual(apply(once, DIR, { codex: true, uninstall: true }), before)
})

test('Claude- und Codex-Eintraege verwechseln sich nicht', () => {
  const claude = apply({}, DIR)
  const codexCmd = apply({}, DIR, { codex: true }).hooks.Stop[0].hooks[0]
  const mixed = structuredClone(claude); mixed.hooks.Stop.push({ hooks: [codexCmd] })
  // Claude-Deinstallation laesst einen (versehentlich) eingetragenen Codex-Hook stehen und umgekehrt
  assert.equal(apply(mixed, DIR, { uninstall: true }).hooks.Stop[0].hooks[0].command, codexCmd.command)
  assert.equal(apply(mixed, DIR, { codex: true, uninstall: true }).hooks.Stop.length, 1)
})

test('Gemini: eigene Ereignisse, markierter Befehl mit "gemini", Timeout in ms, kein async, keine Statusline', () => {
  const out = apply({}, DIR, { gemini: true })
  assert.deepEqual(Object.keys(out.hooks).sort(), [...GEMINI_EVENTS].sort())
  const g = out.hooks.BeforeTool[0]
  assert.equal(g.matcher, '*')
  assert.equal(g.hooks[0].type, 'command')
  assert.equal(g.hooks[0].command, `node "/opt/agent board/collector.mjs" gemini --agent-board`)
  assert.equal(g.hooks[0].timeout, 5000); assert.equal(g.hooks[0].async, undefined)
  assert.equal(out.hooks.SessionStart[0].matcher, undefined)
  assert.equal(out.statusLine, undefined)
})

test('Gemini: fremde Hooks und Einstellungen bleiben, wiederholbar, Deinstallieren raeumt nur Eigenes ab', () => {
  const before = { theme: 'Dracula', hooks: { BeforeTool: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'echo fremd' }] }] } }
  const once = apply(before, DIR, { gemini: true })
  assert.deepEqual(apply(once, DIR, { gemini: true }), once)
  assert.equal(once.hooks.BeforeTool.length, 2); assert.equal(once.theme, 'Dracula')
  assert.deepEqual(apply(once, DIR, { gemini: true, uninstall: true }), before)
  // Claude-/Codex-Deinstallation fasst Gemini-Eintraege nicht an
  assert.equal(apply(once, DIR, { uninstall: true }).hooks.BeforeTool.length, 2)
  assert.equal(apply(once, DIR, { codex: true, uninstall: true }).hooks.SessionEnd.length, 1)
})

test('Gemini: CLI schreibt nach GEMINI_CLI_HOME, macht Sicherungskopie und --uninstall stellt her', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = mkdtempSync(join(tmpdir(), 'ab-gemhome-'))
  mkdirSync(join(home, '.gemini'))
  const file = join(home, '.gemini', 'settings.json')
  const orig = { theme: 'x', hooks: { AfterTool: [{ hooks: [{ type: 'command', command: 'echo fremd' }] }] } }
  writeFileSync(file, JSON.stringify(orig))
  const run = (...a) => spawnSync(process.execPath, [new URL('../install.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--gemini', ...a], { env: { ...process.env, GEMINI_CLI_HOME: home }, encoding: 'utf8' })
  const dry = run('--dry-run'); assert.equal(dry.status, 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), orig)
  const r = run(); assert.equal(r.status, 0, r.stderr)
  assert.ok(readdirSync(join(home, '.gemini')).some((n) => n.startsWith('settings.json.agent-board-backup-')))
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).hooks.BeforeTool)
  assert.equal(run('--uninstall').status, 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), orig)
})
