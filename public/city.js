// city.js: die isometrische Pixel-Stadt. Jedes Gebaeude ist ein Raum des Boards, jeder Agent eine kleine
// Figur, die live zwischen den Gebaeuden laeuft. Liest nur den Zustand des Boards (AgentBoard.S, stationFor,
// waiting()), baut keine eigene Datenhaltung auf. Reine Logik steht in city-logic.js (getestet).
// Gezeichnet wird in einen kleinen Kunst-Puffer (ganzzahlig hochskaliert, ohne Glaetten); nur Beschriftungen
// laufen danach scharf ueber das echte Canvas. Umschalten: Knopf "Stadt", Taste C, oder ?view=city.
(() => {
'use strict'
const AB = window.AgentBoard
const L = window.AgentBoardCityLogic
if (!AB || !L || typeof document === 'undefined') return
const T = AB.t || ((k) => k)
const stage = document.querySelector('.stage')
const mapCanvas = document.getElementById('map')
const btn = document.getElementById('b-view')
if (!stage || !mapCanvas) return

const params = new URLSearchParams(location.search)
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)')
let reduce = reduceMQ.matches
if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', (e) => { reduce = e.matches })

// ---------- Farben (die Pixel-Palette des Boards, erweitert um Haus-Farben) ----------
const PX = AB.PX
const INK = PX.ink
const C = {
  grassA: '#d0d9b4', grassB: '#c7d2a8', grassDk: '#b4c293', flowers: ['#f2d27a', '#e8a0a8', '#fbf3e4', '#b9a3d6'],
  road: '#eadbbd', roadB: '#e2d0ae', roadSeam: '#d2bd96', path: '#f2e6cb',
  dirt: '#a9825a', dirtDk: '#8a6744', dirtLt: '#c19a6d', turf: '#98ab78',
  wood: '#a9825a', woodDk: '#7d5e3f', woodLt: '#c39b6c', glass: '#8fb0b5', glassLit: '#ffd27a', glassHi: '#fff0b8',
  green: '#5f8f5a', greenLt: '#86b073', greenDk: '#46704a', stone: '#c9bba0', stoneDk: '#a89a80', stoneLt: '#ddd1b8',
  water: '#8cc3cf', waterLt: '#c6e6ea', red: '#c4503c', amber: '#ffbe4a',
}
// je Gebaeude: l = linke Wand, r = rechte (schattige) Wand, t = Dach, hi = Kante oben, lo = Fussleiste, tex = Linienmuster, acc = Akzent
const PAL = {
  archiv: { l: '#aebd92', r: '#93a678', t: '#d4a06e', hi: '#e8c9a0', lo: '#7d8f64', ltex: '#a2b186', rtex: '#889a6e', acc: '#a14f62' },
  werkstatt: { l: '#cc7e53', r: '#ab6240', t: '#8f6a52', hi: '#e8a77d', lo: '#8c4f31', ltex: '#c2754b', rtex: '#a15b3a', acc: '#e8c47a' },
  terminal: { l: '#625145', r: '#4b3d33', t: '#7d6a58', hi: '#8a7664', lo: '#3a2f27', ltex: '#5a4a3f', rtex: '#43362d', acc: '#7fe0a8' },
  funkturm: { l: '#8ba5b8', r: '#6f899d', t: '#b7cad6', hi: '#c9d9e3', lo: '#5d7587', ltex: '#8099ac', rtex: '#677f93', acc: '#c4503c' },
  leitstand: { l: '#dcb257', r: '#b99238', t: '#eed091', hi: '#f6e2ae', lo: '#9a7a2c', ltex: '#d3a94d', rtex: '#af8a33', acc: '#9c3f30' },
  pausenraum: { l: '#f2d9ae', r: '#dcc193', t: '#e6a58e', hi: '#f8e8c8', lo: '#c0a577', ltex: '#ebd0a3', rtex: '#d3b886', acc: '#d96d6a' },
}
const SPINES = ['#c4503c', '#4f7a96', '#d9a441', '#7d5f80', '#fbf3e4', '#5f8f5a', '#a14f62']

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mixCache = new Map()
function mix(a, b, t) {
  const k = a + b + t
  let v = mixCache.get(k)
  if (!v) {
    const x = hexRgb(a), y = hexRgb(b)
    v = '#' + [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('')
    mixCache.set(k, v)
  }
  return v
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

// ---------- Kleine Zeichenhelfer (alles ganzzahlig, damit die Kanten scharf bleiben) ----------
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }
const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h) }
const S2 = (gx, gy, z = 0) => { const p = L.toScreen(gx, gy, z); return { x: Math.round(p.x), y: Math.round(p.y) } }
function disc(c, col, cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); R(c, col, cx - w, cy + dy, w * 2 + 1, 1) }
}
function ellipse(c, col, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) { const w = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01))); R(c, col, cx - w, cy + dy, w * 2 + 1, 1) }
}
// Kreisumriss aus Einzelpixeln (fuer Funkwellen)
function ring(c, col, cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2) {
  c.fillStyle = col
  const n = Math.max(12, Math.round(rx * 3))
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; c.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1) }
}
function line(c, col, x0, y0, x1, y1) {
  c.fillStyle = col
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy
  for (let n = 0; n < 400; n++) {
    c.fillRect(x0, y0, 1, 1)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}
// 3x5-Pixelschrift fuer Schilder (nur wenige Zeichen)
const GLYPH = {
  '?': ['111', '001', '011', '000', '010'], '!': ['010', '010', '010', '000', '010'], '>': ['100', '010', '001', '010', '100'],
  '_': ['000', '000', '000', '000', '111'], Z: ['111', '001', '010', '100', '111'],
}
function glyph(c, col, ch, x, y, s = 1) {
  const g = GLYPH[ch]; if (!g) return
  c.fillStyle = col
  for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') c.fillRect(x + k * s, y + r * s, s, s)
}

// Rechteck-Diamant (Boden oder Dach) auf Hoehe z: pixelgenau, mit hellem Rand oben und dunklem unten
function diamond(c, gx0, gy0, w, d, z, col, rimHi, rimLo) {
  const Lp = S2(gx0, gy0 + d, z), Tp = S2(gx0, gy0, z), Bp = S2(gx0 + w, gy0 + d, z), Rp = S2(gx0 + w, gy0, z)
  for (let X = Lp.x; X < Rp.x; X++) {
    const up = X < Tp.x ? Lp.y - ((X - Lp.x) >> 1) : Tp.y + ((X - Tp.x) >> 1)
    const lo = X < Bp.x ? Lp.y + ((X - Lp.x) >> 1) : Bp.y - ((X - Bp.x) >> 1)
    R(c, col, X, up, 1, lo - up + 1)
    if (rimHi) R(c, rimHi, X, up, 1, 1)
    if (rimLo) R(c, rimLo, X, lo, 1, 1)
  }
}
// Quader: linke Wand (+gy), rechte Wand (+gx), Dach. pal: l, r, t, hi, lo, ltex, rtex
function isoBox(c, gx0, gy0, w, d, z0, hh, pal) {
  const Lp = S2(gx0, gy0 + d, z0), Bp = S2(gx0 + w, gy0 + d, z0)
  const wl = Math.round(w * 16), wr = Math.round(d * 16)
  for (let i = 0; i < wl; i++) {
    const yb = Lp.y + (i >> 1)
    R(c, pal.l, Lp.x + i, yb - hh, 1, hh)
    if (pal.ltex) for (let v = 3; v < hh - 1; v += 4) R(c, pal.ltex, Lp.x + i, yb - v, 1, 1)
    if (pal.lo) R(c, pal.lo, Lp.x + i, yb - 1, 1, 1)
    if (pal.hi) R(c, pal.hi, Lp.x + i, yb - hh, 1, 1)
  }
  for (let i = 0; i < wr; i++) {
    const yb = Bp.y - (i >> 1)
    R(c, pal.r, Bp.x + i, yb - hh, 1, hh)
    if (pal.rtex) for (let v = 3; v < hh - 1; v += 4) R(c, pal.rtex, Bp.x + i, yb - v, 1, 1)
    if (pal.lo) R(c, pal.lo, Bp.x + i, yb - 1, 1, 1)
    if (pal.hi) R(c, mix(pal.hi, pal.r, 0.5), Bp.x + i, yb - hh, 1, 1)
  }
  R(c, pal.hi || pal.l, Bp.x, Bp.y - hh, 1, hh) // vordere Kante
  if (pal.t) diamond(c, gx0, gy0, w, d, z0 + hh, pal.t, pal.hi, pal.lo ? mix(pal.t, pal.lo, 0.4) : null)
}
// Punkt auf der linken/rechten Wand eines Gebaeudes: u Pixel entlang der Wand, v Pixel ueber dem Boden
const faceL = (b, u, v) => { const p = S2(b.x, b.y + b.d, 0); return { x: p.x + u, y: p.y + (u >> 1) - v } }
const faceR = (b, u, v) => { const p = S2(b.x + b.w, b.y + b.d, 0); return { x: p.x + u, y: p.y - (u >> 1) - v } }
// Rechteck auf einer Wand (Spaltenweise, folgt der Schraege)
function wallRect(c, col, face, b, u, v, uw, vh) {
  const f = face === 'L' ? faceL : faceR
  for (let i = 0; i < uw; i++) { const p = f(b, u + i, v + vh); R(c, col, p.x, p.y, 1, vh) }
}

// ---------- Gebaeude-Sprites ----------
// Fenster und Tueren: Zustand "lit" (belegt) oeffnet die Tuer und laesst die Scheiben warm leuchten
function windowOn(c, face, b, u, v, w, h, lit, kind, pal) {
  const trim = mix(pal.hi, '#fbf3e4', 0.5)
  wallRect(c, trim, face, b, u - 1, v - 1, w + 2, h + 2)
  if (kind === 'shelf') { // Archiv: Buecherregal hinter der Scheibe
    wallRect(c, '#5a4632', face, b, u, v, w, h)
    for (let row = 0; row * 4 < h; row++) {
      for (let i = 0; i < w; i++) {
        const hsh = hash(`${u}${v}${row}${i >> 1}`)
        const col = SPINES[hsh % SPINES.length]
        wallRect(c, lit ? col : mix(col, '#3a2c20', 0.28), face, b, u + i, v + row * 4 + 1, 1, 3)
      }
      wallRect(c, '#3a2c20', face, b, u, v + row * 4, w, 1)
    }
    if (lit) wallRect(c, 'rgba(255,210,122,0.22)', face, b, u, v, w, h)
    return
  }
  if (kind === 'screen') { // Terminal: dunkle Scheibe mit gruenen Textzeilen
    wallRect(c, lit ? '#243a30' : '#2c2620', face, b, u, v, w, h)
    for (let row = 0; row < Math.floor((h - 1) / 3); row++) {
      const len = 3 + (hash(`${u}${v}${row}`) % Math.max(2, w - 4))
      wallRect(c, lit ? '#7fe0a8' : '#3f6048', face, b, u + 1, v + 2 + row * 3, Math.min(len, w - 2), 1)
    }
    return
  }
  wallRect(c, lit ? C.glassLit : (kind === 'warm' ? '#e9d6a6' : C.glass), face, b, u, v, w, h)
  wallRect(c, lit ? C.glassHi : mix(C.glass, '#ffffff', 0.45), face, b, u + 1, v + h - 3, Math.max(2, w >> 1), 2)
  wallRect(c, trim, face, b, u + (w >> 1), v, 1, h) // Mittelsprosse
  wallRect(c, pal.lo, face, b, u - 2, v - 2, w + 4, 1) // Fensterbank
  if (kind === 'warm') { wallRect(c, '#d96d6a', face, b, u, v + h - 3, 2, 3); wallRect(c, '#d96d6a', face, b, u + w - 2, v + h - 3, 2, 3) } // Vorhaenge
}
function doorOn(c, b, lit, big) {
  const pal = PAL[b.id]
  const w = big ? 18 : 12, h = big ? 22 : 18, u = b.w * 8 - (w >> 1)
  wallRect(c, mix(pal.hi, '#fbf3e4', 0.4), 'L', b, u - 2, 0, w + 4, h + 2)
  wallRect(c, lit ? '#3a2c20' : C.wood, 'L', b, u, 0, w, h)
  if (lit) { wallRect(c, '#e8a85a', 'L', b, u + 2, 0, w - 4, h - 3); wallRect(c, C.glassLit, 'L', b, u + 3, 2, w - 6, h - 7) }
  else { wallRect(c, C.woodDk, 'L', b, u + (w >> 1), 0, 1, h); wallRect(c, '#f2d27a', 'L', b, u + (w >> 1) - 2, h >> 1, 1, 2) }
  // gestreifte Markise ueber der Tuer
  for (let i = -3; i < w + 3; i++) wallRect(c, (i >> 1) % 2 ? '#fbf3e4' : pal.acc, 'L', b, u + i, h + 2, 1, 3)
  // Stufe
  const s0 = faceL(b, u - 2, 0)
  R(c, C.stoneLt, s0.x, s0.y, 1, 1)
  for (let i = 0; i < w + 4; i++) { const p = faceL(b, u - 2 + i, -1); R(c, C.stone, p.x, p.y, 1, 2) }
}
// Schild ueber der Tuer: Holzplatte, der Name wird scharf darueber gelegt
function signPlate(c, b) {
  const u = 6, w = b.w * 16 - 12, v = b.h - 12
  wallRect(c, C.woodDk, 'L', b, u - 1, v - 1, w + 2, 11)
  wallRect(c, C.woodLt, 'L', b, u, v, w, 9)
  wallRect(c, C.wood, 'L', b, u, v, w, 1)
}

const BUILD = {
  archiv(c, b, lit) {
    const p = PAL.archiv
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    windowOn(c, 'L', b, 6, 8, 10, 18, lit, 'shelf', p); windowOn(c, 'L', b, 48, 8, 10, 18, lit, 'shelf', p)
    windowOn(c, 'R', b, 9, 10, 10, 18, lit, 'shelf', p); windowOn(c, 'R', b, 28, 10, 10, 18, lit, 'shelf', p)
    doorOn(c, b, lit, false)
    // Dach: Brüstung, Dachfenster, Kuppel mit Wetterfahne
    isoBox(c, b.x + 0.2, b.y + 0.2, b.w - 0.4, b.d - 0.4, b.h, 3, { l: '#e0b080', r: '#c4915f', t: '#d4a06e', hi: '#f0cfa5', lo: '#a87a4c' })
    isoBox(c, b.x + 0.7, b.y + 0.8, 1.2, 1.0, b.h + 3, 3, { l: '#b8d6d6', r: '#8fb0b5', t: '#d6ecec', hi: '#fbf3e4' })
    isoBox(c, b.x + 2.4, b.y + 0.9, 1.0, 1.0, b.h + 3, 14, { l: '#f2dfbb', r: '#d6c29a', t: '#c4503c', hi: '#fbf3e4', lo: '#b8a47c' })
    const t = S2(b.x + 2.9, b.y + 1.4, b.h + 17)
    R(c, '#5a4632', t.x, t.y - 8, 1, 8); R(c, C.amber, t.x + 1, t.y - 8, 3, 2)
    // Uhr an der rechten Wand
    const k = faceR(b, 24, b.h - 12)
    disc(c, INK, k.x, k.y, 6); disc(c, '#fbf3e4', k.x, k.y, 5); R(c, INK, k.x, k.y - 3, 1, 4); R(c, INK, k.x, k.y, 3, 1)
  },
  werkstatt(c, b, lit) {
    const p = PAL.werkstatt
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    // Sägezahndach mit Glasflanken
    for (let k = 0; k < 3; k++) isoBox(c, b.x + 0.3 + k * 1.2, b.y + 0.2, 1.0, b.d - 0.4, b.h, 7, { l: '#8f6a52', r: lit ? '#ffd9a0' : '#9fc0c4', t: '#a98265', hi: '#c4a187', lo: '#6d4e3a' })
    isoBox(c, b.x + 3.0, b.y + 0.5, 0.6, 0.6, b.h, 20, { l: '#b5654a', r: '#8c4a35', t: '#5a4632', hi: '#d98a6f', lo: '#6a3a29', ltex: '#a35a41', rtex: '#7c4230' })
    windowOn(c, 'L', b, 6, 8, 9, 10, lit, 'plain', p)
    windowOn(c, 'L', b, 49, 8, 9, 10, lit, 'plain', p)
    doorOn(c, b, lit, true)
    windowOn(c, 'R', b, 10, 8, 9, 10, lit, 'plain', p)
    // Zahnrad an der rechten Wand
    const g = faceR(b, 32, b.h - 12)
    disc(c, '#5a4632', g.x, g.y, 6); disc(c, '#e8c47a', g.x, g.y, 4); disc(c, '#5a4632', g.x, g.y, 1)
    for (const [dx, dy] of [[0, -7], [0, 7], [-7, 0], [7, 0], [-5, -5], [5, 5], [-5, 5], [5, -5]]) R(c, '#5a4632', g.x + dx, g.y + dy, 1, 1)
  },
  terminal(c, b, lit) {
    const p = PAL.terminal
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    windowOn(c, 'L', b, 5, 8, 14, 12, lit, 'screen', p); windowOn(c, 'L', b, 45, 8, 14, 12, lit, 'screen', p)
    windowOn(c, 'R', b, 8, 10, 13, 14, lit, 'screen', p); windowOn(c, 'R', b, 28, 10, 13, 14, lit, 'screen', p)
    doorOn(c, b, lit, false)
    // Dach: Neon-Tafel mit ">_"
    isoBox(c, b.x + 0.5, b.y + 1.0, 3.0, 0.3, b.h, 17, { l: '#2c2620', r: '#1f1a16', t: '#3a3028', hi: '#5a4a3f' })
    const f = (u, v) => { const q = S2(b.x + 0.5, b.y + 1.3, b.h); return { x: q.x + u, y: q.y + (u >> 1) - v } }
    const neon = lit ? '#9bf0c0' : '#58b88a'
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (GLYPH['>'][r][k] === '1') for (let i = 0; i < 2; i++) { const q = f(12 + k * 2 + i, 14 - r * 2); R(c, neon, q.x, q.y, 1, 2) }
    for (let i = 0; i < 9; i++) { const q = f(24 + i, 5); R(c, neon, q.x, q.y, 1, 2) }
    const ant = S2(b.x + 3.2, b.y + 2.2, b.h)
    R(c, '#8a97a0', ant.x, ant.y - 12, 1, 12); R(c, '#8a97a0', ant.x - 3, ant.y - 9, 7, 1)
  },
  funkturm(c, b, lit) {
    const p = PAL.funkturm
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    windowOn(c, 'L', b, 6, 6, 10, 9, lit, 'plain', p); windowOn(c, 'L', b, 48, 6, 10, 9, lit, 'plain', p)
    windowOn(c, 'R', b, 12, 6, 10, 9, lit, 'plain', p); windowOn(c, 'R', b, 28, 6, 10, 9, lit, 'plain', p)
    doorOn(c, b, lit, false)
    isoBox(c, b.x + 0.2, b.y + 0.2, b.w - 0.4, b.d - 0.4, b.h, 2, { l: '#b7cad6', r: '#9db3c1', t: '#c9d9e3', hi: '#e6eef3', lo: '#7d95a5' })
    // Gittermast
    const m = S2(b.x + 2.2, b.y + 1.5, b.h + 2), top = { x: m.x, y: m.y - 60 }, metal = '#8a97a0', dk = '#5f6e78'
    for (let y = 0; y <= 60; y += 10) {
      const half = Math.round(8 - (y / 60) * 7)
      line(c, metal, m.x - half, m.y - y, m.x + half, m.y - y)
      if (y < 60) { const h2 = Math.round(8 - ((y + 10) / 60) * 7); line(c, dk, m.x - half, m.y - y, m.x + h2, m.y - y - 10); line(c, dk, m.x + half, m.y - y, m.x - h2, m.y - y - 10) }
    }
    line(c, dk, m.x - 8, m.y, top.x - 1, top.y); line(c, dk, m.x + 8, m.y, top.x + 1, top.y)
    // Schüssel auf halber Höhe
    ellipse(c, '#e8e0d0', m.x + 7, m.y - 30, 5, 5); ellipse(c, '#c9bba0', m.x + 8, m.y - 30, 3, 4); R(c, dk, m.x + 4, m.y - 31, 2, 2)
  },
  leitstand(c, b, lit) {
    const p = PAL.leitstand
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    windowOn(c, 'L', b, 5, 11, 16, 16, lit, 'plain', p); windowOn(c, 'L', b, 43, 11, 16, 16, lit, 'plain', p)
    windowOn(c, 'R', b, 7, 12, 14, 16, lit, 'plain', p); windowOn(c, 'R', b, 27, 12, 14, 16, lit, 'plain', p)
    doorOn(c, b, lit, true)
    isoBox(c, b.x + 0.15, b.y + 0.15, b.w - 0.3, b.d - 0.3, b.h, 3, { l: '#f0d594', r: '#d3b362', t: '#eed091', hi: '#fbf3e4', lo: '#a98a3a' })
    // Glaskuppel
    const m = S2(b.x + 1.6, b.y + 1.5, b.h + 3)
    for (let dy = 0; dy <= 14; dy++) { const w = Math.round(Math.sqrt(14 * 14 - dy * dy)); R(c, dy < 4 ? '#bfe0d4' : '#a8d2c6', m.x - w, m.y - dy, w * 2 + 1, 1) }
    for (let dy = 2; dy <= 12; dy++) R(c, '#e3f4ee', m.x - 8, m.y - dy, 2, 1)
    R(c, '#6f9a90', m.x - 14, m.y, 29, 1); R(c, '#6f9a90', m.x, m.y - 14, 1, 14); R(c, '#6f9a90', m.x - 7, m.y - 12, 1, 12); R(c, '#6f9a90', m.x + 7, m.y - 12, 1, 12)
    // Funkmast mit Radar (dreht sich dynamisch), Fahnenmast
    const q = S2(b.x + 3.3, b.y + 0.7, b.h + 3)
    R(c, '#6f5a40', q.x, q.y - 16, 1, 16)
    const fl = S2(b.x + 0.5, b.y + 2.5, b.h + 3)
    R(c, '#6f5a40', fl.x, fl.y - 24, 1, 24); disc(c, C.amber, fl.x, fl.y - 25, 1)
  },
  pausenraum(c, b, lit) {
    const p = PAL.pausenraum
    isoBox(c, b.x, b.y, b.w, b.d, 0, b.h, p)
    signPlate(c, b)
    windowOn(c, 'L', b, 6, 6, 11, 11, lit, 'warm', p); windowOn(c, 'L', b, 47, 6, 11, 11, lit, 'warm', p)
    windowOn(c, 'R', b, 9, 6, 11, 11, lit, 'warm', p); windowOn(c, 'R', b, 28, 6, 11, 11, lit, 'warm', p)
    doorOn(c, b, lit, false)
    // Blumenkästen
    for (const [u, f] of [[5, 'L'], [46, 'L']]) for (let i = 0; i < 13; i++) { wallRect(c, C.woodDk, f, b, u + i, 2, 1, 3); if (i % 2 === 0) wallRect(c, C.flowers[(i + u) % 4], f, b, u + i, 5, 1, 2) }
    // gestuftes Walmdach in Rosa
    const roof = (ins, z, hh, col) => isoBox(c, b.x - 0.2 + ins, b.y - 0.2 + ins, b.w + 0.4 - ins * 2, b.d + 0.4 - ins * 2, z, hh, col)
    roof(0, b.h, 4, { l: '#e08f78', r: '#c4735f', t: '#e6a58e', hi: '#f2c0ad', lo: '#a85a47', ltex: '#d98771', rtex: '#b86a56' })
    roof(0.6, b.h + 4, 4, { l: '#e49a82', r: '#c9795f', t: '#eab29a', hi: '#f5cdb9', lo: '#ad604d', ltex: '#dc8e77', rtex: '#bd6e59' })
    roof(1.2, b.h + 8, 4, { l: '#e8a58e', r: '#cf8068', t: '#efbfa9', hi: '#f8dccb', lo: '#b36853', ltex: '#e09882', rtex: '#c27560' })
    isoBox(c, b.x + 3.0, b.y + 0.8, 0.5, 0.5, b.h, 22, { l: '#d9b48a', r: '#b8956a', t: '#8a6744', hi: '#ecd0ad', lo: '#9d7a50', ltex: '#cfa97d', rtex: '#a98860' })
  },
}

// Bounds eines Gebaeude-Sprites (Welt-Pixel), grosszuegig inkl. Dachaufbauten
function spriteBounds(b) {
  const l = S2(b.x, b.y + b.d), r = S2(b.x + b.w, b.y), top = S2(b.x, b.y, b.h + 80), bot = S2(b.x + b.w, b.y + b.d)
  return { x: l.x - 6, y: top.y - 4, w: r.x - l.x + 14, h: bot.y - top.y + 14 }
}
const buildingSprites = {}
function buildSprites() {
  for (const b of L.BUILDINGS) {
    const bb = spriteBounds(b)
    buildingSprites[b.id] = { bb }
    for (const lit of [false, true]) {
      const [cv, cx] = mk(bb.w, bb.h)
      cx.translate(-bb.x, -bb.y)
      BUILD[b.id](cx, b, lit)
      buildingSprites[b.id][lit ? 'lit' : 'dark'] = cv
    }
  }
}

// ---------- Boden (einmal gezeichnet) ----------
const WORLD = { x: -232, y: -64, w: 512, h: 332 } // Sichtbereich der ganzen Stadt in Welt-Pixeln
let ground = null
const GB = { x: -232, y: -6, w: 512, h: 276 }
function buildGround() {
  const [cv, c] = mk(GB.w, GB.h)
  c.translate(-GB.x, -GB.y)
  const gw = L.GRID.w, gh = L.GRID.h
  // Inselrand (Erde) unter dem Rasen: zwei Seitenflaechen
  const Lp = S2(0, gh), Bp = S2(gw, gh), Rp = S2(gw, 0), TH = 14
  for (let i = 0; i < Bp.x - Lp.x; i++) {
    const y = Lp.y + (i >> 1)
    R(c, C.turf, Lp.x + i, y, 1, 3)
    for (let k = 3; k < TH; k++) R(c, k % 5 === 0 ? C.dirtDk : (hash(`${i >> 2}${k >> 1}`) % 9 === 0 ? C.dirtLt : C.dirt), Lp.x + i, y + k, 1, 1)
  }
  for (let i = 0; i < Rp.x - Bp.x; i++) {
    const y = Bp.y - (i >> 1)
    R(c, mix(C.turf, '#000000', 0.12), Bp.x + i, y, 1, 3)
    for (let k = 3; k < TH; k++) R(c, k % 5 === 0 ? mix(C.dirtDk, '#000000', 0.2) : mix(hash(`${i >> 2}${k >> 1}`) % 9 === 0 ? C.dirt : C.dirtDk, '#000000', 0.12), Bp.x + i, y + k, 1, 1)
  }
  // Kacheln
  for (let ty = 0; ty < gh; ty++) for (let tx = 0; tx < gw; tx++) {
    const p = S2(tx, ty)
    const road = L.isRoad(tx, ty)
    const base = road ? ((tx + ty) % 2 ? C.road : C.roadB) : ((tx + ty) % 2 ? C.grassA : C.grassB)
    for (let r = 0; r < 16; r++) {
      const hw = r < 8 ? (r + 1) * 2 : (16 - r) * 2
      R(c, base, p.x - hw, p.y + r, hw * 2, 1)
    }
    // Details: Gras-Bueschel/Blumen, Pflasterfugen
    for (let k = 0; k < 3; k++) {
      const h = hash(`${tx},${ty},${k}`)
      const rx = (h % 21) - 10, ry = ((h >> 5) % 11) + 2
      if (Math.abs(rx) > 14 - Math.abs(ry - 8) * 2 + 4) continue
      if (road) {
        if (h % 3 === 0) R(c, C.roadSeam, p.x + rx, p.y + ry, 2, 1)
      } else if (h % 4 === 0) { R(c, C.grassDk, p.x + rx, p.y + ry, 1, 2); R(c, C.grassDk, p.x + rx + 2, p.y + ry + 1, 1, 1) }
      else if (h % 17 === 0) { R(c, C.flowers[h % 4], p.x + rx, p.y + ry, 1, 1); R(c, C.green, p.x + rx, p.y + ry + 1, 1, 1) }
    }
    if (road) { // Bordstein: Kante dort, wo Gras anschliesst
      if (!L.isRoad(tx, ty + 1) && ty + 1 < gh) for (let i = 0; i < 16; i++) R(c, C.roadSeam, p.x - 16 + i * 1 + 0, p.y + 8 + (i >> 1), 1, 1)
      if (!L.isRoad(tx + 1, ty) && tx + 1 < gw) for (let i = 0; i < 16; i++) R(c, C.roadSeam, p.x + i, p.y + 15 - (i >> 1), 1, 1)
    }
  }
  // Schatten der Gebaeude (Licht kommt von links oben, Schatten faellt nach rechts unten)
  c.globalAlpha = 0.2
  for (const b of L.BUILDINGS) diamond(c, b.x + 0.5, b.y + 0.5, b.w + 0.9, b.d + 0.1, 0, INK)
  c.globalAlpha = 1
  ground = cv
}

// ---------- Deko-Sprites ----------
const propSprites = {}
function worldSprite(wb, draw) { // wb: Rahmen in Pixeln relativ zum Ankerpunkt (x,y,w,h); Anker = Fusspunkt
  const [cv, c] = mk(wb.w, wb.h)
  c.translate(-wb.x, -wb.y)
  draw(c)
  return { cv, ax: -wb.x, ay: -wb.y }
}
function shadow(c, cx, cy, rx) { c.globalAlpha = 0.22; ellipse(c, INK, cx, cy, rx, Math.max(2, rx >> 1)); c.globalAlpha = 1 }
function buildProps() {
  const crowns = [
    [C.green, C.greenLt, C.greenDk], ['#6f9a8a', '#92bba9', '#527a6c'], ['#d98a4c', '#ebac6e', '#b86a35'],
  ]
  propSprites.tree = crowns.map(([m, lt, dk]) => worldSprite({ x: -17, y: -44, w: 34, h: 50 }, (c) => {
    shadow(c, 0, 0, 10)
    R(c, C.woodDk, -2, -14, 4, 14); R(c, C.wood, -2, -14, 2, 14)
    disc(c, dk, 0, -28, 13); disc(c, dk, -9, -21, 8); disc(c, dk, 9, -21, 8)
    disc(c, m, -1, -30, 12); disc(c, m, -9, -23, 7); disc(c, m, 8, -22, 6)
    disc(c, lt, -4, -34, 7); disc(c, lt, -11, -25, 3)
    for (const [x, y] of [[3, -26], [-6, -18], [7, -30], [-2, -22]]) R(c, dk, x, y, 2, 1)
  }))
  propSprites.bush = worldSprite({ x: -9, y: -14, w: 18, h: 18 }, (c) => {
    shadow(c, 0, 0, 7); disc(c, C.greenDk, -3, -5, 5); disc(c, C.greenDk, 3, -5, 5); disc(c, C.green, -3, -6, 4); disc(c, C.green, 3, -6, 4); disc(c, C.greenLt, -4, -8, 2)
    R(c, C.flowers[0], 2, -7, 1, 1); R(c, C.flowers[1], -5, -5, 1, 1)
  })
  propSprites.lamp = worldSprite({ x: -8, y: -36, w: 16, h: 40 }, (c) => {
    shadow(c, 0, 0, 4); R(c, '#5a4632', -1, -26, 2, 26); R(c, '#5a4632', -3, -2, 6, 2)
    R(c, '#5a4632', -4, -31, 8, 1); R(c, '#f2d27a', -3, -30, 6, 5); R(c, '#fff0b8', -2, -29, 2, 3); R(c, '#5a4632', -4, -25, 8, 1); R(c, '#5a4632', -2, -33, 4, 2)
  })
  propSprites.fountain = worldSprite({ x: -44, y: -44, w: 88, h: 70 }, (c) => {
    const g = { x: 8.5, y: 6.5 }
    c.translate(-S2(g.x, g.y).x, -S2(g.x, g.y).y)
    shadow(c, S2(g.x, g.y).x + 10, S2(g.x, g.y).y + 6, 26)
    isoBox(c, g.x - 1.3, g.y - 1.3, 2.6, 2.6, 0, 6, { l: C.stone, r: C.stoneDk, t: C.stoneLt, hi: '#f2e9d4', lo: '#8f8266', ltex: '#bdb094', rtex: '#9b8e74' })
    diamond(c, g.x - 1.05, g.y - 1.05, 2.1, 2.1, 6, C.water, C.waterLt)
    isoBox(c, g.x - 0.22, g.y - 0.22, 0.44, 0.44, 6, 12, { l: C.stone, r: C.stoneDk, t: C.stoneLt, hi: '#f2e9d4' })
    isoBox(c, g.x - 0.6, g.y - 0.6, 1.2, 1.2, 15, 3, { l: C.stone, r: C.stoneDk, t: C.waterLt, hi: '#f2e9d4' })
  })
  propSprites.bench = worldSprite({ x: -22, y: -22, w: 44, h: 34 }, (c) => {
    const g = S2(0, 0); c.translate(-g.x, -g.y)
    const wd = { l: C.wood, r: C.woodDk, t: C.woodLt, hi: '#d6b184' }
    isoBox(c, -0.6, -0.1, 0.1, 0.2, 0, 4, wd); isoBox(c, 0.5, -0.1, 0.1, 0.2, 0, 4, wd)
    isoBox(c, -0.65, -0.12, 1.3, 0.34, 4, 2, wd); isoBox(c, -0.65, -0.14, 1.3, 0.1, 6, 6, wd)
  })
  propSprites.crates = worldSprite({ x: -26, y: -34, w: 52, h: 44 }, (c) => {
    const g = S2(0, 0); c.translate(-g.x, -g.y)
    shadow(c, 8, 4, 16)
    const cr = { l: '#c39b6c', r: '#a47c4f', t: '#d6b184', hi: '#e8cba3', lo: '#8a6744', ltex: '#b48a5c', rtex: '#946c43' }
    isoBox(c, 0, 0, 0.8, 0.8, 0, 9, cr); isoBox(c, 0.8, 0.1, 0.7, 0.7, 0, 7, cr); isoBox(c, 0.1, 0.05, 0.6, 0.6, 9, 7, cr)
  })
  propSprites.books = worldSprite({ x: -26, y: -26, w: 52, h: 36 }, (c) => {
    const g = S2(0, 0); c.translate(-g.x, -g.y)
    shadow(c, 8, 4, 14)
    isoBox(c, 0, 0, 1.1, 0.55, 0, 7, { l: C.wood, r: C.woodDk, t: C.woodLt, hi: '#d6b184' })
    for (let i = 0; i < 14; i++) { const p = faceL({ x: 0, y: 0, w: 1.1, d: 0.55 }, 2 + i, 8); R(c, SPINES[i % 7], p.x, p.y - 3, 1, 3 + (i % 2)) }
  })
  propSprites.flowers = worldSprite({ x: -16, y: -14, w: 32, h: 22 }, (c) => {
    const g = S2(0, 0); c.translate(-g.x, -g.y)
    isoBox(c, -0.5, -0.3, 1, 0.6, 0, 2, { l: C.wood, r: C.woodDk, t: '#7d5e3f', hi: '#a98259' })
    for (let i = 0; i < 9; i++) { const x = ((i * 7) % 15) - 7, y = -3 - ((i * 5) % 5); R(c, C.green, x, y + 1, 1, 2); R(c, C.flowers[i % 4], x, y, 2, 2) }
  })
  propSprites.desk = (col) => worldSprite({ x: -20, y: -20, w: 40, h: 30 }, (c) => {
    const g = S2(0, 0); c.translate(-g.x, -g.y)
    const wd = { l: C.woodLt, r: C.wood, t: '#d6b184', hi: '#ebcfa6', lo: C.woodDk }
    isoBox(c, -0.55, -0.22, 1.1, 0.44, 0, 6, wd)
    isoBox(c, -0.2, -0.12, 0.4, 0.28, 6, 1, { l: '#8a97a0', r: '#6f7d86', t: '#a8b4bb' })
    isoBox(c, -0.2, -0.16, 0.4, 0.06, 7, 6, { l: mix(col, '#000000', 0.15), r: mix(col, '#000000', 0.3), t: col, hi: mix(col, '#ffffff', 0.4) })
  })
}

// ---------- Figuren ----------
const HAIR = ['#3a2c20', '#6b4a2f', '#a9825a', '#2f2a3a', '#8a3f2f']
// o: col, hair, front (Gesicht sichtbar), side (-1 links, 1 rechts), step (0/1), arms, lead, sit, accent
function body(c, x, y, o, mono) {
  const F = (col, rx, ry, w, h) => { c.fillStyle = mono || col; c.fillRect(x + rx, y + ry, w, h) }
  const skin = PX.skin, pants = '#5a4632', sh = o.sit ? 3 : 0
  // Beine
  if (o.sit) { F(pants, -3, -4 + 1, 6, 2); F(pants, -3, -2 + 1, 2, 2); F(pants, 1, -2 + 1, 2, 2) }
  else if (o.step === 1) { F(pants, -2, -3, 2, 2); F(pants, 0, -3, 2, 3); F('#3a2c20', 0, -1, 2, 1) }
  else if (o.step === 2) { F(pants, -2, -3, 2, 3); F(pants, 0, -3, 2, 2); F('#3a2c20', -2, -1, 2, 1) }
  else { F(pants, -2, -3, 2, 3); F(pants, 0, -3, 2, 3); F('#3a2c20', -2, -1, 4, 1) }
  // Koerper
  F(o.col, -3, -8 + sh, 6, 5 - (o.sit ? 1 : 0)); F(mix(o.col, '#ffffff', 0.3), -3, -8 + sh, 6, 1)
  if (o.front) F(mix(o.col, '#000000', 0.2), o.side > 0 ? 0 : -2, -5 + sh, 2, 1)
  // Arme
  const A = o.arms
  const armY = -8 + sh
  if (A === 'up') { F(o.col, -4, -15 + sh, 1, 7); F(o.col, 3, -15 + sh, 1, 7); F(skin, -4, -16 + sh, 1, 1); F(skin, 3, -16 + sh, 1, 1) }
  else if (A === 'wave') { F(o.col, -4, armY, 1, 4); F(skin, -4, armY + 4, 1, 1); F(o.col, 3, -14 + sh, 1, 6); F(skin, o.t ? 4 : 3, -15 + sh, 1, 1) }
  else if (A === 'work') { F(o.col, -4, armY, 1, 3); F(o.col, 3, armY + (o.t ? 0 : 1), 1, 3); F(skin, -4, armY + 3, 1, 1); F(skin, 3, armY + (o.t ? 3 : 4), 1, 1) }
  else if (A === 'hold') { F(o.col, -4, armY, 1, 3); F(o.col, 3, armY, 1, 3); F(skin, -3, armY + 3, 1, 1); F(skin, 2, armY + 3, 1, 1) }
  else { F(o.col, -4, armY, 1, 4); F(o.col, 3, armY, 1, 4); F(skin, -4, armY + 4, 1, 1); F(skin, 3, armY + 4, 1, 1) }
  // Kopf
  F(skin, -3, -13 + sh, 6, 5); F(mix(skin, '#000000', 0.12), o.side > 0 ? -3 : 2, -10 + sh, 1, 2)
  if (o.front) {
    F(o.hair, -3, -14 + sh, 6, 2); F(o.hair, o.side > 0 ? -3 : 2, -12 + sh, 1, 2)
    F(INK, o.side > 0 ? -1 : -2, -11 + sh, 1, 1); F(INK, o.side > 0 ? 2 : 1, -11 + sh, 1, 1)
    F('#e0a48a', o.side > 0 ? 0 : -1, -9 + sh, 2, 1)
  } else { F(o.hair, -3, -14 + sh, 6, 5); F(mix(o.hair, '#ffffff', 0.18), -2, -14 + sh, 2, 1) }
  if (o.lead) { // Headset und Antenne in der Farbe der Session
    F(INK, -4, -12 + sh, 1, 3); F(INK, 3, -12 + sh, 1, 3); F(INK, o.side > 0 ? 3 : -4, -9 + sh, 2, 1)
    F(o.col, 0, -17 + sh, 1, 2); F(o.accent || o.col, -1, -19 + sh, 3, 2)
  }
}
function drawFigure(c, f, x, y, time, alpha) {
  const o = f.o
  if (alpha < 1) c.globalAlpha = alpha
  shadow(c, x, y, 5)
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) body(c, x + dx, y + dy, o, INK)
  body(c, x, y, o, null)
  c.globalAlpha = 1
}

