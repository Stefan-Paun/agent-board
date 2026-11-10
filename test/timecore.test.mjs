// Time machine core (public/fx/timecore.js): position -> events to apply, backward jump = fresh
// playback, speeds, skipping idle gaps, marks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
vm.runInNewContext(readFileSync(join(PUB, 'fx', 'timecore.js'), 'utf8'), ctx)
const TC = ctx.window.AgentBoardTimeCore

const plain = (v) => JSON.parse(JSON.stringify(v))
const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime()
const s = (n) => T0 + n * 1000
// a small session: two rounds, a permission request in between, a long pause
const LOG = [
  { t: s(0), ev: 'UserPromptSubmit', sid: 'a' },
  { t: s(2), ev: 'PreToolUse', sid: 'a', tool: 'Read', tid: '1' },
  { t: s(3), ev: 'PostToolUse', sid: 'a', tool: 'Read', tid: '1' },
  { t: s(5), ev: 'SubagentStart', sid: 'a', aid: 'x' },
  { t: s(6), ev: 'PermissionRequest', sid: 'a', aid: 'x', tool: 'Bash' },
  { t: s(6.5), ev: 'Notification', sid: 'a', nt: 'permission_prompt' },
  { t: s(9), ev: 'SubagentStop', sid: 'a', aid: 'x' },
  { t: s(10), ev: 'Stop', sid: 'a' },
  { t: s(3600), ev: 'UserPromptSubmit', sid: 'a' }, // one hour later
  { t: s(3601), ev: 'Stop', sid: 'a' },
]

// A tiny stand-in for the board: state is a pure function of the applied events.
function board() {
  const st = { n: 0, tools: 0, agents: new Set(), done: 0, resets: 0, silent: [] }
  return {
    st,
    reset() { st.n = 0; st.tools = 0; st.agents = new Set(); st.done = 0; st.resets++ },
    apply(e, silent) {
      st.n++; st.silent.push(silent)
      if (e.ev === 'PreToolUse') st.tools++
      if (e.ev === 'SubagentStart') st.agents.add(e.aid)
      if (e.ev === 'SubagentStop') { st.agents.delete(e.aid); st.done++ }
    },
  }
}
const snap = (b) => JSON.stringify({ n: b.st.n, tools: b.st.tools, agents: [...b.st.agents], done: b.st.done })

test('normalize drops garbage and sorts by time, keeping file order for equal times', () => {
  const r = TC.normalize([{ t: 5, ev: 'b' }, null, { t: 'x', ev: 'c' }, { t: 1, ev: 'a' }, { t: 5, ev: 'b2' }, { ev: 'z' }, { t: 2 }, 7])
  assert.deepEqual(plain(r.map((e) => e.ev)), ['a', 'b', 'b2'])
  assert.equal(TC.normalize(null).length, 0)
})

test('countAt: events up to and including the position', () => {
  const evs = TC.normalize(LOG)
  assert.equal(TC.countAt(evs, s(-1)), 0)
  assert.equal(TC.countAt(evs, s(0)), 1)
  assert.equal(TC.countAt(evs, s(2.9)), 2)
  assert.equal(TC.countAt(evs, s(99999)), LOG.length)
})

test('plan: forward applies the missing events, backward rebuilds', () => {
  const evs = TC.normalize(LOG)
  assert.deepEqual(plain(TC.plan(evs, 2, s(5))), { reset: false, from: 2, to: 4 })
  assert.deepEqual(plain(TC.plan(evs, 5, s(3))), { reset: true, from: 0, to: 3 })
  assert.deepEqual(plain(TC.plan(evs, 3, s(3))), { reset: false, from: 3, to: 3 })
})

test('position decides the board: seek forward and back equals a fresh playback', () => {
  const a = TC.createPlayer(LOG), ba = board()
  a.seek(s(8)); a.sync(ba)
  a.seek(s(3)); a.sync(ba) // backward: reset + rebuild
  assert.equal(ba.st.resets, 1)
  const fresh = TC.createPlayer(LOG), bf = board()
  fresh.seek(s(3)); fresh.sync(bf)
  assert.equal(snap(ba), snap(bf))
  // and a long walk: every position gives the same state as a fresh player at that position
  for (const p of [s(0), s(5.5), s(6), s(9), s(2), s(10), s(1), s(3601), s(4)]) {
    a.seek(p); a.sync(ba)
    const f = TC.createPlayer(LOG), bb = board()
    f.seek(p); f.sync(bb)
    assert.equal(snap(ba), snap(bb), `position +${(p - T0) / 1000}s`)
  }
})

test('forward steps do not reset; the same position twice applies nothing', () => {
  const p = TC.createPlayer(LOG), b = board()
  p.seek(s(3)); p.sync(b)
  p.seek(s(6)); const r = p.sync(b)
  assert.equal(b.st.resets, 0)
  assert.equal(r.to - r.from, 2)
  assert.equal(p.sync(b).to - p.sync(b).from, 0)
  assert.equal(b.st.n, TC.countAt(p.events, s(6)))
})

