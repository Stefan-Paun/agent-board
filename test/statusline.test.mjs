import test from 'node:test'
import assert from 'node:assert/strict'
import { toStatus, toSubagents, line } from '../statusline.mjs'
import { mergedStatus } from '../server.mjs'

const sample = {
  session_id: 'abc', model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  cost: { total_cost_usd: 0.31234 },
  context_window: { used_percentage: 41.6 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } },
}

test('Statusline-JSON wird auf den Vertrag reduziert', () => {
  const s = toStatus(sample, 1000)
  assert.deepEqual(s, { t: 1000, ctxPct: 42, costUsd: 0.312, model: 'claude-opus-5-5',
    rl5h: { usedPct: 23.5, resetsAt: 1738425600000 }, rl7d: { usedPct: 41.2, resetsAt: 1738857600000 } })
  assert.equal(line(s), 'Ctx 42% · $0.31 · 5h 24%')
})

test('fehlende Felder fuehren nicht zu Fehlern', () => {
  assert.deepEqual(toStatus({ context_window: { used_percentage: null } }, 5), { t: 5 })
  assert.deepEqual(toStatus(null, 5), { t: 5 })
  assert.equal(line({ t: 1 }), 'Agent-Board')
})

test('Subagent-Zeilen: Token-Verlauf wird mitgefuehrt und begrenzt', () => {
  const p = (n) => ({ tasks: [{ id: 'task-1', type: 'local_agent', agentType: 'Explore', status: 'running', description: 'Code durchsuchen', label: 'liest brain.py', tokenCount: n, tokenSamples: [n], model: 'claude-sonnet-5' }] })
  let prev = null
  for (let i = 1; i <= 25; i++) prev = toSubagents(p(i * 100), prev, i)
  const s = prev.subagents[0]
  assert.equal(s.id, 'task-1')
  assert.equal(s.label, 'liest brain.py')
  assert.equal(s.tokens, 2500)
  assert.equal(s.tokenSamples.length, 20)
  assert.equal(s.tokenSamples.at(-1), 2500)
  assert.equal(s.model, 'claude-sonnet-5')
  assert.deepEqual(toSubagents({}, prev, 9).subagents, [])
})

test('Server fuehrt status.json und subagents.json zusammen, alte Subagents fallen weg', () => {
  assert.equal(mergedStatus(0, null, null), null)
  const m = mergedStatus(10000, { t: 1, ctxPct: 5 }, { t: 9000, subagents: [{ id: 'a' }] })
  assert.equal(m.ctxPct, 5)
  assert.equal(m.subagents.length, 1)
  assert.deepEqual(mergedStatus(200000, { t: 1 }, { t: 9000, subagents: [{ id: 'a' }] }).subagents, [])
})