// Schild: Mast ueber dem Kopf, grosse amber Tafel mit "?"
function drawSign(c, x, y, time) {
  const sway = reduce ? 0 : Math.round(Math.sin(time * 4.2))
  const pulse = reduce ? 0 : (Math.floor(time * 2.2) % 2)
  const top = y - 48
  R(c, INK, x - 1 + sway, top + 12, 3, 20); R(c, '#7d5e3f', x + sway, top + 12, 1, 20)
  R(c, INK, x - 12 + sway, top - 1, 25, 17); R(c, pulse ? '#ffe39a' : C.amber, x - 11 + sway, top, 23, 15)
  R(c, pulse ? C.amber : '#f08a2e', x - 11 + sway, top + 13, 23, 2)
  R(c, '#fff3cf', x - 11 + sway, top, 23, 1)
  glyph(c, INK, '?', x - 3 + sway, top + 2, 2)
}

// ---------- Zustand der Stadt ----------
const figs = new Map()
const puffs = []
const cam = { x: 0, y: 0 }
let S = 3, dpr = 1, cw = 800, ch = 600, bw = 266, bh = 200
let hover = null, selected = null, pan = 0, panMax = 0

function poof(gx, gy, col, big) {
  if (reduce) return
  puffs.push({ gx, gy, col, t0: performance.now(), big })
  if (puffs.length > 40) puffs.shift()
}

