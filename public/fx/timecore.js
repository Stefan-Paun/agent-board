// Time machine core (no DOM, no network, no clock): given a list of board events and a playback
// position, it says which events have to be applied to show the board at that moment. Loads in the
// browser (fx/timemachine.js) and in Node (tests, like fx/daystats.js). Tested in test/timecore.test.mjs.
//
// Model: events sorted by time; the board state at position P is "all events with t <= P applied in
// order". Moving forward only applies the new events; moving backward rebuilds from scratch
// (reset, then apply everything up to P), so the result is always identical to a fresh playback.
(function (root) {
'use strict'

const SPEEDS = [1, 10, 60]
const GAP_MS = 20000 // a pause in the recording longer than this is skipped during playback
const GAP_LEAD_MS = 1500 // ... and playback lands this long before the next event
const MAX_FX = 6 // at most this many events of one step play with effects/sound, bigger steps are silent
const WAIT_NT = ['permission_prompt', 'agent_needs_input']
const MARK_MERGE_MS = 3000 // two "waiting" marks of one session this close together are one mark

// Valid events only (object, finite t, string ev), sorted by time; equal times keep their file order.
function normalize(events) {
  const out = []
  for (const e of Array.isArray(events) ? events : []) {
    if (e && typeof e === 'object' && typeof e.ev === 'string' && Number.isFinite(Number(e.t))) out.push(e)
  }
  return out.map((e, i) => [e, i]).sort((a, b) => Number(a[0].t) - Number(b[0].t) || a[1] - b[1]).map((x) => x[0])
}

// Number of events with t <= pos (binary search, evs must be sorted).
function countAt(evs, pos) {
  let lo = 0, hi = evs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (Number(evs[mid].t) <= pos) lo = mid + 1; else hi = mid
  }
  return lo
}

// What to do to get from "first `applied` events shown" to position pos: forward = apply the missing
// ones, backward = reset and apply the first `to` events.
function plan(evs, applied, pos) {
  const to = countAt(evs, pos)
  return to >= applied ? { reset: false, from: applied, to } : { reset: true, from: 0, to }
}

// Move pos forward by dtMs of real time at the given speed. A pause in the recording longer than
// GAP_MS is jumped over. `end` is where playback stops. Returns the new position (never beyond end).
function advance(evs, pos, dtMs, speed, end) {
  let p = pos + Math.max(0, dtMs) * (speed > 0 ? speed : 1)
  const n = countAt(evs, pos)
  const nextT = n < evs.length ? Number(evs[n].t) : end
  if (nextT - pos > GAP_MS) p = Math.max(p, nextT - GAP_LEAD_MS)
  return Math.min(p, end)
}

const leadKey = (e) => `${e.src === 'codex' || e.src === 'gemini' ? e.src : 'claude'}:${e.sid || ''}`

// Marks for the scrubber: 'wait' = a session needs the user (permission request / needs-input
// notification), 'round' = a round is finished (Stop of a main agent).
function marks(evs) {
  const out = []
  const lastWait = new Map()
  for (const e of evs) {
    const t = Number(e.t)
    if (e.ev === 'Stop' && !e.aid) out.push({ t, kind: 'round' })
    else if (e.ev === 'PermissionRequest' || (e.ev === 'Notification' && WAIT_NT.includes(e.nt))) {
      const k = leadKey(e)
      if (lastWait.has(k) && t - lastWait.get(k) < MARK_MERGE_MS) continue
      lastWait.set(k, t)
      out.push({ t, kind: 'wait' })
    }
  }
  return out
}

// Next (dir = 1) or previous (dir = -1) mark strictly after/before pos, optionally of one kind; null if none.
function nextMark(ms, pos, dir = 1, kind = null) {
  let best = null
  for (const m of ms) {
    if (kind && m.kind !== kind) continue
    if (dir >= 0 ? m.t > pos : m.t < pos) {
      if (!best || (dir >= 0 ? m.t < best.t : m.t > best.t)) best = m
    }
  }
  return best
}

// Window [from, to) of the local day `back` days before the day containing `now` (0 = today).
function dayRange(now, back = 0) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - back)
  const from = d.getTime()
  d.setDate(d.getDate() + 1)
  return { from, to: d.getTime() }
}

// A player over one event list. It never touches the board itself: sync(sink) calls
// sink.reset() and sink.apply(event, silent) for exactly the events that have to be (re)applied.
function createPlayer(events) {
  const evs = normalize(events)
  const t0 = evs.length ? Number(evs[0].t) : 0
  const t1 = evs.length ? Number(evs[evs.length - 1].t) : 0
  const ms = marks(evs)
  let pos = t0, speed = SPEEDS[0], playing = false, applied = 0
  const clamp = (p) => (Number.isFinite(Number(p)) ? Math.min(t1, Math.max(t0, Number(p))) : t0)
  return {
    events: evs, t0, t1, marks: ms,
    get pos() { return pos }, get speed() { return speed }, get playing() { return playing }, get applied() { return applied },
    get ended() { return evs.length > 0 && pos >= t1 },
    seek(p) { pos = clamp(p) },
    setSpeed(s) { if (SPEEDS.includes(s)) speed = s },
    play() { if (evs.length) { if (pos >= t1) pos = t0; playing = true } },
    pause() { playing = false },
    // advance by real milliseconds; stops by itself at the end
    tick(dtMs) {
      if (!playing) return
      pos = advance(evs, pos, dtMs, speed, t1)
      if (pos >= t1) playing = false
    },
    // jump to the next/previous mark; returns it (or null)
    jump(dir, kind) {
      const m = nextMark(ms, pos, dir, kind)
      if (m) pos = clamp(m.t)
      return m
    },
    // the board was reset from outside: nothing is applied any more
    invalidate() { applied = 0 },
    // bring the board to pos; effects = allow effects/sound for small forward steps
    sync(sink, effects = false) {
      const pl = plan(evs, applied, pos)
      if (pl.reset) sink.reset()
      const silent = pl.reset || !effects || pl.to - pl.from > MAX_FX
      for (let i = pl.from; i < pl.to; i++) sink.apply(evs[i], silent)
      applied = pl.to
      return pl
    },
  }
}

root.AgentBoardTimeCore = { SPEEDS, GAP_MS, GAP_LEAD_MS, MAX_FX, normalize, countAt, plan, advance, marks, nextMark, dayRange, createPlayer }
})(typeof window !== 'undefined' ? window : globalThis)
