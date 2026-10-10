// Ende-zu-Ende: genau die Befehle, die install.mjs eintraegt, in derselben Shell ausfuehren, die
// Claude Code fuer Hooks benutzt (bash bzw. unter Windows die Git Bash) - wie im echten Betrieb.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../install.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
// Unter Windows nie das WSL-bash aus System32 erwischen, sondern die Git Bash wie Claude Code
const SHELL = process.platform === 'win32'
  ? (process.env.CLAUDE_CODE_GIT_BASH_PATH || (existsSync(GIT_BASH) ? GIT_BASH : 'bash'))
  : '/bin/sh'

function run(cmd, input, dataDir) {
  return spawnSync(SHELL, ['-c', cmd], {
    input, encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, AGENT_BOARD_DATA: dataDir, CLAUDE_CODE_GIT_BASH_PATH: SHELL },
  })
}

test('eingetragener Hook-Befehl schreibt ein Ereignis nach events.jsonl', () => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-e2e-'))
  try {
    const settings = apply({}, DIR)
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command
    const r = run(cmd, JSON.stringify({
      hook_event_name: 'PreToolUse', session_id: 'abcdef1234', tool_name: 'Read',
      tool_input: { file_path: join(DIR, 'README.md') }, cwd: DIR,
    }), data)
    assert.equal(r.status, 0, r.stderr)
    const lines = readFileSync(join(data, 'events.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const ev = JSON.parse(lines[0])
    assert.equal(ev.ev, 'PreToolUse')
    assert.equal(ev.tool, 'Read')
    assert.equal(ev.what, 'README.md')
  } finally { rmSync(data, { recursive: true, force: true }) }
})

test('eingetragene Statusline gibt eine Zeile aus und schreibt status.json', () => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-e2e-'))
  try {
    const settings = apply({}, DIR)
    const r = run(settings.statusLine.command, JSON.stringify({ context_window: { used_percentage: 42 } }), data)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Ctx 42%/)
    assert.equal(JSON.parse(readFileSync(join(data, 'status.json'), 'utf8')).ctxPct, 42)
    const s = run(settings.subagentStatusLine.command, JSON.stringify({ tasks: [{ id: 't1', label: 'Test' }] }), data)
    assert.equal(s.status, 0, s.stderr)
    assert.equal(JSON.parse(readFileSync(join(data, 'subagents.json'), 'utf8')).subagents[0].id, 't1')
  } finally { rmSync(data, { recursive: true, force: true }) }
})
