// fx/timemachine.js: "Time machine" - replay part of the day on the board. Button next to "Today", a bar
// with play/pause, speed (1x/10x/60x), a scrubber with marks (waiting for approval / round finished),
// jump to the next mark, a clear "Recording, not live" banner and a button back to live.
// Live: the window comes from GET /replay (server.mjs); demo: the events the page has seen so far.
// The logic (positions, rebuild on backward jumps, gap skipping, marks, holding live events) is in
// fx/timecore.js and app.js (AB.travel); this file only builds the controls. Read-only, stores nothing.
(() => {
'use strict'
const AB = window.AgentBoard
const TC = window.AgentBoardTimeCore
if (!AB || !TC || !AB.travel || typeof document === 'undefined') return
const T = AB.t || ((k) => k)
const stage = document.querySelector('.stage')
if (!stage) return

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const pad = (n) => String(n).padStart(2, '0')
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const dateLabel = (t) => new Date(t).toLocaleDateString(AB.locale, { weekday: 'short', day: 'numeric', month: 'short' })
const STEP_MS = 10000 // arrow keys: jump this much recorded time
const MAX_MARKS = 400 // do not draw more than this many marks

// ---------- button next to "Today" ----------
const btn = el('button', 'ab-tm-btn', T('tm.btn'))
btn.type = 'button'; btn.title = T('tm.toggle'); btn.setAttribute('aria-expanded', 'false')
const dayBtn = stage.querySelector('.ab-day-btn')
const tlBtn = stage.querySelector('.ab-tl-btn')
if (dayBtn) dayBtn.after(btn)
else if (tlBtn) tlBtn.after(btn)
else { const w = el('div', 'ab-tm-solo'); w.append(btn); stage.append(w) }

// ---------- bar ----------
const bar = el('section', 'ab-tm')
bar.setAttribute('aria-label', T('tm.label')); bar.hidden = true
const banner = el('div', 'ab-tm-banner')
const dot = el('span', 'ab-tm-dot'); dot.setAttribute('aria-hidden', 'true')
const bannerText = el('b', null, T('tm.banner'))
const held = el('span', 'ab-tm-held')
const winSel = el('select', 'ab-tm-win'); winSel.setAttribute('aria-label', T('tm.win'))
for (const [v, k] of [['hour', 'tm.winHour'], ['today', 'tm.winToday'], ['yesterday', 'tm.winYesterday']]) {
  const o = el('option', null, T(k)); o.value = v; winSel.append(o)
}
winSel.value = 'today'
const liveBtn = el('button', 'ab-tm-live', T('tm.live')); liveBtn.type = 'button'
banner.append(dot, bannerText, held, winSel, liveBtn)

const row = el('div', 'ab-tm-row')
const playBtn = el('button', 'ab-tm-play', '▶'); playBtn.type = 'button'
const prevBtn = el('button', 'ab-tm-step', '⏮'); prevBtn.type = 'button'; prevBtn.title = T('tm.prevMark'); prevBtn.setAttribute('aria-label', T('tm.prevMark'))
const nextBtn = el('button', 'ab-tm-step', '⏭'); nextBtn.type = 'button'; nextBtn.title = T('tm.nextMark'); nextBtn.setAttribute('aria-label', T('tm.nextMark'))
const speedBtn = el('button', 'ab-tm-speed', '1×'); speedBtn.type = 'button'
const track = el('div', 'ab-tm-track')
const marksEl = el('div', 'ab-tm-marks'); marksEl.setAttribute('aria-hidden', 'true')
const slider = el('input', 'ab-tm-slider'); slider.type = 'range'; slider.min = '0'; slider.max = '0'; slider.step = '1'; slider.value = '0'
slider.setAttribute('aria-label', T('tm.scrub'))
track.append(marksEl, slider)
const timeEl = el('span', 'ab-tm-time', '--:--:--')
row.append(playBtn, prevBtn, nextBtn, track, timeEl, speedBtn)

const foot = el('div', 'ab-tm-foot')
const legend = el('div', 'ab-tm-legend'); legend.setAttribute('aria-hidden', 'true')
for (const [cls, k] of [['wait', 'tm.lgWait'], ['round', 'tm.lgRound']]) legend.append(el('span', `ab-tm-lg-${cls}`, T(k)))
const note = el('span', 'ab-tm-note'); note.setAttribute('role', 'status')
foot.append(legend, note)
bar.append(banner, row, foot)
stage.append(bar)

// frame around the stage while the board shows a recording
const frame = el('div', 'ab-tm-frame'); frame.hidden = true; frame.setAttribute('aria-hidden', 'true')
stage.append(frame)

// ---------- state ----------
let player = null, open = false, raf = 0, lastTs = 0, seq = 0, ctl = null, pendingSync = false
const sink = { reset: () => AB.travel.reset(), apply: (e, silent) => AB.travel.apply(e, silent) }
const travelling = () => AB.travel.active && !!player

function setNote(txt) { note.textContent = txt || '' }

function drawMarks() {
  marksEl.textContent = ''
  if (!player || player.t1 <= player.t0) return
  const span = player.t1 - player.t0
  const ms = player.marks.length > MAX_MARKS ? player.marks.filter((_, i) => i % Math.ceil(player.marks.length / MAX_MARKS) === 0) : player.marks
  for (const m of ms) {
    const s = el('i', `ab-tm-mark ab-tm-mark-${m.kind}`)
    s.style.left = `${((m.t - player.t0) / span) * 100}%`
    marksEl.append(s)
  }
}

function refresh() {
  const has = !!player
  for (const b of [playBtn, prevBtn, nextBtn, speedBtn, slider]) b.disabled = !has
  frame.hidden = !travelling()
  banner.classList.toggle('ab-tm-on', travelling())
  dot.hidden = bannerText.hidden = !travelling()
  const n = AB.travel.held()
  held.textContent = travelling() && n > 0 ? T('tm.held', { n }) : ''
  if (!has) { timeEl.textContent = '--:--:--'; return }
  const playing = player.playing
  playBtn.textContent = playing ? '⏸' : '▶'
  playBtn.title = playing ? T('tm.pause') : T('tm.play')
  playBtn.setAttribute('aria-label', playBtn.title)
  speedBtn.textContent = `${player.speed}×`
  speedBtn.title = T('tm.speed', { n: player.speed }); speedBtn.setAttribute('aria-label', speedBtn.title)
  if (document.activeElement !== slider || playing) slider.value = String(Math.round(player.pos - player.t0))
  timeEl.textContent = (new Date(player.t0).toDateString() !== new Date().toDateString() ? dateLabel(player.pos) + ' ' : '') + clock(player.pos)
}

// bring the board to the player's position
function sync(effects = false) {
  if (!player) return
  player.sync(sink, effects)
  AB.travel.settle(player.pos)
}

function loop(ts) {
  raf = 0
  if (!open) return
  if (player && player.playing) {
    const dt = Math.min(250, ts - (lastTs || ts))
    const before = player.pos
    player.tick(dt)
    if (player.pos !== before) sync(player.speed === 1)
    raf = requestAnimationFrame(loop)
  }
  lastTs = ts
  refresh()
}
function kick() { lastTs = 0; if (!raf && open) raf = requestAnimationFrame(loop) }

function setPlaying(on) {
  if (!player) return
  if (on) player.play(); else player.pause()
  refresh()
  kick()
}

function seekTo(p, effects = false) {
  if (!player) return
  player.seek(p)
  sync(effects)
  refresh()
}

// ---------- loading a window ----------
function windowFor(kind) {
  const now = Date.now()
  if (kind === 'hour') return { from: now - 3600e3, to: now + 60e3 }
  return TC.dayRange(now, kind === 'yesterday' ? 1 : 0)
}

async function fetchEvents(kind, signal) {
  if (AB.mode() === 'demo') return { events: TC.normalize(AB.S.events), truncated: false, demo: true }
  const w = windowFor(kind)
  const res = await fetch(`/replay?from=${Math.floor(w.from)}&to=${Math.floor(w.to)}`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`replay ${res.status}`)
  return TC.parseReplay(await res.text())
}

async function load() {
  const mine = ++seq
  if (ctl) ctl.abort()
  ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  setNote(T('tm.loading'))
  let r
  try { r = await fetchEvents(winSel.value, ctl && ctl.signal) } catch (e) {
    if (mine !== seq) return
    setNote(T('tm.error')); return
  }
  if (mine !== seq || !open) return
  if (!r.events.length) {
    // nothing to show: keep (or go back to) the live board
    if (player) { player.pause(); player = null; AB.travel.end() }
    drawMarks(); slider.max = '0'; refresh(); setNote(T('tm.empty')); return
  }
  player = TC.createPlayer(r.events)
  if (!AB.travel.active) AB.travel.begin(() => (player ? player.pos : Date.now()))
  AB.travel.reset()
  slider.max = String(Math.max(0, player.t1 - player.t0))
  drawMarks()
  player.seek(player.t1) // start where the board is now; drag back or press play (starts from the beginning)
  sync(false)
  setPlaying(false)
  refresh()
  setNote(r.demo ? T('tm.demoSource') : r.truncated ? T('tm.cut', { n: r.events.length }) : '')
}

// ---------- open / close ----------
function openBar() {
  if (open) return
  open = true
  bar.hidden = false; btn.setAttribute('aria-expanded', 'true')
  document.body.classList.add('abx-tm')
  winSel.hidden = AB.mode() === 'demo'
  load()
  playBtn.focus()
}

function closeBar(focusBtn = true) {
  if (!open) return
  open = false; seq++
  if (ctl) ctl.abort()
  if (raf) cancelAnimationFrame(raf); raf = 0
  if (player) { player.pause(); player = null }
  AB.travel.end() // rebuild the live board, then apply what arrived meanwhile
  bar.hidden = true; frame.hidden = true; btn.setAttribute('aria-expanded', 'false')
  document.body.classList.remove('abx-tm')
  setNote(''); slider.max = '0'; marksEl.textContent = ''
  refresh()
  if (focusBtn) btn.focus()
}

// the demo took over the board (started/stopped): drop the recording without touching it
AB.travel.onAbort = () => {
  open = false; seq++
  if (ctl) ctl.abort()
  if (raf) cancelAnimationFrame(raf); raf = 0
  player = null
  bar.hidden = true; frame.hidden = true; btn.setAttribute('aria-expanded', 'false')
  document.body.classList.remove('abx-tm')
  setNote(''); marksEl.textContent = ''
  refresh()
}

btn.addEventListener('click', () => (open ? closeBar() : openBar()))
liveBtn.addEventListener('click', () => closeBar())
winSel.addEventListener('change', load)
playBtn.addEventListener('click', () => { if (player) setPlaying(!player.playing) })
speedBtn.addEventListener('click', () => {
  if (!player) return
  const sp = TC.SPEEDS
  player.setSpeed(sp[(sp.indexOf(player.speed) + 1) % sp.length])
  refresh()
})
const jump = (dir) => { if (!player) return; const m = player.jump(dir); if (m) { sync(false); refresh() } }
prevBtn.addEventListener('click', () => jump(-1))
nextBtn.addEventListener('click', () => jump(1))
// scrubbing: one board update per frame, however many input events come
slider.addEventListener('input', () => {
  if (!player) return
  player.seek(player.t0 + Number(slider.value))
  refresh()
  if (pendingSync) return
  pendingSync = true
  requestAnimationFrame(() => { pendingSync = false; sync(false) })
})

// keyboard: Space = pause/play, arrows = +-10 s, Shift+arrows = previous/next mark (only while the bar is open)
const typing = () => { const t = document.activeElement; return !!t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range') || t.isContentEditable) }
document.addEventListener('keydown', (e) => {
  if (!open || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing()) return
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) setPlaying(player ? !player.playing : false); return }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault(); e.stopPropagation()
  if (!player) return
  const dir = e.key === 'ArrowRight' ? 1 : -1
  if (e.shiftKey) jump(dir); else seekTo(player.pos + dir * STEP_MS)
}, true)
// a focused button would otherwise click on Space release
document.addEventListener('keyup', (e) => { if (open && (e.key === ' ' || e.code === 'Space') && !typing()) e.preventDefault() }, true)

// the "held" counter changes while we are travelling
setInterval(() => { if (open) refresh() }, 1000)
})()