function targets(wall) {
  const shown = AB.leadsShown()
  const list = []
  shown.forEach((lid, i) => {
    const Ld = AB.lead(lid)
    const working = Ld.station && Ld.state === 'active' && wall - Ld.last < 3500 && Ld.station.id !== 'leitstand'
    list.push({ key: lid, lead: true, name: Ld.name, col: AB.leadColor(lid), accent: AB.leadColor(lid), home: L.homePos(i, shown.length), bid: working ? Ld.station.id : null,
      state: Ld.state, born: Ld.born || 0, parent: null, mode: working ? 'work' : 'desk', what: Ld.what || '', src: Ld.src, idx: i })
  })
  for (const a of AB.S.agents.values()) {
    let bid = null, mode = 'idle'
    if (a.state === 'done') { bid = 'pausenraum'; mode = 'done' }
    else if (a.st && (a.state === 'active' || a.state === 'error')) { bid = a.st.id; mode = 'work' }
    list.push({ key: a.id, lead: false, name: a.name, col: a.color, accent: null, bid, state: a.state, born: a.born || 0,
      parent: shown.includes(a.lead) ? a.lead : shown[0], mode, what: a.what || '', role: a.role, task: a.task })
  }
  // Plaetze: je Gebaeude nach Eintreffen sortiert, im Leerlauf je Hauptfigur
  const byB = new Map(), byP = new Map()
  for (const t of list) {
    if (t.lead && !t.bid) continue
    if (t.bid) { if (!byB.has(t.bid)) byB.set(t.bid, []); byB.get(t.bid).push(t) }
    else { if (!byP.has(t.parent)) byP.set(t.parent, []); byP.get(t.parent).push(t) }
  }
  const sortF = (a, b) => a.born - b.born || (a.key < b.key ? -1 : 1)
  for (const [bid, arr] of byB) arr.sort(sortF).forEach((t, i) => { t.dest = L.slotPos(L.buildingById(bid), i); t.destKey = `${bid}:${i}` })
  for (const [pid, arr] of byP) {
    const home = list.find((t) => t.key === pid)
    arr.sort(sortF).forEach((t, i) => { t.dest = L.idlePos(home ? home.home.gx : 8, i); t.destKey = `idle:${pid}:${i}` })
  }
  for (const t of list) if (t.lead && !t.bid) { t.dest = t.home; t.destKey = `home:${t.idx}:${list.length}` }
  return list
}

