// city-logic.js: reine Logik der Stadtansicht (public/city.js zeichnet nur noch).
// Gitter, Gebaeude, isometrische Projektion, Wegfindung, Stellplaetze vor den Tueren und Laufbewegung.
// Haengt nicht am DOM und ist getestet in test/city.test.mjs. Welches Werkzeug in welches Gebaeude gehoert,
// steht weiterhin nur in public/app.js (STATIONS/stationFor): hier gibt es je Raum-ID genau ein Gebaeude.
(() => {
'use strict'

// Eine Kachel ist 32 x 16 Kunst-Pixel breit/hoch (klassisches 2:1-Iso).
const TW = 32, TH = 16
const GRID = { w: 17, h: 14 }

// Gebaeude in Kachelkoordinaten (x/y = linke obere Kachel, w = Laenge in gx, d = Tiefe in gy, h = Wandhoehe in Pixeln).
// Obere Reihe = Archiv, Werkstatt, Terminal; untere Reihe = Funkturm, Leitstand, Pausenraum (wie im Grundriss des Boards).
// Alle Tueren liegen an der Fassade zu +gy (die linke sichtbare Seite).
const BUILDINGS = [
  { id: 'archiv', x: 1, y: 1, w: 4, d: 3, h: 40 },
  { id: 'werkstatt', x: 6, y: 1, w: 4, d: 3, h: 30 },
  { id: 'terminal', x: 11, y: 1, w: 4, d: 3, h: 34 },
  { id: 'funkturm', x: 1, y: 8, w: 4, d: 3, h: 26 },
  { id: 'leitstand', x: 6, y: 8, w: 4, d: 3, h: 44 },
  { id: 'pausenraum', x: 11, y: 8, w: 4, d: 3, h: 24 },
]

// Deko mit fester Position. block: Kachel ist nicht begehbar.
const PROPS = [
  { type: 'fountain', gx: 8.5, gy: 6.5, block: true },
  { type: 'tree', v: 0, gx: 0.5, gy: 0.5, block: true }, { type: 'tree', v: 1, gx: 15.5, gy: 0.5, block: true },
  { type: 'tree', v: 2, gx: 16.5, gy: 4.5, block: true }, { type: 'tree', v: 1, gx: 0.5, gy: 4.5, block: true },
  { type: 'tree', v: 0, gx: 16.5, gy: 6.5, block: true }, { type: 'tree', v: 2, gx: 0.5, gy: 6.5, block: true },
  { type: 'tree', v: 1, gx: 16.5, gy: 12.5, block: true }, { type: 'tree', v: 0, gx: 0.5, gy: 12.5, block: true },
  { type: 'tree', v: 2, gx: 15.5, gy: 13.5, block: true }, { type: 'tree', v: 0, gx: 0.5, gy: 9.5, block: true },
  { type: 'tree', v: 1, gx: 15.5, gy: 4.5, block: true }, { type: 'tree', v: 2, gx: 15.5, gy: 10.5, block: true },
  { type: 'bush', gx: 4.5, gy: 4.5, block: false }, { type: 'bush', gx: 9.5, gy: 4.5, block: false },
  { type: 'bush', gx: 14.5, gy: 4.5, block: false }, { type: 'bush', gx: 1.5, gy: 4.5, block: false },
  { type: 'bush', gx: 4.5, gy: 11.5, block: false }, { type: 'bush', gx: 14.5, gy: 11.5, block: false },
  { type: 'lamp', gx: 5.5, gy: 5.5, block: false }, { type: 'lamp', gx: 10.5, gy: 5.5, block: false },
  { type: 'lamp', gx: 5.5, gy: 7.5, block: false }, { type: 'lamp', gx: 10.5, gy: 7.5, block: false },
  { type: 'bench', gx: 8.5, gy: 4.7, block: false }, { type: 'bench', gx: 12.5, gy: 7.4, block: false },
  { type: 'crates', gx: 9.4, gy: 4.3, block: false }, { type: 'books', gx: 1.5, gy: 4.6, block: false },
  { type: 'flowers', gx: 13.2, gy: 11.4, block: false }, { type: 'flowers', gx: 14.3, gy: 12.6, block: false },
  { type: 'flowers', gx: 2.2, gy: 12.7, block: false },
]

const buildingById = (id) => BUILDINGS.find((b) => b.id === id) || null

// Werkzeug -> Gebaeude: die Zuordnung liefert app.js (stationFor), hier wird nur die Raum-ID aufs Gebaeude abgebildet.
function buildingForTool(tool, stationFor) {
  const st = stationFor ? stationFor(tool) : null
  return st ? buildingById(st.id) : null
}

// ---------- Projektion ----------
const toScreen = (gx, gy, z = 0) => ({ x: (gx - gy) * (TW / 2), y: (gx + gy) * (TH / 2) - z })
const toGrid = (sx, sy) => ({ gx: sy / TH + sx / TW, gy: sy / TH - sx / TW })

// Ist ein Punkt (Figur) vor dem Gebaeude? Reicht fuer die Zeichenreihenfolge, weil die Gebaeude Quader sind.
const inFront = (p, b) => p.gx >= b.x + b.w || p.gy >= b.y + b.d

// ---------- Begehbarkeit und Wege ----------
const key = (tx, ty) => ty * GRID.w + tx
const inGrid = (tx, ty) => tx >= 0 && ty >= 0 && tx < GRID.w && ty < GRID.h

function blockedSet() {
  const s = new Set()
  for (const b of BUILDINGS) for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) s.add(key(x, y))
  for (const p of PROPS) if (p.block) s.add(key(Math.floor(p.gx), Math.floor(p.gy)))
  return s
}
const BLOCKED = blockedSet()
const isBlocked = (tx, ty) => !inGrid(tx, ty) || BLOCKED.has(key(tx, ty))

// Strassen: zwei Laengsstrassen, die breite Mitte, die Strasse vor der unteren Reihe, Wege vor den Tueren
function isRoad(tx, ty) {
  if (!inGrid(tx, ty)) return false
  if (tx === 5 || tx === 10) return true
  if (ty >= 5 && ty <= 7) return true
  if (ty === 12) return true
  for (const b of BUILDINGS) if ((ty === b.y + b.d) && tx >= b.x + 1 && tx <= b.x + b.w - 2) return true
  return false
}
// Kosten je Kachel: Strasse billig, Gras teurer, der Inselrand am teuersten (damit Figuren auf Wegen bleiben)
function tileCost(tx, ty) {
  if (isRoad(tx, ty)) return 1
  if (tx === 0 || ty === 0 || tx === GRID.w - 1 || ty === GRID.h - 1) return 3
  return 1.7
}

// A* ueber die Kacheln (4 Nachbarn = auf dem Bildschirm schraege Iso-Schritte). Gibt Kachelmitten zurueck
// (inklusive Start und Ziel) oder null. Ein blockierter Start/Ziel wird auf die naechste freie Kachel gezogen.
function nearestFree(tx, ty) {
  if (!isBlocked(tx, ty)) return { tx, ty }
  let best = null, bd = 1e9
  for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
    if (isBlocked(x, y)) continue
    const d = (x - tx) ** 2 + (y - ty) ** 2
    if (d < bd) { bd = d; best = { tx: x, ty: y } }
  }
  return best
}
function findPath(from, to) {
  const a = nearestFree(Math.floor(from.gx), Math.floor(from.gy))
  const b = nearestFree(Math.floor(to.gx), Math.floor(to.gy))
  if (!a || !b) return null
  const start = key(a.tx, a.ty), goal = key(b.tx, b.ty)
  const g = new Map([[start, 0]]), prev = new Map(), open = [[0, start]]
  const h = (k) => Math.abs((k % GRID.w) - b.tx) + Math.abs(Math.floor(k / GRID.w) - b.ty)
  const closed = new Set()
  while (open.length) {
    open.sort((p, q) => p[0] - q[0])
    const [, cur] = open.shift()
    if (cur === goal) {
      const out = []
      for (let k = cur; k !== undefined; k = prev.get(k)) out.push({ gx: (k % GRID.w) + 0.5, gy: Math.floor(k / GRID.w) + 0.5 })
      return out.reverse()
    }
    if (closed.has(cur)) continue
    closed.add(cur)
    const cx = cur % GRID.w, cy = Math.floor(cur / GRID.w)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy
      if (isBlocked(nx, ny)) continue
      const nk = key(nx, ny), ng = g.get(cur) + tileCost(nx, ny)
      if (ng < (g.has(nk) ? g.get(nk) : Infinity)) { g.set(nk, ng); prev.set(nk, cur); open.push([ng + h(nk), nk]) }
    }
  }
  return null
}

