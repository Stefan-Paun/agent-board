import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { EVENTS } from '../install.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

test('Plugin-Manifest und Marketplace-Eintrag passen zusammen', () => {
  const plugin = json('.claude-plugin/plugin.json')
  const market = json('.claude-plugin/marketplace.json')
  assert.equal(plugin.name, 'agent-board')
  assert.ok(!/^(claude|anthropic)/i.test(plugin.name), 'reservierter Namensanfang')
  assert.equal(market.plugins.length, 1)
  assert.equal(market.plugins[0].name, plugin.name)
  assert.equal(market.plugins[0].source, './')
  assert.ok(market.owner?.name)
})

test('Plugin-Hooks: dieselben Ereignisse wie install.mjs, async, ohne Shell', () => {
  const { hooks } = json('hooks/hooks.json')
  assert.deepEqual(Object.keys(hooks).sort(), [...EVENTS].sort())
  for (const [ev, groups] of Object.entries(hooks)) {
    assert.equal(groups.length, 1, ev)
    assert.equal(groups[0].hooks.length, 1, ev)
    const h = groups[0].hooks[0]
    assert.equal(h.type, 'command')
    assert.equal(h.command, 'node', 'Exec-Form: laeuft auch unter Windows ohne Shell')
    assert.deepEqual(h.args, ['${CLAUDE_PLUGIN_ROOT}/collector.mjs'])
    assert.equal(h.async, true, `${ev}: Claude Code darf nie warten`)
  }
  assert.ok(existsSync(join(ROOT, 'collector.mjs')))
})