function sync(dt, wall) {
  const list = targets(wall)
  const waits = new Map((AB.waiting ? AB.waiting() : []).map((w) => [w.id, w]))
  const seen = new Set()
  for (const t of list) {
    seen.add(t.key)
    let f = figs.get(t.key)
    if (!f) {
      const par = t.parent ? figs.get(t.parent) : null
      const start = par ? { gx: par.gx, gy: par.gy } : t.dest
      f = { key: t.key, gx: start.gx, gy: start.gy, path: [], face: 'dr', destKey: '', moving: false, born: t.born, t0: performance.now(), step: 0, o: {} }
      figs.set(t.key, f)
      if (t.parent) poof(start.gx, start.gy, t.col, false)
    }
    Object.assign(f, { lead: t.lead, name: t.name, mode: t.mode, state: t.state, what: t.what, role: t.role, task: t.task, bid: t.bid, col: t.col })
    if (f.destKey !== t.destKey) {
      f.destKey = t.destKey; f.dest = t.dest
      if (reduce) { f.gx = t.dest.gx; f.gy = t.dest.gy; f.path = [] }
      else f.path = L.routeTo({ gx: f.gx, gy: f.gy }, t.dest)
    }
    f.moving = reduce ? false : L.stepAlong(f, dt, t.lead ? 2.9 : 3.5)
    if (f.moving) f.step = (f.step + dt * 9) % 2
    const w = waits.get(t.key)
    f.wait = w ? w.kind : null
    // Pose
    let pose = 'idle'
    if (f.wait === 'perm' || f.wait === 'input') pose = 'sign'
    else if (f.state === 'error' && !t.lead) pose = 'error'
    else if (f.moving) pose = 'walk'
    else if (f.wait === 'idle') pose = 'wave'
    else if (t.mode === 'done') pose = 'sit'
    else if (t.mode === 'work' && t.bid) pose = 'work'
    else if (t.lead && t.state === 'active') pose = 'type'
    f.pose = pose
  }
  for (const [k, f] of figs) if (!seen.has(k)) { poof(f.gx, f.gy, f.col, true); figs.delete(k); if (selected === k) selected = null }
}

