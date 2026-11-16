// fx/timemachine.js against a tiny fake DOM and the real core/travel gate: opens, loads a window,
// scrubs, plays, jumps to marks, holds live events and rebuilds live on "Back to live".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const src = (f) => readFileSync(join(PUB, f), 'utf8')

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {}; this.attrs = {}; this.hidden = false; this.disabled = false; this._text = ''; this.className = ''; this.value = ''; this.style = { setProperty() {} } }
  get classList() { const s = this; return { toggle(c, on) { const l = new Set(s.className.split(' ').filter(Boolean)); (on ? l.add(c) : l.delete(c)); s.className = [...l].join(' ') }, add(c) { this.toggle(c, true) }, remove(c) { this.toggle(c, false) } } }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
  append(...k) { this.children.push(...k) }
  after(k) { (this.parent ||= { children: [] }).children.push(k) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn) }
  querySelector() { return null }
  focus() { doc.activeElement = this }
  click() { for (const f of this.handlers.click || []) f({}) }
  fire(t, e = {}) { for (const f of this.handlers[t] || []) f(e) }
}
const doc = { activeElement: null, listeners: {}, body: new El('body'), stage: new El('div'),
  createElement: (t) => new El(t), querySelector: (s) => (s === '.stage' ? doc.stage : null),
  addEventListener(t, fn) { (doc.listeners[t] ||= []).push(fn) } }
const key = (type, k, extra = {}) => { const e = { key: k, code: k === ' ' ? 'Space' : k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, ...extra }; for (const f of doc.listeners[type] || []) f(e); return e }

const T0 = Date.now() - 600000
const s = (n) => T0 + n * 1000
const LOG = [
  { t: s(0), ev: 'UserPromptSubmit', sid: 'a' }, { t: s(1), ev: 'PreToolUse', sid: 'a', tool: 'Read' },
  { t: s(5), ev: 'PermissionRequest', sid: 'a', tool: 'Bash' }, { t: s(9), ev: 'PostToolUse', sid: 'a', tool: 'Read' },
  { t: s(12), ev: 'Stop', sid: 'a' }, { t: s(30), ev: 'PreToolUse', sid: 'a', tool: 'Edit' },
]

const fetched = []
function setup({ mode = 'demo', fetchBody = '' } = {}) {
  const applied = [] // what the board currently shows (the fake app state)
  const rafs = []
  const sandbox = { window: {}, document: doc, AbortController, setInterval: () => 0, requestAnimationFrame: (f) => rafs.push(f), cancelAnimationFrame() {},
    fetch: async (url) => { fetched.push(String(url)); return { ok: true, text: async () => fetchBody } } }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src('fx/timecore.js'), sandbox)
  const TC = sandbox.AgentBoardTimeCore
  const S = { events: LOG.slice() }
  const log = []
  const gate = TC.createTravel({
    events: () => S.events, reset: () => { S.events = []; log.push('reset') },
    apply: (e, silent) => { S.events.push(e); log.push(silent ? 's' : 'a') }, settle: () => log.push('settle'),
  })
  const settledAt = []
  const AB = {
    t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), locale: 'en-GB', S, mode: () => mode,
    travel: { get active() { return gate.active }, held: () => gate.held(), onAbort: null, begin: (c) => gate.begin(c), reset: () => { S.events = []; log.push('reset') },
      apply: (e, silent) => { S.events.push(e); log.push(silent ? 's' : 'a') }, settle: (t) => settledAt.push(t), end: () => gate.end() },
  }
  sandbox.AgentBoard = AB
  vm.runInContext(src('fx/timemachine.js'), sandbox)
  const bar = doc.stage.children.find((c) => c.className === 'ab-tm')
  const find = (cls, from = bar) => { for (const c of from.children) { if (String(c.className).split(' ').includes(cls)) return c; const r = find(cls, c); if (r) return r } return null }
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)) }
  return { AB, S, gate, bar, find, log, settledAt, rafs, flush, btn: find('ab-tm-btn', doc.stage) || doc.stage.children.find((c) => c.children?.[0]?.className === 'ab-tm-btn')?.children[0] }
}