// Weg von A nach B als Punktliste: Kachelmitten, erster Punkt = aktuelle Position, letzter = genaues Ziel.
function routeTo(from, to) {
  const tiles = findPath(from, to) || []
  const pts = [{ gx: from.gx, gy: from.gy }]
  for (let i = 1; i < tiles.length - 1; i++) pts.push(tiles[i])
  pts.push({ gx: to.gx, gy: to.gy })
  return pts
}

// ---------- Stellplaetze ----------
const OFFS = [0, -1, 1, -2, 2]
// i-ter Platz vor der Tuer eines Gebaeudes (Reihe fuer Reihe, von der Tuermitte nach aussen)
function slotPos(b, i) {
  const row = Math.floor(i / OFFS.length), col = i % OFFS.length
  return { gx: b.x + b.w / 2 + OFFS[col] * 0.85, gy: b.y + b.d + 0.45 + (row % 2) * 0.8 }
}
// Schreibtische der Hauptfiguren: auf der Strasse vor dem Leitstand, mittig nebeneinander
function homePos(i, n) {
  const b = buildingById('leitstand')
  return { gx: b.x + b.w / 2 + (i - (n - 1) / 2) * 1.15, gy: b.y + b.d + 1.15 }
}
// Wartespots im Leerlauf: auf der Strasse hinter den Schreibtischen
function idlePos(homeGx, i) {
  const col = i % 5, row = Math.floor(i / 5) % 2
  return { gx: homeGx + OFFS[col] * 0.9 + (row ? 0.45 : 0), gy: 12.85 + row * 0.55 }
}

