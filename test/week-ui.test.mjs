// fx/week.js mit einem kleinen DOM-Ersatz (kein Browser noetig): Karte oeffnen, Tabelle/Balken/Listen pruefen,
// schliessen. Das echte Aussehen prueft der Browser-Test (npm run test:browser, braucht Chrome).
process.env.TZ = 'Europe/Vienna'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const read = (f) => readFileSync(join(PUB, f), 'utf8')

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.attrs = {}; this.listeners = {}; this._text = ''; this.className = ''; this.style = { setProperty() {} }; this.dataset = {} }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  append(...n) { for (const c of n) { if (typeof c === 'string') continue; if (c.parent) c.remove(); c.parent = this; this.children.push(c) } }
  after(n) { const i = this.parent.children.indexOf(this); n.parent = this.parent; this.parent.children.splice(i + 1, 0, n) }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
  get childElementCount() { return this.children.length }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn) }
  click() { for (const f of this.listeners.click || []) f({}) }
  focus() {}
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false }
  get isConnected() { let x = this; while (x.parent) x = x.parent; return x.root === true }
  matches(sel) {
    const cls = this.className.split(/\s+/)
    return sel.split(',').some((s) => {
      s = s.trim()
      const m = s.match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[aria-expanded="(\w+)"\])?(?::not\(\.([\w-]+)\))?$/)
      if (!m) return false
      if (m[1] && m[1] !== this.tag) return false
      if (m[2].split('.').filter(Boolean).some((c) => !cls.includes(c))) return false
      if (m[3] && this.getAttribute('aria-expanded') !== m[3]) return false
      if (m[4] && cls.includes(m[4])) return false
      return true
    })
  }
  querySelectorAll(sel) {
    const out = []
    const walk = (n) => { for (const c of n.children) { if (c.matches(sel.replace(/ .*$/, ''))) out.push(c); walk(c) } }
    walk(this)
    if (/ /.test(sel)) { const last = sel.split(' ').pop(); return out.flatMap((o) => o.querySelectorAll(last)) }
    return out
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
}

function setup(mode, events = []) {
  const stage = new Node_('div'); stage.className = 'stage'
  const root = new Node_('body'); root.root = true; root.append(stage)
  const dayBtn = new Node_('button'); dayBtn.className = 'ab-day-btn'; dayBtn.setAttribute('aria-expanded', 'false'); stage.append(dayBtn)
  const hooks = {}
  const document = {
    createElement: (t) => new Node_(t), createTextNode: (x) => { const n = new Node_('#text'); n._text = String(x); return n }, createElementNS: (ns, t) => new Node_(t), activeElement: null,
    querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
  }
  const ctx = { window: {}, document, fetch: async () => { throw new Error('kein Server') }, setTimeout, console }
  ctx.window = ctx
  ctx.AgentBoard = {
    t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), lang: 'en', locale: 'en-GB', mode: () => mode, S: { events },
    on: (p, f) => { (hooks[p] ||= []).push(f) }, parseTool: (t, w) => ({ label: w ? `${t}:${w}` : t }),
  }
  for (const f of ['fx/daystats.js', 'fx/weekstats.js', 'fx/week.js']) vm.runInNewContext(read(f), ctx)
  return { stage, root, dayBtn, hooks, weekBtn: stage.querySelector('.ab-week-btn') }
}

test('Demo: Knopf neben "Heute", Karte mit 7 Balken, 7x24 Zahlenzellen, Listen', async () => {
  const s = setup('demo')
  assert.ok(s.weekBtn)
  assert.equal(s.stage.children.indexOf(s.weekBtn), s.stage.children.indexOf(s.dayBtn) + 1)
  s.weekBtn.click()
  await new Promise((r) => setTimeout(r, 0))
  const card = s.stage.querySelector('.ab-week')
  assert.ok(card)
  assert.equal(s.weekBtn.getAttribute('aria-expanded'), 'true')
  assert.equal(card.querySelectorAll('.ab-week-bar').length, 7)
  assert.equal(card.querySelector('tbody').querySelectorAll('tr').length, 7)
  const cells = card.querySelectorAll('.ab-week-c')
  assert.equal(cells.length, 7 * 24)
  assert.ok(cells.every((c) => /^\d+$/.test(c.textContent)))
  assert.ok(cells.some((c) => Number(c.textContent) > 0))
  assert.equal(card.querySelectorAll('.ab-week-list li').length, 8 + 3)
  assert.match(card.textContent, /week\.vsActive/) // Vorwoche vorhanden
  assert.match(card.textContent, /week\.sample/)
  s.weekBtn.click() // zweiter Klick schliesst
  assert.equal(s.stage.querySelector('.ab-week'), null)
  assert.equal(s.weekBtn.getAttribute('aria-expanded'), 'false')
})

test('ohne Server (lokal): leere Woche zeigt den Leertext, mit Ereignissen eine Auswertung ohne Vorwoche', () => {
  const s = setup('off')
  s.weekBtn.click()
  const card = s.stage.querySelector('.ab-week')
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    assert.match(card.textContent, /week\.empty/)
    s.weekBtn.click()
    const now = Date.now()
    const s2 = setup('off', [{ t: now - 600000, ev: 'UserPromptSubmit', sid: 'a', proj: 'x' }, { t: now - 60000, ev: 'Stop', sid: 'a' }])
    s2.weekBtn.click()
    return new Promise((r2) => setTimeout(r2, 0)).then(() => {
      const c2 = s2.stage.querySelector('.ab-week')
      assert.ok(!/week\.empty/.test(c2.textContent))
      assert.match(c2.textContent, /week\.seen/)
      assert.doesNotMatch(c2.textContent, /week\.vsActive/)
      assert.equal(c2.querySelectorAll('.ab-week-c').length, 168)
    })
  })
})

test('Tagesbilanz oeffnen schliesst die Wochenkarte', async () => {
  const s = setup('demo')
  s.weekBtn.click(); await new Promise((r) => setTimeout(r, 0))
  assert.ok(s.stage.querySelector('.ab-week'))
  s.dayBtn.click()
  assert.equal(s.stage.querySelector('.ab-week'), null)
})