test('effects only for small forward steps, jumps and rebuilds are silent', () => {
  const p = TC.createPlayer(LOG), b = board()
  p.seek(s(2)); p.sync(b, true) // 2 events, with effects
  assert.deepEqual(b.st.silent, [false, false])
  p.seek(s(3600)); p.sync(b, true) // 8 more than MAX_FX? 10 total - 2 = 8 > 6
  assert.ok(b.st.silent.slice(2).every(Boolean))
  p.seek(s(1)); p.sync(b, true) // rebuild
  assert.ok(b.st.silent.slice(10).every(Boolean))
  p.seek(s(2)); const q = b.st.silent.length; p.sync(b, false)
  assert.ok(b.st.silent.slice(q).every(Boolean))
})

test('speeds: 1x, 10x and 60x move the position accordingly', () => {
  assert.deepEqual(plain(TC.SPEEDS), [1, 10, 60])
  const dense = Array.from({ length: 200 }, (_, i) => ({ t: s(i), ev: 'PreToolUse' }))
  for (const sp of [1, 10, 60]) {
    const p = TC.createPlayer(dense)
    p.setSpeed(sp); p.play(); p.tick(1000)
    assert.equal(p.pos - p.t0, 1000 * sp)
  }
  const p = TC.createPlayer(dense)
  p.setSpeed(5) // not an allowed speed: ignored
  assert.equal(p.speed, 1)
})

test('long pauses without events are skipped, short ones are played', () => {
  const p = TC.createPlayer(LOG)
  p.seek(s(10)); p.play(); p.tick(100)
  // the next event is an hour away: landing shortly before it
  assert.equal(p.pos, s(3600) - TC.GAP_LEAD_MS)
  p.tick(1000)
  assert.ok(p.pos > s(3600) - TC.GAP_LEAD_MS && p.pos <= s(3601))
  // short gaps are not skipped
  const q = TC.createPlayer(LOG)
  q.play(); q.tick(500)
  assert.equal(q.pos, s(0.5))
})

test('playback stops at the end, play at the end starts over', () => {
  const p = TC.createPlayer(LOG)
  p.seek(s(3600.5)); p.play(); p.tick(5000)
  assert.equal(p.pos, p.t1); assert.equal(p.playing, false); assert.equal(p.ended, true)
  p.play()
  assert.equal(p.pos, p.t0); assert.equal(p.playing, true)
  const e = TC.createPlayer([])
  e.play(); assert.equal(e.playing, false)
  assert.equal(e.sync(board()).to, 0)
})

test('seek is clamped to the recording', () => {
  const p = TC.createPlayer(LOG)
  p.seek(1); assert.equal(p.pos, p.t0)
  p.seek(NaN); assert.equal(p.pos, p.t0) // not a number we can use
  p.seek(s(99999)); assert.equal(p.pos, p.t1)
})

test('marks: waiting for approval (merged) and finished rounds', () => {
  const m = TC.marks(TC.normalize(LOG))
  assert.deepEqual(plain(m.map((x) => [x.kind, x.t])), [['wait', s(6)], ['round', s(10)], ['round', s(3601)]])
  // a subagent Stop is no round; waiting marks of two sessions are not merged
  const m2 = TC.marks(TC.normalize([
    { t: 1000, ev: 'Stop', sid: 'a', aid: 'x' },
    { t: 2000, ev: 'PermissionRequest', sid: 'a' }, { t: 2500, ev: 'PermissionRequest', sid: 'b' },
    { t: 9000, ev: 'Notification', sid: 'a', nt: 'idle_prompt' },
    { t: 9500, ev: 'Notification', sid: 'a', nt: 'agent_needs_input' },
  ]))
  assert.deepEqual(plain(m2.map((x) => [x.kind, x.t])), [['wait', 2000], ['wait', 2500], ['wait', 9500]])
})

test('jump to the next / previous mark', () => {
  const p = TC.createPlayer(LOG)
  assert.equal(p.jump(1).t, s(6)); assert.equal(p.pos, s(6))
  assert.equal(p.jump(1).t, s(10))
  assert.equal(p.jump(1, 'round').t, s(3601))
  assert.equal(p.jump(1), null); assert.equal(p.pos, s(3601))
  assert.equal(p.jump(-1, 'wait').t, s(6))
  assert.equal(p.jump(-1), null)
  assert.equal(TC.nextMark([], 5, 1), null)
})

test('dayRange: local day windows', () => {
  const r = TC.dayRange(new Date(2026, 9, 12, 15, 30).getTime())
  assert.equal(r.from, new Date(2026, 9, 12).getTime())
  assert.equal(r.to, new Date(2026, 9, 13).getTime())
  const y = TC.dayRange(new Date(2026, 9, 12, 15, 30).getTime(), 1)
  assert.equal(y.from, new Date(2026, 9, 11).getTime())
  assert.equal(y.to, r.from)
})