// Figur-Parameter fuer body() aus Pose, Blickrichtung und Zeit
function figureOpts(f, time) {
  const tk = reduce ? 0 : Math.floor(time * 4)
  const face = f.face
  const front = face[0] === 'd', side = face[1] === 'r' ? 1 : -1
  let arms = 'down', stepFrame = 0, sit = false, tflag = tk % 2 === 0
  let fr = front
  switch (f.pose) {
    case 'walk': stepFrame = f.step < 1 ? 1 : 2; arms = 'down'; break
    case 'sign': arms = 'up'; fr = true; break
    case 'wave': arms = 'wave'; fr = true; break
    case 'error': arms = 'up'; fr = true; break
    case 'sit': sit = true; fr = true; break
    case 'work': arms = (f.bid === 'archiv' || f.bid === 'funkturm') ? 'hold' : 'work'; fr = true; break
    case 'type': arms = 'work'; fr = true; break
    default: if (!f.lead && !reduce && (hash(f.key) + Math.floor(time / 3)) % 5 === 0) fr = true
  }
  const hair = HAIR[hash(f.key) % HAIR.length]
  return { col: f.col, hair, front: fr, side, step: stepFrame, arms, sit, lead: f.lead, accent: f.lead ? (tk % 6 < 3 ? '#fbf3e4' : f.col) : null, t: tflag }
}