test('opens in demo mode with the demo events, shows the banner, scrubs back and returns to live', async () => {
  doc.stage.children = []
  const x = setup()
  assert.ok(x.bar && x.bar.hidden, 'bar exists and is hidden at first')
  const btn = x.btn
  assert.ok(btn, 'time machine button is in the page')
  btn.click(); await x.flush()
  assert.equal(x.bar.hidden, false)
  assert.equal(x.gate.active, true)
  assert.equal(x.find('ab-tm-win').hidden, true) // no window choice in the demo
  const frame = doc.stage.children.find((c) => c.className === 'ab-tm-frame')
  assert.equal(frame.hidden, false)
  assert.match(x.find('ab-tm-banner').textContent, /tm\.banner/)
  const slider = x.find('ab-tm-slider')
  assert.equal(slider.max, String(30000)) // recording length in ms
  assert.equal(x.S.events.length, LOG.length) // rebuilt up to the end
  // drag back to +4 s: only the first two events are shown
  slider.value = '4000'; slider.fire('input'); x.rafs.splice(0).forEach((f) => f(0))
  assert.equal(x.S.events.length, 2)
  // live event while travelling is held, not shown
  x.gate.push({ t: Date.now(), ev: 'Stop' })
  assert.equal(x.S.events.length, 2)
  // next mark = permission request at +5 s
  x.find('ab-tm-step', x.bar) // exists
  const steps = []; (function walk(n) { for (const c of n.children) { if (c.className === 'ab-tm-step') steps.push(c); walk(c) } })(x.bar)
  steps[1].click()
  assert.equal(slider.value, '5000')
  assert.equal(x.S.events.length, 3)
  // back to live: the recording is gone, the live events plus the held one are there, exactly once
  x.find('ab-tm-live').click()
  assert.equal(x.bar.hidden, true); assert.equal(frame.hidden, true); assert.equal(x.gate.active, false)
  assert.equal(x.S.events.length, LOG.length + 1)
  assert.equal(x.S.events.at(-1).ev, 'Stop')
})

test('keyboard: Space plays/pauses, arrows jump 10 s, Shift+arrow jumps to a mark; ignored when closed', async () => {
  doc.stage.children = []; doc.listeners = {}
  const x = setup()
  assert.equal(key('keydown', ' ').defaultPrevented, false) // bar closed: Space is left alone
  x.btn.click(); await x.flush()
  const slider = x.find('ab-tm-slider')
  const e = key('keydown', ' ')
  assert.equal(e.defaultPrevented, true)
  assert.match(x.find('ab-tm-play').textContent, /⏸/) // at the end, play starts over and runs
  key('keydown', ' ')
  assert.match(x.find('ab-tm-play').textContent, /▶/)
  key('keydown', 'ArrowLeft'); assert.equal(slider.value, '0') // jumped back from the start: clamped
  key('keydown', 'ArrowRight'); assert.equal(slider.value, '10000')
  key('keydown', 'ArrowRight', { shiftKey: true }); assert.equal(slider.value, '12000') // round finished
  key('keydown', 'ArrowLeft', { shiftKey: true }); assert.equal(slider.value, '5000') // waiting for approval
  assert.ok(x.settledAt.length > 3 && x.settledAt.every((t) => t >= T0)) // the board clock follows the position
  x.find('ab-tm-live').click()
  assert.equal(key('keydown', ' ').defaultPrevented, false)
})

test('live mode loads the window from /replay and honours a cut window', async () => {
  doc.stage.children = []; doc.listeners = {}
  const body = LOG.map((e) => JSON.stringify(e)).join('\n') + '\n{"ev":"__end","n":6,"truncated":true}\n'
  const x = setup({ mode: 'live', fetchBody: body })
  x.btn.click(); await x.flush()
  assert.equal(x.gate.active, true)
  assert.match(fetched.at(-1), /^replay\?from=\d+&to=\d+$/) // relativ: funktioniert hinter einem Unterpfad
  assert.equal(x.find('ab-tm-win').hidden, false)
  assert.match(x.find('ab-tm-note').textContent, /tm\.cut/)
  assert.equal(x.find('ab-tm-slider').max, '30000')
  x.find('ab-tm-live').click()
})

test('an empty window keeps the live board and says so', async () => {
  doc.stage.children = []; doc.listeners = {}
  const x = setup({ mode: 'live', fetchBody: '{"ev":"__end","n":0,"truncated":false}\n' })
  x.btn.click(); await x.flush()
  assert.equal(x.gate.active, false)
  assert.match(x.find('ab-tm-note').textContent, /tm\.empty/)
  assert.equal(x.S.events.length, LOG.length)
})

test('the demo taking over closes the bar without rebuilding', async () => {
  doc.stage.children = []; doc.listeners = {}
  const x = setup()
  x.btn.click(); await x.flush()
  assert.equal(x.gate.active, true)
  x.gate.abort(); x.AB.travel.onAbort()
  assert.equal(x.bar.hidden, true)
})