// ---------- Bewegung ----------
// Blickrichtung auf dem Bildschirm: d = zum Betrachter, u = weg; l/r = links/rechts
function facing(dgx, dgy) {
  const sx = (dgx - dgy) * (TW / 2), sy = (dgx + dgy) * (TH / 2)
  return (sy >= 0 ? 'd' : 'u') + (sx >= 0 ? 'r' : 'l')
}

// Figur f = { gx, gy, path: [{gx,gy}], face } um dt Sekunden mit speed (Kacheln/s) auf ihrem Weg bewegen.
// Gibt true zurueck, solange sie unterwegs ist.
function stepAlong(f, dt, speed) {
  let budget = speed * dt
  while (f.path && f.path.length && budget > 0) {
    const p = f.path[0]
    const dx = p.gx - f.gx, dy = p.gy - f.gy, dist = Math.hypot(dx, dy)
    if (dist < 1e-6) { f.path.shift(); continue }
    f.face = facing(dx, dy)
    if (dist <= budget) { f.gx = p.gx; f.gy = p.gy; budget -= dist; f.path.shift() }
    else { f.gx += (dx / dist) * budget; f.gy += (dy / dist) * budget; budget = 0 }
  }
  return !!(f.path && f.path.length)
}

const api = { TW, TH, GRID, BUILDINGS, PROPS, buildingById, buildingForTool, toScreen, toGrid, inFront, isBlocked, isRoad, tileCost,
  findPath, routeTo, slotPos, homePos, idlePos, facing, stepAlong }
const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardCityLogic = api
})()