// Werkzeug-Effekte vor/ueber der Figur je Gebaeude (kleine Pixel-Animationen)
function workFx(c, f, x, y, time) {
  if (reduce) { // ohne Bewegung: nur ein ruhiges Requisit
    if (f.bid === 'archiv') { R(c, INK, x - 4, y - 8, 8, 5); R(c, PX.paper, x - 3, y - 7, 6, 3); R(c, '#c9b791', x, y - 7, 1, 3) }
    return
  }
  const tk = Math.floor(time * 6)
  switch (f.bid) {
    case 'archiv': R(c, INK, x - 4, y - 9, 8, 5); R(c, PX.paper, x - 3, y - 8, 6, 3); R(c, '#c9b791', x, y - 8, 1, 3); if (tk % 8 < 2) R(c, PX.paper, x + 1, y - 10, 3, 2); break
    case 'werkstatt': {
      const up = tk % 2 === 0
      R(c, INK, x + 4, up ? y - 16 : y - 11, 2, 5); R(c, '#8a97a0', x + 3, up ? y - 17 : y - 12, 4, 2)
      if (!up) { R(c, '#ffd27a', x + 6, y - 8, 1, 1); R(c, '#ffd27a', x + 8, y - 10, 1, 1); R(c, '#fbf3e4', x + 7, y - 6, 1, 1) }
      break
    }
    case 'terminal': for (let i = 0; i < 4; i++) { const p = ((time * 0.9 + i * 0.25) % 1); R(c, '#58b88a', x - 8 + i * 5, Math.round(y - 14 - p * 14), 1, 2); if (i % 2) R(c, '#9bf0c0', x - 7 + i * 5, Math.round(y - 15 - p * 14), 1, 1) } break
    case 'funkturm': {
      R(c, INK, x + 4, y - 17, 1, 10); R(c, C.amber, x + 4, y - 18, 1, 1)
      for (let i = 0; i < 2; i++) { const p = (time * 0.8 + i * 0.5) % 1; ring(c, `rgba(150,73,31,${(1 - p).toFixed(2)})`, x + 4, y - 18, 3 + p * 7, 3 + p * 7, -1.2, 1.2) }
      break
    }
    default: R(c, INK, x - 7, y - 9, 4, 5); R(c, PX.paper, x - 6, y - 8, 2, 3)
  }
}

// ---------- Rendern ----------
let bx = null, bcv = null
const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d
let font = '600 12px system-ui'
const view = { canvas: null, ctx: null }

function layout() {
  const r = stage.getBoundingClientRect()
  cw = Math.max(1, Math.round(r.width)); ch = Math.max(1, Math.round(r.height))
  dpr = Math.min(window.devicePixelRatio || 1, 3)
  const dw = Math.round(cw * dpr), dh = Math.round(ch * dpr)
  view.canvas.width = dw; view.canvas.height = dh
  // groesster ganzzahliger Massstab, bei dem die ganze Stadt aufs Bild passt (mindestens 1)
  S = Math.max(1, Math.floor(Math.min(dw / WORLD.w, dh / WORLD.h)))
  // Handy: lieber eine Stufe groesser (Figuren bleiben lesbar) und die Stadt seitlich verschieben, solange sie hoechstens ein Drittel ueberlaeuft
  if (cw < 700 && dpr >= 2 && (S + 1) * WORLD.w <= dw * 1.4 && (S + 1) * WORLD.h <= dh) S += 1
  bw = Math.ceil(dw / S); bh = Math.ceil(dh / S)
  panMax = Math.max(0, Math.round((WORLD.w - bw) / 2) + 4)
  pan = Math.max(-panMax, Math.min(panMax, pan))
  bcv.width = bw; bcv.height = bh
  bx = bcv.getContext('2d'); bx.imageSmoothingEnabled = false
  cam.x = Math.round((bw - WORLD.w) / 2 - WORLD.x) - pan
  cam.y = Math.round((bh - WORLD.h) / 2 - WORLD.y)
  const fs = cw < 560 ? 11 : 12.5
  font = `600 ${fs}px ${cssVar('--display', 'system-ui')}`
}
const k = () => S / dpr // CSS-Pixel je Kunst-Pixel
const toCss = (wx, wy) => ({ x: (wx + cam.x) * k(), y: (wy + cam.y) * k() })

function isOccluded(f) {
  if (f.wait && f.wait !== 'idle') return false
  const p = S2(f.gx, f.gy)
  for (const b of L.BUILDINGS) {
    if (L.inFront(f, b)) continue
    const bb = buildingSprites[b.id].bb
    const l = S2(b.x, b.y + b.d), r = S2(b.x + b.w, b.y), bot = S2(b.x + b.w, b.y + b.d)
    if (p.x >= l.x && p.x <= r.x && p.y - 14 <= bot.y && p.y >= S2(b.x, b.y, b.h).y - 8 && bb) return true
  }
  return false
}

function render(now, time, mood) {
  const wall = Date.now()
  bx.setTransform(1, 0, 0, 1, 0, 0)
  bx.clearRect(0, 0, bw, bh)
  bx.drawImage(ground, cam.x + GB.x, cam.y + GB.y)
  bx.translate(cam.x, cam.y)

  // Belegung je Gebaeude
  const occ = {}
  for (const f of figs.values()) if (f.bid && !f.moving) occ[f.bid] = (occ[f.bid] || 0) + 1
  for (const f of figs.values()) if (f.bid && f.moving) occ[f.bid] = (occ[f.bid] || 0) // Ankommende zaehlen noch nicht
  // Licht vor den Tueren belegter Gebaeude (nur auf dem Boden, unter allem)
  for (const b of L.BUILDINGS) {
    if (!occ[b.id]) continue
    const p = S2(b.x + b.w / 2, b.y + b.d + 0.9)
    const pulse = reduce ? 1 : 0.85 + 0.15 * Math.sin(time * 2 + b.x)
    bx.globalAlpha = 0.16 * pulse; ellipse(bx, '#ffd27a', p.x, p.y, 40, 14); bx.globalAlpha = 0.16 * pulse; ellipse(bx, '#ffe9b0', p.x, p.y, 24, 8); bx.globalAlpha = 1
  }

  // Zeichenliste mit Tiefensortierung
  const items = []
  for (const b of L.BUILDINGS) items.push({ kind: 'b', ref: b, gx: b.x + b.w / 2, gy: b.y + b.d / 2, depth: b.x + b.w / 2 + b.y + b.d / 2 })
  for (const p of L.PROPS) items.push({ kind: 'p', ref: p, gx: p.gx, gy: p.gy, depth: p.gx + p.gy })
  const shown = AB.leadsShown()
  shown.forEach((lid, i) => { const h = L.homePos(i, shown.length); items.push({ kind: 'd', ref: lid, gx: h.gx, gy: h.gy + 0.55, depth: h.gx + h.gy + 0.55 }) })
  const top = []
  for (const f of figs.values()) {
    f.o = figureOpts(f, time)
    if (f.wait === 'perm' || f.wait === 'input' || (f.state === 'error' && !f.lead)) { top.push(f); items.push({ kind: 'f', ref: f, gx: f.gx, gy: f.gy, depth: f.gx + f.gy, top: true }); continue }
    items.push({ kind: 'f', ref: f, gx: f.gx, gy: f.gy, depth: f.gx + f.gy })
  }
  items.sort((a, b) => {
    if (a.kind === 'b' && b.kind !== 'b') return L.inFront(b, a.ref) ? -1 : 1
    if (b.kind === 'b' && a.kind !== 'b') return L.inFront(a, b.ref) ? 1 : -1
    return a.depth - b.depth
  })

  const ghosts = []
  for (const it of items) {
    if (it.kind === 'b') drawBuilding(it.ref, occ[it.ref.id] > 0, time, shown)
    else if (it.kind === 'p') drawProp(it.ref, time)
    else if (it.kind === 'd') drawDesk(it.ref, time)
    else {
      const f = it.ref, p = S2(f.gx, f.gy)
      drawFigureFull(bx, f, p.x, p.y, time)
      if (!it.top && isOccluded(f)) ghosts.push(f)
    }
  }
  // Figuren hinter Gebaeuden: als Schemen darueber, damit niemand verschwindet
  for (const f of ghosts) { const p = S2(f.gx, f.gy); drawFigure(bx, f, p.x, p.y, time, 0.38) }
  // Puffs (Spawn/Abgang)
  for (let i = puffs.length - 1; i >= 0; i--) {
    const q = puffs[i], age = (performance.now() - q.t0) / 520
    if (age >= 1) { puffs.splice(i, 1); continue }
    const p = S2(q.gx, q.gy, 6), r = 3 + age * (q.big ? 9 : 7)
    for (let a = 0; a < 8; a++) { const an = (a / 8) * Math.PI * 2; R(bx, a % 2 ? q.col : '#fbf3e4', Math.round(p.x + Math.cos(an) * r), Math.round(p.y + Math.sin(an) * r * 0.6 - age * 4), age < 0.6 ? 2 : 1, age < 0.6 ? 2 : 1) }
  }
  bx.setTransform(1, 0, 0, 1, 0, 0)

  // Tageszeit: Nacht dunkelt ab, Abend/Morgen faerben; Lichter danach (warmes Leuchten bleibt sichtbar)
  if (mood) {
    bx.globalCompositeOperation = 'source-atop' // nur die gezeichnete Stadt toenen, nicht den Hintergrund der Buehne
    if (mood.night > 0.02) { bx.fillStyle = `rgba(29,33,64,${(0.4 * mood.night).toFixed(3)})`; bx.fillRect(0, 0, bw, bh) }
    if (mood.gold > 0.02) { bx.fillStyle = `rgba(255,160,70,${(0.12 * mood.gold).toFixed(3)})`; bx.fillRect(0, 0, bw, bh) }
    if (mood.pink > 0.02) { bx.fillStyle = `rgba(255,170,200,${(0.1 * mood.pink).toFixed(3)})`; bx.fillRect(0, 0, bw, bh) }
    bx.globalCompositeOperation = 'source-over'
    if (mood.light > 0.25) {
      bx.translate(cam.x, cam.y)
      for (const p of L.PROPS) if (p.type === 'lamp') { const s = S2(p.gx, p.gy); bx.globalAlpha = 0.28 * mood.light; ellipse(bx, '#ffd27a', s.x, s.y - 26, 16, 12); bx.globalAlpha = 0.2 * mood.light; ellipse(bx, '#ffd27a', s.x, s.y, 22, 9); bx.globalAlpha = 1 }
      bx.setTransform(1, 0, 0, 1, 0, 0)
    }
  }

  // Hochskalieren, ohne zu glaetten, dann scharfe Beschriftungen
  const c = view.ctx
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.imageSmoothingEnabled = false
  c.clearRect(0, 0, view.canvas.width, view.canvas.height)
  c.drawImage(bcv, 0, 0, bw * S, bh * S)
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawLabels(c, occ, time, wall)
}

