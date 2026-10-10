// fx/timeline.js: einklappbarer "Verlauf" (eine Spur pro Akteur, Balken je Werkzeug, Farbe nach Zimmer)
// und die Karte "Runde fertig", wenn Claude live (oder in der Demo) mit einer Runde fertig ist.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const stage = document.querySelector('.stage')
if (!stage) return

// Zimmerfarben: aus dem Kern, falls vorhanden, sonst ruhige Toene aus der Palette
const ROOM_COL = { archiv: '#5f8f5a', werkstatt: '#b5653a', terminal: '#4f7a96', funkturm: '#7d5f80', leitstand: '#a68a2e', pausenraum: '#8a7a64' }
const roomCol = (st) => (st && (st.color || ROOM_COL[st.id])) || '#8a7a64'
const C = AB.COL || {}
const ROW = 26, BAR = 12, AXIS = 22, NAMES_W = 86, MAX_W = 12000

// Namen/Farben je Akteur merken (Agents verschwinden spaeter aus S.agents, der Verlauf behaelt sie)
const who = new Map()

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function fmtDur(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}
const hhmm = (t, sec) => {
  const d = new Date(t), p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}${sec ? ':' + p(d.getSeconds()) : ''}`
}

// ---------- Daten: Ereignisse -> Spuren ----------
function buildTracks(now) {
  const evs = (AB.S && AB.S.events) || []
  const tracks = new Map()
  const track = (aid) => {
    const k = aid || 'main'
    let tr = tracks.get(k)
    if (!tr) {
      const w = who.get(k)
      tr = { key: k, name: k === 'main' ? (AB.S.main.name || 'Claude') : (w && w.name) || 'Agent', color: k === 'main' ? (C.amber || '#96491f') : (w && w.color) || '#6f5a40',
        segs: [], waits: [], marks: [], open: new Map(), wait: null, end: 0 }
      tracks.set(k, tr)
    }
    return tr
  }
  track(null)
  const comps = []
  let compAt = 0
  // Post vor seinem Pre in der Datei (Hooks laufen parallel): der Balken ist schon fertig gezeichnet
  const closedEarly = new Set()
  for (const e of evs) {
    const t = e.t || 0
    switch (e.ev) {
      case 'PreToolUse': {
        const tr = track(e.aid)
        const k = e.tid || 'tool:' + (e.tool || '')
        if (e.tid && closedEarly.delete(e.tid)) break
        tr.open.set(k, { t0: t, tool: e.tool || '', what: e.what || '', st: AB.stationFor ? AB.stationFor(e.tool) : null })
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const tr = track(e.aid)
        const k = e.tid || 'tool:' + (e.tool || '')
        let o = tr.open.get(k)
        if (!o && !e.tid) for (const [kk, oo] of tr.open) if (oo.tool === e.tool) { o = oo; tr.open.delete(kk); break }
        tr.open.delete(k)
        const ok = e.ev === 'PostToolUse'
        if (!o && e.tid) closedEarly.add(e.tid)
        if (!o) o = { t0: e.dur != null ? t - e.dur : t, tool: e.tool || '', what: e.what || '', st: AB.stationFor ? AB.stationFor(e.tool) : null }
        tr.segs.push({ ...o, t1: Math.max(t, o.t0), ok, dur: e.dur != null ? e.dur : t - o.t0 })
        if (!ok) tr.marks.push({ t, k: 'err', text: `Fehler bei ${e.tool || 'Werkzeug'}` })
        if (tr.wait && (tr.wait.key ? tr.wait.key === k : (!tr.wait.tool || tr.wait.tool === e.tool))) { tr.waits.push({ ...tr.wait, t1: t }); tr.wait = null }
        break
      }
      case 'PermissionRequest': {
        const tr = track(e.aid)
        if (tr.wait) break
        // zum juengsten offenen Aufruf desselben Werkzeugs gehoerig (dessen Ende loest das Warten auf)
        let key = null
        for (const [kk, oo] of tr.open) if (oo.tool === e.tool) key = kk
        tr.wait = { t0: t, tool: e.tool || '', what: e.what || '', key }
        break
      }
      case 'PermissionDenied': {
        const tr = track(e.aid)
        if (tr.wait) { tr.waits.push({ ...tr.wait, t1: t, denied: true }); tr.wait = null }
        tr.marks.push({ t, k: 'err', text: `Erlaubnis abgelehnt${e.tool ? ': ' + e.tool : ''}` })
        break
      }
      case 'SubagentStop': {
        const tr = track(e.aid)
        tr.end = t
        for (const o of tr.open.values()) tr.segs.push({ ...o, t1: t, ok: true, dur: t - o.t0, cut: true })
        tr.open.clear()
        if (tr.wait) { tr.waits.push({ ...tr.wait, t1: t }); tr.wait = null }
        break
      }
      case 'SubagentStart': track(e.aid); break
      case 'StopFailure': track(null).marks.push({ t, k: 'err', text: `Abbruch: ${e.err || e.msg || 'Fehler'}` }); break
      case 'Stop': {
        const tr = track(null)
        if (tr.wait) { tr.waits.push({ ...tr.wait, t1: t }); tr.wait = null }
        break
      }
      case 'PreCompact': compAt = t; break
      case 'PostCompact': comps.push({ t0: compAt || t, t1: t, trig: e.trig }); compAt = 0; break
    }
  }
  if (compAt) comps.push({ t0: compAt, t1: now, trig: '', open: true })
  for (const tr of tracks.values()) {
    for (const o of tr.open.values()) tr.segs.push({ ...o, t1: now, ok: true, dur: null, running: true })
    if (tr.wait) tr.waits.push({ ...tr.wait, t1: now, running: true })
  }
  return { tracks: [...tracks.values()], comps, t0: evs.length ? evs[0].t : now }
}

// ---------- Verlauf-Panel ----------
const box = el('section', 'ab-tl')
box.setAttribute('aria-label', 'Verlauf')
const head = el('div', 'ab-tl-head')
const btn = el('button', 'ab-tl-btn', 'Verlauf')
btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.title = 'Zeitleiste der Session ein-/ausklappen'
const legend = el('div', 'ab-tl-legend')
legend.setAttribute('aria-hidden', 'true')
for (const st of AB.STATIONS || []) {
  if (st.id === 'pausenraum') continue
  const s = el('span', null, st.label); s.style.setProperty('--c', roomCol(st)); legend.append(s)
}
for (const [cls, label] of [['wait', 'wartet'], ['err', 'Fehler'], ['comp', 'Kompaktierung']]) {
  const s = el('span', 'ab-tl-lg-' + cls, label); legend.append(s)
}
head.append(btn, legend)
const body = el('div', 'ab-tl-body')
body.id = 'ab-tl-body'; btn.setAttribute('aria-controls', body.id)
body.hidden = true
const scroller = el('div', 'ab-tl-scroll')
scroller.tabIndex = 0
scroller.setAttribute('aria-label', 'Zeitleiste, waagrecht scrollbar')
const names = el('div', 'ab-tl-names')
const cv = el('canvas', 'ab-tl-cv')
cv.setAttribute('role', 'img')
const tip = el('div', 'ab-tl-tip'); tip.hidden = true
const emptyNote = el('p', 'ab-tl-empty', 'Noch nichts passiert.')
scroller.append(names, cv)
body.append(scroller, tip, emptyNote)
box.append(head, body)
stage.append(box)

let open = false, hits = [], dirty = true, lastDraw = 0
btn.addEventListener('click', () => {
  open = !open
  box.classList.toggle('ab-tl-open', open)
  btn.setAttribute('aria-expanded', String(open))
  body.hidden = !open
  if (open) { dirty = true; draw(true); scroller.scrollLeft = scroller.scrollWidth }
})

let stripe = null
function stripePattern(ctx) {
  if (stripe) return stripe
  const p = document.createElement('canvas'); p.width = 8; p.height = 8
  const g = p.getContext('2d')
  g.fillStyle = 'rgba(150,73,31,0.16)'; g.fillRect(0, 0, 8, 8)
  g.fillStyle = 'rgba(150,73,31,0.55)'
  for (let i = 0; i < 8; i++) { g.fillRect(i, 7 - i, 2, 1) } // Diagonale (auch ueber den Rand hinaus wiederholt)
  stripe = ctx.createPattern(p, 'repeat')
  return stripe
}

function draw(force) {
  if (!open) return
  const now = Date.now()
  if (!force && now - lastDraw < 480) return
  lastDraw = now
  const { tracks, comps, t0 } = buildTracks(now)
  const span = Math.max(1000, now - t0)
  const hasData = ((AB.S && AB.S.events) || []).length > 0
  emptyNote.hidden = hasData
  scroller.hidden = !hasData
  if (!hasData) return
  const avail = Math.max(120, (scroller.clientWidth || box.clientWidth - 20) - (names.offsetWidth || NAMES_W) - 4)
  const scale = Math.min(MAX_W / span, Math.max(avail / span, 6 / 1000)) // px pro ms, mind. 6 px/s
  const W = Math.max(avail, Math.ceil(span * scale) + 16)
  const H = AXIS + tracks.length * ROW + 4
  // Browser-Grenzen fuer Canvas: Kantenlaenge max. ~16k px, Flaeche max. ~16 Mio. px (iOS) -> dpr notfalls senken
  const dpr = Math.max(0.5, Math.min(3, window.devicePixelRatio || 1, 16000 / W, Math.sqrt(16e6 / (W * H))))
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 6
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    cv.style.width = `${W}px`; cv.style.height = `${H}px`
  }
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const X = (t) => Math.round(8 + (t - t0) * scale)
  hits = []

  // Zeilenhintergrund (abwechselnd)
  tracks.forEach((tr, i) => {
    if (i % 2) { ctx.fillStyle = 'rgba(58,44,32,0.04)'; ctx.fillRect(0, AXIS + i * ROW, W, ROW) }
  })
  // Zeitachse
  ctx.fillStyle = C.line || '#ddc9a3'; ctx.fillRect(0, AXIS - 1, W, 1)
  const steps = [5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3]
  const step = steps.find((s) => s * scale >= 90) || 7200e3
  ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace'
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  for (let t = Math.ceil(t0 / step) * step; t <= now; t += step) {
    const x = X(t)
    ctx.fillStyle = 'rgba(58,44,32,0.08)'; ctx.fillRect(x, AXIS, 1, H - AXIS)
    ctx.fillStyle = C.dim || '#6f5a40'; ctx.fillText(hhmm(t, step < 60e3), x + 3, AXIS / 2)
  }
  // Kompaktierung: helles Band ueber alle Spuren, Strich am Anfang
  for (const c of comps) {
    const x0 = X(c.t0), x1 = Math.max(x0 + 2, X(c.t1))
    ctx.fillStyle = 'rgba(79,122,150,0.12)'; ctx.fillRect(x0, AXIS, x1 - x0, H - AXIS)
    ctx.fillStyle = '#4f7a96'; ctx.fillRect(x0, AXIS, 2, H - AXIS)
    ctx.fillRect(x0 - 3, AXIS - 6, 8, 5)
    hits.push({ x0: x0 - 4, x1: x1 + 2, y0: 0, y1: H, prio: 0, text: `Kompaktierung${c.trig === 'manual' ? ' (manuell)' : c.trig === 'auto' ? ' (automatisch)' : ''}`, sub: c.open ? 'laeuft noch' : fmtDur(c.t1 - c.t0) })
  }
  // Spuren
  const pat = stripePattern(ctx)
  tracks.forEach((tr, i) => {
    const y = AXIS + i * ROW + (ROW - BAR) / 2
    for (const w of tr.waits) {
      const x0 = X(w.t0), x1 = Math.max(x0 + 3, X(w.t1))
      ctx.fillStyle = pat; ctx.fillRect(x0, y - 3, x1 - x0, BAR + 6)
      ctx.fillStyle = C.amber || '#96491f'; ctx.fillRect(x0, y - 3, x1 - x0, 1); ctx.fillRect(x0, y + BAR + 2, x1 - x0, 1)
      hits.push({ x0, x1, y0: y - 3, y1: y + BAR + 3, prio: 1, text: `${tr.name} wartet auf Erlaubnis`, sub: `${w.tool} ${w.what}`.trim() + ` · ${w.running ? 'seit ' : ''}${fmtDur(w.t1 - w.t0)}${w.denied ? ' · abgelehnt' : ''}` })
    }
    for (const s of tr.segs) {
      const x0 = X(s.t0), x1 = Math.max(x0 + 2, X(s.t1))
      ctx.fillStyle = s.ok ? roomCol(s.st) : (C.coral || '#9c3f30')
      ctx.globalAlpha = s.running ? 0.6 : 1
      ctx.fillRect(x0, y, x1 - x0, BAR)
      ctx.globalAlpha = 1
      if (x1 - x0 > 3) { ctx.fillStyle = 'rgba(251,243,228,0.55)'; ctx.fillRect(x1 - 1, y, 1, BAR) } // feine Trennung
      hits.push({ x0: x0 - 1, x1: x1 + 1, y0: y - 2, y1: y + BAR + 2, prio: 2, text: `${s.tool}${s.what ? ' ' + s.what : ''}`,
        sub: `${tr.name}${s.st ? ' · ' + s.st.label : ''} · ${s.running ? 'laeuft seit ' + fmtDur(now - s.t0) : fmtDur(s.dur != null ? s.dur : s.t1 - s.t0)}${s.ok ? '' : ' · Fehler'}`, err: !s.ok })
    }
    for (const m of tr.marks) {
      const x = X(m.t)
      ctx.fillStyle = C.coral || '#9c3f30'
      ctx.fillRect(x - 1, AXIS + i * ROW + 2, 2, ROW - 4)
      ctx.fillRect(x - 3, AXIS + i * ROW + 2, 6, 3)
      hits.push({ x0: x - 4, x1: x + 4, y0: AXIS + i * ROW, y1: AXIS + (i + 1) * ROW, prio: 3, text: m.text, sub: `${tr.name} · ${hhmm(m.t, true)}`, err: true })
    }
  })
  // Jetzt-Strich
  ctx.fillStyle = 'rgba(150,73,31,0.5)'; ctx.fillRect(X(now), AXIS, 1, H - AXIS)

  // Namensspalte (DOM, bleibt beim Scrollen links stehen)
  const sig = tracks.map((t) => t.key + t.name).join('|')
  if (names.dataset.sig !== sig) {
    names.dataset.sig = sig
    names.textContent = ''
    names.style.paddingTop = `${AXIS}px`
    for (const tr of tracks) {
      const n = el('div', 'ab-tl-name', tr.name)
      n.style.setProperty('--c', tr.color); n.style.height = `${ROW}px`
      names.append(n)
    }
  }
  cv.setAttribute('aria-label', `Zeitleiste: ${tracks.length} Spuren, ${tracks.reduce((n, t) => n + t.segs.length, 0)} Werkzeug-Aufrufe seit ${hhmm(t0)}`)
  if (atEnd) scroller.scrollLeft = scroller.scrollWidth
  dirty = false
}

function showTip(e) {
  const r = cv.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  let best = null
  for (const h of hits) if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && (!best || h.prio > best.prio)) best = h
  if (!best) { tip.hidden = true; return }
  tip.textContent = ''
  tip.append(el('b', best.err ? 'ab-tl-tip-err' : null, best.text), el('span', null, best.sub || ''))
  tip.hidden = false
  const br = body.getBoundingClientRect()
  let lx = e.clientX - br.left + 12, ly = e.clientY - br.top - tip.offsetHeight - 10
  if (lx + tip.offsetWidth > br.width - 6) lx = Math.max(6, e.clientX - br.left - tip.offsetWidth - 12)
  if (ly < 4) ly = e.clientY - br.top + 16
  tip.style.left = `${Math.round(lx)}px`; tip.style.top = `${Math.round(ly)}px`
}
cv.addEventListener('pointermove', showTip)
cv.addEventListener('pointerdown', showTip)
cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') tip.hidden = true })
scroller.addEventListener('scroll', () => { tip.hidden = true })

AB.on('ui', () => { if (open) draw(false) })
AB.onResize.push(() => { if (open) draw(true) })

// ---------- Karte "Runde fertig" ----------
let sumCard = null

function roundStats(stopEv) {
  const evs = (AB.S && AB.S.events) || []
  let i = evs.lastIndexOf(stopEv)
  if (i < 0) i = evs.length - 1
  let s = i
  while (s > 0 && evs[s - 1].ev !== 'UserPromptSubmit' && !(evs[s - 1].ev === 'Stop' && !evs[s - 1].aid)) s--
  if (s > 0 && evs[s - 1].ev === 'UserPromptSubmit') s--
  const agents = new Set(), rooms = new Map()
  let tools = 0, errs = 0, perms = 0, comps = 0
  for (let k = s; k <= i; k++) {
    const e = evs[k]
    if (e.aid && (e.ev === 'SubagentStart' || e.ev === 'PreToolUse')) agents.add(e.aid)
    if (e.ev === 'PreToolUse') {
      tools++
      const st = AB.stationFor ? AB.stationFor(e.tool) : null
      if (st) rooms.set(st.label, (rooms.get(st.label) || 0) + 1)
    } else if (e.ev === 'PostToolUseFailure' || e.ev === 'StopFailure') errs++
    else if (e.ev === 'PermissionRequest') perms++
    else if (e.ev === 'PreCompact') comps++
  }
  const top = [...rooms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const start = evs[s] ? evs[s].t : stopEv.t
  return { dur: Math.max(0, (stopEv.t || Date.now()) - start), agents: agents.size, tools, errs, perms, comps, top, msg: (stopEv.msg || '').trim() }
}

function markdown(r) {
  const lines = ['## Runde fertig', '',
    `- Dauer: ${fmtDur(r.dur) || '0 s'}`,
    `- Agents: ${r.agents}`,
    `- Werkzeuge: ${r.tools}`,
    `- Fehler: ${r.errs}`,
    `- Erlaubnis-Anfragen: ${r.perms}`,
    `- Kompaktierungen: ${r.comps}`]
  if (r.top.length) lines.push(`- Meiste Zimmer: ${r.top.map(([n, c]) => `${n} (${c})`).join(', ')}`)
  if (r.msg) lines.push('', `> ${r.msg}`)
  return lines.join('\n')
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* Fallback unten */ }
  try {
    const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

function closeSum() { if (sumCard) { sumCard.remove(); sumCard = null } }

function showSummary(stopEv) {
  closeSum()
  const r = roundStats(stopEv)
  const c = el('section', 'ab-sum')
  c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Runde fertig, Zusammenfassung')
  const h = el('div', 'ab-sum-head')
  const x = el('button', 'ab-sum-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Zusammenfassung schliessen')
  x.addEventListener('click', closeSum)
  h.append(el('h3', null, 'Runde fertig'), el('span', 'ab-sum-dur', fmtDur(r.dur) || '0 s'), x)
  c.append(h)
  if (r.msg) c.append(el('p', 'ab-sum-msg', r.msg))
  const dl = el('dl', 'ab-sum-grid')
  const add = (k, v, warn) => { const d = el('div', warn ? 'ab-sum-warn' : null); d.append(el('dt', null, k), el('dd', null, String(v))); dl.append(d) }
  add('Agents', r.agents); add('Werkzeuge', r.tools); add('Fehler', r.errs, r.errs > 0)
  add('Erlaubnis', r.perms); add('Kompaktiert', r.comps)
  c.append(dl)
  if (r.top.length) {
    const p = el('p', 'ab-sum-rooms')
    p.append(el('span', null, 'Meiste Zimmer: '))
    r.top.forEach(([n, cnt], i) => {
      const st = (AB.STATIONS || []).find((s) => s.label === n)
      const b = el('b', null, `${n} ${cnt}`); b.style.setProperty('--c', roomCol(st))
      if (i) p.append(document.createTextNode(' · '))
      p.append(b)
    })
    c.append(p)
  }
  const cp = el('button', 'ab-sum-copy', 'Zusammenfassung kopieren'); cp.type = 'button'
  cp.addEventListener('click', async () => {
    const ok = await copyText(markdown(r))
    cp.textContent = ok ? 'Kopiert ✓' : 'Kopieren ging nicht'
    setTimeout(() => { if (cp.isConnected) cp.textContent = 'Zusammenfassung kopieren' }, 1800)
  })
  c.append(cp)
  c.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSum() } })
  stage.append(c)
  sumCard = c
}

// ---------- Ereignisse ----------
AB.on('event', (ev, silent) => {
  if (!ev) return
  if (ev.ev === '__reset') { who.clear(); closeSum(); hits = []; tip.hidden = true; names.dataset.sig = ''; dirty = true; if (open) draw(true); return }
  if (ev.aid && !who.has(ev.aid)) {
    const a = AB.S.agents.get(ev.aid)
    if (a) who.set(ev.aid, { name: a.name, color: a.color })
  }
  dirty = true
  if (silent) return
  if (ev.ev === 'Stop' && !ev.aid) showSummary(ev)
  else if (ev.ev === 'UserPromptSubmit') closeSum()
})
})()
