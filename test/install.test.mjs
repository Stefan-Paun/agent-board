import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, EVENTS, commandFor } from '../install.mjs'

const DIR = '/opt/agent board'
const HOOK = commandFor(DIR, 'hook.sh')

test('Befehle sind gequotet (Leerzeichen im Pfad) und markiert', () => {
  assert.equal(HOOK, `'/opt/agent board/hook.sh' # agent-board`)
  assert.equal(commandFor("/x/it's", 'hook.sh'), `'/x/it'\\''s/hook.sh' # agent-board`)
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
  assert.equal(after.statusLine.command, commandFor(DIR, 'statusline.sh'))
  assert.equal(after.subagentStatusLine.command, commandFor(DIR, 'subagent-statusline.sh'))
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