function drawBuilding(b, lit, time, shown) {
  const sp = buildingSprites[b.id]
  bx.drawImage(lit ? sp.lit : sp.dark, sp.bb.x, sp.bb.y)
  // dynamische Teile
  const t = time
  switch (b.id) {
    case 'werkstatt': case 'pausenraum': {
      const s0 = S2(b.x + (b.id === 'werkstatt' ? 3.3 : 3.25), b.y + (b.id === 'werkstatt' ? 0.8 : 1.05), b.h + (b.id === 'werkstatt' ? 20 : 22))
      if (reduce) { R(bx, '#fbf3e4', s0.x - 1, s0.y - 5, 4, 3); break }
      const n = lit ? 5 : 3
      for (let i = 0; i < n; i++) {
        const p = (t * 0.35 + i / n) % 1
        bx.globalAlpha = (1 - p) * 0.85
        disc(bx, '#fbf3e4', Math.round(s0.x + Math.sin(t + i * 2) * 3 + p * 8), Math.round(s0.y - p * 26), 2 + Math.round(p * 3))
      }
      bx.globalAlpha = 1
      if (b.id === 'pausenraum' && lit) for (let i = 0; i < 3; i++) { const p = (t * 0.4 + i / 3) % 1; bx.globalAlpha = 1 - p; glyph(bx, INK, 'Z', S2(b.x + 1.4, b.y + b.d).x + Math.round(p * 6) + i * 3, Math.round(S2(b.x + 1.4, b.y + b.d, b.h + 18).y - p * 14), 1 + (i > 0 ? 0 : 1)); bx.globalAlpha = 1 }
      break
    }
    case 'terminal': {
      if (lit && !reduce) { // Scanlinie ueber dem Dach-Schild
        const q = S2(b.x + 3.2, b.y + 2.2, b.h), on = Math.floor(t * 2) % 2
        R(bx, on ? C.amber : '#7fe0a8', q.x - 1, q.y - 13, 3, 2)
      }
      break
    }
    case 'funkturm': {
      const m = S2(b.x + 2.2, b.y + 1.5, b.h + 62)
      const on = reduce ? 1 : Math.floor(t * 1.6) % 2
      disc(bx, on ? '#ff6a4f' : '#8c3a2c', m.x, m.y, 2)
      if (lit && !reduce) for (let i = 0; i < 3; i++) { const p = (t * 0.7 + i / 3) % 1; ring(bx, `rgba(196,80,60,${(1 - p).toFixed(2)})`, m.x, m.y, 4 + p * 16, 3 + p * 12, -Math.PI * 0.95, -Math.PI * 0.05) }
      else if (lit) ring(bx, 'rgba(196,80,60,0.7)', m.x, m.y, 8, 6, -Math.PI * 0.95, -Math.PI * 0.05)
      break
    }
    case 'leitstand': {
      const q = S2(b.x + 3.3, b.y + 0.7, b.h + 19)
      const a = reduce ? 0.6 : t * 1.4
      line(bx, '#6f5a40', q.x - Math.round(Math.cos(a) * 6), q.y - Math.round(Math.sin(a) * 3), q.x + Math.round(Math.cos(a) * 6), q.y + Math.round(Math.sin(a) * 3))
      disc(bx, C.red, q.x, q.y - 1, 1)
      // Fahnen: eine je sichtbarer Hauptfigur, in deren Farbe
      const fl = S2(b.x + 0.5, b.y + 2.5, b.h + 27)
      shown.forEach((lid, i) => {
        const col = AB.leadColor(lid)
        for (let x = 0; x < 9; x++) { const w = reduce ? 0 : Math.round(Math.sin(t * 5 - x * 0.7 + i) * 1.2); R(bx, col, fl.x + 1 + x, fl.y + i * 4 + w, 1, 3); if (x === 0) R(bx, mix(col, '#ffffff', 0.3), fl.x + 1, fl.y + i * 4, 9, 1) }
      })
      break
    }
  }
}

function drawProp(p, time) {
  const s = S2(p.gx, p.gy)
  let sp = null
  if (p.type === 'tree') sp = propSprites.tree[p.v % 3]
  else sp = propSprites[p.type]
  if (!sp) return
  let sway = 0
  if (p.type === 'tree' && !reduce) sway = Math.round(Math.sin(time * 0.9 + p.gx) * 0.6)
  bx.drawImage(sp.cv, s.x - sp.ax + sway * 0, s.y - sp.ay)
  if (p.type === 'fountain') {
    const base = S2(p.gx, p.gy, 22)
    if (reduce) { R(bx, C.waterLt, base.x, base.y - 6, 1, 6); return }
    for (let i = 0; i < 6; i++) {
      const ph = (time * 0.9 + i / 6) % 1, a = (i / 6) * Math.PI * 2
      const r = ph * 12, y = -Math.sin(ph * Math.PI) * 12 + ph * 8
      R(bx, ph < 0.5 ? C.waterLt : C.water, Math.round(base.x + Math.cos(a) * r), Math.round(base.y + Math.sin(a) * r * 0.5 + y - 4), 1, 2)
    }
    R(bx, C.waterLt, base.x, base.y - 5, 1, 5 + Math.round(Math.sin(time * 6) * 1))
  }
}

function drawDesk(lid, time) {
  const shown = AB.leadsShown(), i = shown.indexOf(lid)
  if (i < 0) return
  const h = L.homePos(i, shown.length), s = S2(h.gx, h.gy + 0.55)
  const col = AB.leadColor(lid)
  const key = 'desk' + col
  if (!propSprites[key]) propSprites[key] = propSprites.desk(col)
  const sp = propSprites[key]
  bx.drawImage(sp.cv, s.x - sp.ax, s.y - sp.ay)
  const Ld = AB.lead(lid)
  if (Ld.state === 'active') { // Bildschirm leuchtet, solange die Session arbeitet
    const sc = S2(h.gx, h.gy + 0.55 - 0.1, 8)
    R(bx, '#bfe0d4', sc.x - 3, sc.y - 4, 7, 3)
    if (!reduce && Math.floor(time * 3) % 2) R(bx, '#fbf3e4', sc.x - 2 + (Math.floor(time * 6) % 5), sc.y - 3, 1, 1)
  }
}

function drawFigureFull(c, f, x, y, time) {
  drawFigure(c, f, x, y, time, 1)
  if (f.pose === 'work') workFx(c, f, x, y, time)
  if (f.pose === 'sign') {
    drawSign(c, x, y, time)
    // Bodenring: pulsierender amberfarbener Leuchtkreis, damit man ihn von weitem sieht
    const p = reduce ? 0.5 : (time * 0.9) % 1
    ring(c, `rgba(255,190,74,${(1 - p * 0.8).toFixed(2)})`, x, y, 8 + p * 22, 4 + p * 11)
    ring(c, 'rgba(255,190,74,0.5)', x, y, 9, 4.5)
  }
  if (f.pose === 'error') {
    const j = reduce ? 0 : Math.round(Math.sin(time * 30))
    R(c, INK, x - 1 + j, y - 26, 3, 7); R(c, C.red, x + j, y - 25, 1, 5); R(c, INK, x - 1 + j, y - 18, 3, 3); R(c, C.red, x + j, y - 17, 1, 1)
    ring(c, 'rgba(196,80,60,0.8)', x, y, 9, 4.5)
  }
  if (f.pose === 'sit' && !reduce) { const p = (time * 0.5 + (hash(f.key) % 10) / 10) % 1; c.globalAlpha = 1 - p; glyph(c, '#6f5a40', 'Z', x + 5 + Math.round(p * 4), Math.round(y - 14 - p * 8), 1); c.globalAlpha = 1 }
}

