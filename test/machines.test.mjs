// Second machine, board side: pure filter logic (public/machine-logic.js) and its wiring into the page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = {}
vm.runInNewContext(readFileSync(join(PUB, 'machine-logic.js'), 'utf8'), ctx)
const M = ctx.AgentBoardMachines
const plain = (v) => JSON.parse(JSON.stringify(v))

test('machineOf: only short names count, everything else is this machine', () => {
  assert.equal(M.machineOf({ machine: 'pc-two' }), 'pc-two')
  for (const ev of [{}, null, { machine: '' }, { machine: 'local' }, { machine: 'this' }, { machine: 'all' }, { machine: 'PC' }, { machine: 'a b' }, { machine: '<b>x</b>' }, { machine: 'x'.repeat(17) }, { machine: 7 }, { machine: { a: 1 } }]) {
    assert.equal(M.machineOf(ev), '', JSON.stringify(ev))
  }
})

test('matches: all / this machine / one name', () => {
  assert.equal(M.matches('all', ''), true)
  assert.equal(M.matches('all', 'pc-two'), true)
  assert.equal(M.matches('this', ''), true)
  assert.equal(M.matches('this', 'pc-two'), false)
  assert.equal(M.matches('pc-two', 'pc-two'), true)
  assert.equal(M.matches('pc-two', ''), false)
  assert.equal(M.matches('pc-two', 'laptop'), false)
  assert.equal(M.matches(undefined, 'laptop'), true)
})

test('options: empty without a second machine, else all / this / names sorted', () => {
  assert.deepEqual(plain(M.options([])), [])
  assert.deepEqual(plain(M.options(['wsl', 'pc-two', 'wsl'])), ['all', 'this', 'pc-two', 'wsl'])
  assert.deepEqual(plain(M.options(['all', 'this', 'BAD NAME'])), [], 'names that collide with the fixed entries are not offered')
})

test('normalize: a filter on an unknown machine falls back to all', () => {
  assert.equal(M.normalize('this', []), 'this')
  assert.equal(M.normalize('pc-two', ['pc-two']), 'pc-two')
  assert.equal(M.normalize('pc-two', []), 'all')
  assert.equal(M.normalize('gone', ['pc-two']), 'all')
  assert.equal(M.normalize(null, ['pc-two']), 'all')
  assert.equal(M.normalize('all', ['all']), 'all')
})

test('tag: the machine name is appended to the name in the scene', () => {
  assert.equal(M.tag('Claude', ''), 'Claude')
  assert.equal(M.tag('AGENT 1', 'pc-two'), 'AGENT 1 @pc-two')
})

test('merge keeps time order and loses nothing', () => {
  const a = [{ t: 1, k: 'a1' }, { t: 5, k: 'a2' }, { t: 9, k: 'a3' }], b = [{ t: 2, k: 'b1' }, { t: 5, k: 'b2' }, { t: 20, k: 'b3' }]
  assert.deepEqual(plain(M.merge(a, b)).map((e) => e.k), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'])
  assert.equal(M.merge(a, []), a)
  assert.equal(M.merge([], b), b)
})

test('wiring: logic loads before app.js, the filter module after crew.js, and the service worker knows the files', () => {
  const html = readFileSync(join(PUB, 'index.html'), 'utf8')
  const at = (s) => { const i = html.indexOf(s); assert.ok(i >= 0, s); return i }
  assert.ok(at('src="machine-logic.js"') < at('src="app.js"'))
  assert.ok(at('src="fx/crew.js"') < at('src="fx/machines.js"'))
  at('href="fx/machines.css"')
  const sw = readFileSync(join(PUB, 'sw.js'), 'utf8')
  for (const f of ['machine-logic.js', 'machines.js', 'machines.css']) assert.ok(sw.includes(`'${f}'`), f)
})

test('the board shows the machine name only as text, never as markup', () => {
  for (const f of ['fx/machines.js', 'fx/crew.js']) assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(readFileSync(join(PUB, f), 'utf8')), f)
})
