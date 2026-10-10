import test from 'node:test'
import assert from 'node:assert/strict'
import { reduce, summarize } from '../collector.mjs'
import { hostOk } from '../server.mjs'

test('Prompt-Text wird nie gespeichert', () => {
  const r = reduce({ hook_event_name: 'UserPromptSubmit', session_id: 'abcdef123456', prompt: 'mein geheimes Passwort' })
  assert.equal(r.len, 22)
  assert.ok(!JSON.stringify(r).includes('Passwort'))
})

test('Dateipfade werden auf den Dateinamen gekuerzt', () => {
  assert.equal(summarize('Read', { file_path: '/Users/x/projekt/brain.py' }), 'brain.py')
})

test('lange schluesselaehnliche Strings werden unkenntlich', () => {
  const s = summarize('Bash', { command: 'curl -H "Authorization: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" https://x' })
  assert.ok(!s.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
})

test('Subagent-Ereignis behaelt agent_id und agent_type', () => {
  const r = reduce({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a1', agent_type: 'general-purpose' })
  assert.equal(r.aid, 'a1')
  assert.equal(r.at, 'general-purpose')
})

test('Fehler werden markiert, unbekannte Ereignisse ignoriert', () => {
  assert.equal(reduce({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }).ok, false)
  assert.equal(reduce({}), null)
})

test('nur localhost-Host-Header sind erlaubt', () => {
  assert.equal(hostOk('localhost:4777'), true)
  assert.equal(hostOk('evil.example:4777'), false)
})

test('tool_use_id wird gekuerzt, duration_ms als Zahl', () => {
  const pre = reduce({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.js' }, tool_use_id: 'toolu_01ABCDEFGHIJKLMNOPQRSTUV' })
  const post = reduce({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.js' }, tool_use_id: 'toolu_01ABCDEFGHIJKLMNOPQRSTUV', duration_ms: 12.4 })
  assert.equal(pre.tid, post.tid)
  assert.ok(pre.tid.length <= 12)
  assert.equal(post.dur, 12)
  assert.equal(pre.dur, undefined)
  const fail = reduce({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_x1', error: 'Exit code 1 /Users/geheim/pfad', duration_ms: 4187 })
  assert.equal(fail.ok, false)
  assert.equal(fail.dur, 4187)
  assert.ok(!JSON.stringify(fail).includes('geheim'))
})

test('Notification bekommt notification_type', () => {
  const r = reduce({ hook_event_name: 'Notification', message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  assert.equal(r.nt, 'permission_prompt')
  assert.equal(r.msg, 'Claude needs your permission')
})

test('PermissionRequest liefert tool, what und aid', () => {
  const r = reduce({ hook_event_name: 'PermissionRequest', agent_id: 'ag7', tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules' }, permission_suggestions: [] })
  assert.equal(r.ev, 'PermissionRequest')
  assert.equal(r.tool, 'Bash')
  assert.equal(r.what, 'rm -rf node_modules')
  assert.equal(r.aid, 'ag7')
  const d = reduce({ hook_event_name: 'PermissionDenied', tool_name: 'Bash', tool_input: { command: 'rm x' }, tool_use_id: 'toolu_zz', reason: '[Irreversible Local Destruction]' })
  assert.equal(d.ev, 'PermissionDenied')
  assert.equal(d.tid, 'zz')
})

test('StopFailure bekommt err, robust bei anderen Feldnamen', () => {
  assert.equal(reduce({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429' }).err, 'rate_limit')
  assert.equal(reduce({ hook_event_name: 'StopFailure', error_type: 'overloaded' }).err, 'overloaded')
  assert.equal(reduce({ hook_event_name: 'StopFailure', error: { type: 'billing_error' } }).err, 'billing_error')
  assert.equal(reduce({ hook_event_name: 'StopFailure' }).err, 'unknown')
})

test('Kompaktierung: trigger ja, Anweisungen und Zusammenfassung nie', () => {
  const pre = reduce({ hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: 'geheime Anweisung' })
  const post = reduce({ hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'geheime Zusammenfassung' })
  assert.equal(pre.trig, 'manual')
  assert.equal(post.trig, 'auto')
  assert.ok(!JSON.stringify([pre, post]).includes('geheim'))
})

test('Aufgaben: task_subject gekuerzt, Beschreibung nur als Ersatz', () => {
  const c = reduce({ hook_event_name: 'TaskCreated', task_id: 't1', task_subject: 'Implement user authentication', task_description: 'Add login' })
  assert.equal(c.task, 'Implement user authentication')
  const d = reduce({ hook_event_name: 'TaskCompleted', task_subject: 'x'.repeat(10) + ' ' + 'y'.repeat(100) })
  assert.ok(d.task.length <= 60)
})

test('Stop: Schlusssatz gekuerzt in msg', () => {
  const r = reduce({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Fertig. ' + 'Sehr lange Erklaerung '.repeat(20) })
  assert.ok(r.msg.startsWith('Fertig.'))
  assert.ok(r.msg.length <= 80)
  assert.equal(reduce({ hook_event_name: 'Stop' }).msg, undefined)
})

test('Allow-Liste fuer Host-Header (Tailscale)', () => {
  assert.equal(hostOk('mac.tail1234.ts.net', []), false)
  assert.equal(hostOk('mac.tail1234.ts.net', ['mac.tail1234.ts.net']), true)
  assert.equal(hostOk('mac.tail1234.ts.net:443', ['mac.tail1234.ts.net']), true)
  assert.equal(hostOk('evil.ts.net', ['mac.tail1234.ts.net']), false)
})

test('redact entfernt auch kurze Geheimnisse aus Befehlen', async () => {
  const { redact } = await import('../collector.mjs')
  const cases = {
    'export TOKEN=abc123secret && npm run': 'export TOKEN=… && npm run',
    'mysql -uroot -pS3cret! db': 'mysql -uroot -p… db',
    'curl -u user:pass https://x': 'curl -u user:… https://x',
    'git clone https://me:hunter2@github.com/a/b': 'git clone https://me:…@github.com/a/b',
    'curl -H "Authorization: Bearer abc.def" x': 'curl -H "Authorization: Bearer …" x',
    'gh auth --token ghp_abcdefghijk': 'gh auth --token …',
    'OPENAI_API_KEY="sk-123" node x': 'OPENAI_API_KEY=… node x',
  }
  for (const [inp, out] of Object.entries(cases)) assert.equal(redact(inp), out)
  for (const harmless of ['mkdir -p build', 'npm test', 'PATH=/bin ls', 'ls -la /tmp']) assert.equal(redact(harmless), harmless)
})

test('Codex: Ereignisse werden markiert, Claude-Ereignisse bleiben wie bisher', () => {
  const p = { hook_event_name: 'Stop', session_id: '0199a1b2-c3d4', cwd: '/x/projekt', last_assistant_message: 'Fertig.' }
  assert.equal(reduce(p, { src: 'codex' }).src, 'codex')
  assert.equal(reduce(p).src, undefined)
  assert.equal(reduce(p, { src: 'codex' }).msg, 'Fertig.')
})

test('Codex: Shell-Befehle landen als Bash im Terminal, auch als Liste und weiter geschwaerzt', () => {
  const r = reduce({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'call_abc123' }, { src: 'codex' })
  assert.equal(r.tool, 'Bash'); assert.equal(r.what, 'npm test'); assert.equal(r.tid, 'abc123')
  const l = reduce({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'exec_command', tool_input: { command: ['bash', '-lc', 'TOKEN=geheim1234 ls'] } }, { src: 'codex' })
  assert.equal(l.tool, 'Bash'); assert.ok(!l.what.includes('geheim'))
})

test('Codex: apply_patch zeigt die Dateinamen und landet in der Werkstatt', () => {
  const patch = '*** Begin Patch\n*** Update File: src/app.js\n@@\n-a\n+b\n*** Add File: docs/neu.md\n+x\n*** End Patch'
  const r = reduce({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'apply_patch', tool_input: { command: patch } }, { src: 'codex' })
  assert.equal(r.tool, 'Edit'); assert.equal(r.what, 'app.js +1')
  assert.ok(!JSON.stringify(r).includes('+b'), 'Patch-Inhalt wird nicht gespeichert')
  const w = reduce({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: neu.txt\n+hi\n*** End Patch' } }, { src: 'codex' })
  assert.equal(w.tool, 'Write'); assert.equal(w.what, 'neu.txt')
})

test('Codex: Subagents und MCP-Werkzeuge', () => {
  const a = reduce({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'spawn_agent', tool_input: { agent_type: 'explorer', message: 'geheimer Auftragstext' } }, { src: 'codex' })
  assert.equal(a.tool, 'Agent'); assert.equal(a.what, 'explorer')
  assert.ok(!JSON.stringify(a).includes('geheim'))
  const m = reduce({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'mcp__fs__read_file', tool_input: { path: '/x' } }, { src: 'codex' })
  assert.equal(m.tool, 'mcp__fs__read_file'); assert.equal(m.what, '')
})

test('kaputte Eingaben werfen nicht', () => {
  assert.equal(reduce(null), null)
  assert.equal(reduce('text'), null)
  assert.doesNotThrow(() => reduce({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: 5 }, { src: 'codex' }))
})