// ---------- Beschriftungen (scharf) ----------
function pill(c, text, cx, cy, o = {}) {
  c.font = o.font || font
  const w = Math.ceil(c.measureText(text).width) + 14, h = o.h || 22
  const x = Math.round(Math.max(4, Math.min(cw - w - 4, cx - w / 2))), y = Math.round(Math.max(4, Math.min(ch - h - 4, cy - h / 2)))
  c.fillStyle = o.bg || 'rgba(251,243,228,0.94)'
  roundRect(c, x, y, w, h, 7); c.fill()
  c.lineWidth = o.bw || 1; c.strokeStyle = o.border || cssVar('--line', '#ddc9a3'); roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, 7); c.stroke()
  c.fillStyle = o.color || cssVar('--ink', '#3a2c20'); c.textBaseline = 'middle'; c.textAlign = 'center'
  c.fillText(text, x + w / 2, y + h / 2 + 0.5)
  return { x, y, w, h }
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}
const roomName = (id) => T('room.' + id)
function figHead(f) { const p = S2(f.gx, f.gy); return toCss(p.x, p.y - (f.lead ? 22 : 15)) }

function drawLabels(c, occ, time, wall) {
  const amber = cssVar('--amber', '#96491f'), coral = cssVar('--coral', '#9c3f30')
  const placed = [] // belegte Rechtecke, damit sich Beschriftungen nicht ueberdecken
  for (const f of figs.values()) if (f.pose === 'sign') { const h = figHead(f); placed.push({ x: h.x - 13 * k(), y: h.y - 36 * k(), w: 26 * k(), h: 36 * k() }) }
  const overlaps = (r) => placed.some((q) => r.x < q.x + q.w + 2 && r.x + r.w + 2 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y)
  const measure = (text, o) => { c.font = o.font || font; const w = Math.ceil(c.measureText(text).width) + 14; return { w, h: o.h || 22 } }
  // Gebaeude-Namen auf dem Schild ueber der Tuer, mit Belegung
  for (const b of L.BUILDINGS) {
    const p = faceL(b, b.w * 8, b.h - 7), q = toCss(p.x, p.y)
    const n = occ[b.id] || 0
    const txt = n > 0 ? `${roomName(b.id)} · ${n}` : roomName(b.id)
    const bo = { h: 20, bg: n > 0 ? 'rgba(255,238,200,0.96)' : 'rgba(251,243,228,0.9)', border: n > 0 ? amber : cssVar('--line', '#ddc9a3'), color: n > 0 ? amber : cssVar('--ink', '#3a2c20') }
    const bm = measure(txt, bo)
    let by = q.y - 2
    for (const dy of [0, -24, 24]) { if (!overlaps({ x: q.x - bm.w / 2, y: q.y - 2 + dy - bm.h / 2, w: bm.w, h: bm.h })) { by = q.y - 2 + dy; break } }
    placed.push(pill(c, txt, q.x, by, bo))
  }
  // Namen der Figuren: Wartende und Fehler zuerst und immer, dann Hauptfiguren, dann Agents wenn es wenige sind
  const small = cw < 560
  const sorted = [...figs.values()].sort((a, b) => {
    const ia = (a.wait && a.wait !== 'idle') || (a.state === 'error' && !a.lead) ? 0 : a.lead ? 1 : 2
    const ib = (b.wait && b.wait !== 'idle') || (b.state === 'error' && !b.lead) ? 0 : b.lead ? 1 : 2
    return ia - ib
  })
  for (const f of sorted) {
    const important = (f.wait && f.wait !== 'idle') || (f.state === 'error' && !f.lead)
    const show = important || f.lead || (!small && figs.size <= 7) || hover === f.key || selected === f.key
    if (!show) continue
    const h = figHead(f), err = f.wait == null
    let text = f.name, o = { h: 19 }, up = 12
    if (important) {
      text = `${f.name} · ${err ? T('state.error') : T('city.waits')}`
      up = (err ? 18 : 44) * k() + 12
      o = { h: 24, border: err ? coral : amber, bw: 2, color: err ? coral : amber, bg: 'rgba(255,244,214,0.97)' }
    } else if (f.lead) o.border = f.col
    const m = measure(text, o)
    let y = h.y - up, ok = false
    for (const dy of [0, -22, 22, -44, 44]) {
      const r = { x: Math.max(4, Math.min(cw - m.w - 4, h.x - m.w / 2)), y: y + dy - m.h / 2, w: m.w, h: m.h }
      if (!overlaps(r)) { y += dy; ok = true; break }
    }
    if (!ok && !important) continue
    placed.push(pill(c, text, h.x, y, o))
  }
  // Tooltip der angetippten/ueberfahrenen Figur
  const tipId = selected || hover
  const f = tipId && figs.get(tipId)
  if (f) {
    const h = figHead(f)
    const lines = [f.name + (f.role && !f.lead ? ` · ${f.role}` : ''), f.what || f.task || T('state.' + (f.state || 'idle'))].filter(Boolean)
    c.font = font
    const w = Math.min(280, Math.max(...lines.map((s) => c.measureText(s).width)) + 18), hh = lines.length * 18 + 10
    const x = Math.max(6, Math.min(cw - w - 6, h.x - w / 2)), y = Math.max(6, h.y - 62 - hh)
    c.fillStyle = 'rgba(58,44,32,0.96)'; roundRect(c, x, y, w, hh, 8); c.fill()
    c.textAlign = 'left'; c.textBaseline = 'middle'
    lines.forEach((s, i) => {
      c.fillStyle = i ? '#e8d9bc' : '#fbf3e4'; c.font = i ? `500 11.5px ${cssVar('--mono', 'monospace')}` : font
      let t = s; while (t.length > 3 && c.measureText(t).width > w - 16) t = t.slice(0, -2)
      c.fillText(t === s ? s : t + '…', x + 9, y + 14 + i * 18)
    })
  }
}

// ---------- Schleife, Umschalten, Eingaben ----------
let active = false, raf = 0, last = 0, lastDraw = 0

function frame(now) {
  if (!active) return
  raf = requestAnimationFrame(frame)
  if (document.hidden) { last = now; return }
  if (reduce && now - lastDraw < 250) return
  const dt = Math.min((now - last) / 1000 || 0.016, 0.05); last = now; lastDraw = now
  sync(dt, Date.now())
  render(now, now / 1000, AB.dayNight ? AB.dayNight.mood() : null)
}

function hitFig(ex, ey) {
  const r = view.canvas.getBoundingClientRect()
  const x = ex - r.left, y = ey - r.top
  let best = null, bd = (cw < 560 ? 26 : 22)
  for (const f of figs.values()) {
    const p = S2(f.gx, f.gy), c0 = toCss(p.x, p.y - 7)
    const d = Math.hypot(c0.x - x, c0.y - y)
    if (d < bd) { bd = d; best = f.key }
  }
  return best
}

function setActive(on) {
  if (on === active || !ready) return
  active = on
  mapCanvas.hidden = on; view.canvas.hidden = !on
  AB.paused = on
  if (btn) btn.setAttribute('aria-pressed', String(on))
  try {
    const u = new URL(location.href)
    if (on) u.searchParams.set('view', 'city'); else u.searchParams.delete('view')
    history.replaceState(null, '', u)
  } catch { /* ohne History-API einfach nichts merken */ }
  if (on) { layout(); last = performance.now(); raf = requestAnimationFrame(frame) } else { cancelAnimationFrame(raf); hover = null }
}

let ready = false
function init() {
  view.canvas = document.createElement('canvas')
  view.canvas.id = 'city'; view.canvas.hidden = true
  view.canvas.setAttribute('role', 'img')
  view.canvas.setAttribute('aria-label', T('city.label'))
  view.ctx = view.canvas.getContext('2d')
  bcv = document.createElement('canvas')
  mapCanvas.after(view.canvas)
  buildSprites(); buildProps(); buildGround()
  ready = true
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (active) layout() }).observe(stage)
  addEventListener('resize', () => { if (active) layout() })
  view.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const h = hitFig(e.clientX, e.clientY); if (h !== hover) { hover = h; view.canvas.style.cursor = h ? 'pointer' : 'default' } } })
  view.canvas.addEventListener('pointerleave', () => { hover = null })
  let drag = null
  view.canvas.addEventListener('pointerdown', (e) => { if (panMax > 0) drag = { x: e.clientX, pan, moved: false } })
  view.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    if (Math.abs(dx) > 6) drag.moved = true
    if (drag.moved) { pan = Math.max(-panMax, Math.min(panMax, Math.round(drag.pan - dx / k()))); cam.x = Math.round((bw - WORLD.w) / 2 - WORLD.x) - pan }
  })
  const endDrag = () => { setTimeout(() => { drag = null }, 0) }
  view.canvas.addEventListener('pointerup', endDrag); view.canvas.addEventListener('pointercancel', endDrag)
  view.canvas.addEventListener('click', (e) => {
    if (drag && drag.moved) return
    const h = hitFig(e.clientX, e.clientY); selected = h && h !== selected ? h : null })
  if (btn) btn.addEventListener('click', () => setActive(!active))
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'c') return
    const t = document.activeElement
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return
    setActive(!active)
  })
  if (params.get('view') === 'city') setActive(true)
}
init()
AB.city = { setActive, isActive: () => active, figures: () => [...figs.values()].map((f) => ({ key: f.key, name: f.name, pose: f.pose, gx: f.gx, gy: f.gy, bid: f.bid })) }
})()
