// Stadtansicht (public/city-logic.js): Zuordnung Raum -> Gebaeude, Projektion, Wegfindung, Stellplaetze, Laufbewegung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
ctx.globalThis = ctx.window
vm.runInNewContext(readFileSync(join(PUB, 'city-logic.js'), 'utf8'), ctx)
const C = ctx.window.AgentBoardCityLogic

// STATIONS und stationFor stehen nur in app.js: hier woertlich herausgelesen, damit nichts doppelt gepflegt wird
const app = readFileSync(join(PUB, 'app.js'), 'utf8')
const stationsSrc = app.match(/const STATIONS = (\[[\s\S]*?\n\])/)[1]
const forSrc = app.match(/const stationFor = (\(tool\) => \{[\s\S]*?\n\})/)[1]
const T = (k) => k
const STATIONS = vm.runInNewContext(`(${stationsSrc})`, { T })
const stationById = (id) => STATIONS.find((s) => s.id === id)
const stationFor = vm.runInNewContext(`(${forSrc})`, { STATIONS, stationById })

test('jeder Raum des Boards hat genau ein Gebaeude, und es gibt kein Gebaeude ohne Raum', () => {
  assert.deepEqual([...C.BUILDINGS.map((b) => b.id)].sort(), [...STATIONS.map((s) => s.id)].sort())
})

test('Werkzeug -> Gebaeude folgt der Raum-Zuordnung aus app.js', () => {
  for (const st of STATIONS) for (const tool of st.tools) assert.equal(C.buildingForTool(tool, stationFor).id, st.id, tool)
  assert.equal(C.buildingForTool('Read', stationFor).id, 'archiv')
  assert.equal(C.buildingForTool('Edit', stationFor).id, 'werkstatt')
  assert.equal(C.buildingForTool('Bash', stationFor).id, 'terminal')
  assert.equal(C.buildingForTool('WebFetch', stationFor).id, 'funkturm')
  assert.equal(C.buildingForTool('mcp__x__y', stationFor).id, 'funkturm') // MCP-Aufrufe gehen zum Funkturm
  assert.equal(C.buildingForTool('SomethingNew', stationFor).id, 'leitstand') // Unbekanntes landet im Leitstand
  assert.equal(C.buildingForTool(null, stationFor), null)
})

test('Gebaeude liegen im Gitter, ueberlappen nicht und haben Platz vor der Tuer', () => {
  for (const a of C.BUILDINGS) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= C.GRID.w && a.y + a.d + 2 <= C.GRID.h, a.id)
    for (const b of C.BUILDINGS) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.d <= b.y || b.y + b.d <= a.y, `${a.id}/${b.id}`)
  }
})

test('Projektion: Bildschirm <-> Gitter ist umkehrbar, ein Schritt in gx geht nach rechts unten', () => {
  for (const [gx, gy] of [[0, 0], [3.5, 7.25], [16, 13]]) {
    const s = C.toScreen(gx, gy), g = C.toGrid(s.x, s.y)
    assert.ok(Math.abs(g.gx - gx) < 1e-9 && Math.abs(g.gy - gy) < 1e-9)
  }
  const a = C.toScreen(0, 0), b = C.toScreen(1, 0), c = C.toScreen(0, 1)
  assert.equal(b.x - a.x, 16); assert.equal(b.y - a.y, 8)
  assert.equal(c.x - a.x, -16); assert.equal(c.y - a.y, 8)
  assert.equal(C.toScreen(2, 2, 10).y, C.toScreen(2, 2).y - 10)
})

test('Wegfindung: findet Wege zwischen allen Tueren, geht nie durch Gebaeude', () => {
  const doors = C.BUILDINGS.map((b) => C.slotPos(b, 0))
  for (const a of doors) for (const b of doors) {
    const path = C.findPath(a, b)
    assert.ok(path && path.length >= 1)
    for (const p of path) assert.ok(!C.isBlocked(Math.floor(p.gx), Math.floor(p.gy)))
    for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i].gx - path[i - 1].gx) + Math.abs(path[i].gy - path[i - 1].gy), 1) // nur Nachbarkacheln
  }
})

test('Wegfindung: bevorzugt Strassen und zieht blockierte Ziele auf freie Kacheln', () => {
  const path = C.findPath({ gx: 0.5, gy: 5.5 }, { gx: 16.5, gy: 5.5 })
  assert.ok(path.every((p) => C.isRoad(Math.floor(p.gx), Math.floor(p.gy))))
  const archiv = C.buildingById('archiv')
  const inside = C.findPath({ gx: 0.5, gy: 0.5 }, { gx: archiv.x + 1.5, gy: archiv.y + 1.5 })
  const end = inside[inside.length - 1]
  assert.ok(!C.isBlocked(Math.floor(end.gx), Math.floor(end.gy)))
})

test('routeTo beginnt an der Position und endet genau am Ziel', () => {
  const to = C.slotPos(C.buildingById('werkstatt'), 2)
  const r = C.routeTo({ gx: 3.2, gy: 12.9 }, to)
  assert.deepEqual({ ...r[0] }, { gx: 3.2, gy: 12.9 })
  assert.deepEqual({ ...r[r.length - 1] }, { ...to })
})

test('Stellplaetze: frei, im Gitter, jeder Platz verschieden', () => {
  for (const b of C.BUILDINGS) {
    const seen = new Set()
    for (let i = 0; i < 10; i++) {
      const p = C.slotPos(b, i)
      assert.ok(!C.isBlocked(Math.floor(p.gx), Math.floor(p.gy)), `${b.id} #${i}`)
      assert.ok(p.gy > b.y + b.d, 'vor der Tuer')
      seen.add(`${p.gx.toFixed(2)},${p.gy.toFixed(2)}`)
    }
    assert.ok(seen.size >= 10, b.id)
  }
  for (const n of [1, 2, 4]) for (let i = 0; i < n; i++) { const h = C.homePos(i, n); assert.ok(!C.isBlocked(Math.floor(h.gx), Math.floor(h.gy))) }
  for (let i = 0; i < 10; i++) { const p = C.idlePos(8, i); assert.ok(!C.isBlocked(Math.floor(p.gx), Math.floor(p.gy))); assert.ok(p.gy < C.GRID.h) }
})

test('Laufen: stepAlong kommt an, bleibt auf dem Weg und setzt die Blickrichtung', () => {
  const f = { gx: 0, gy: 0, path: [{ gx: 4, gy: 0 }, { gx: 4, gy: 3 }], face: 'dr' }
  let t = 0
  while (C.stepAlong(f, 0.1, 2)) { t += 0.1; assert.ok(t < 10) }
  assert.equal(f.gx, 4); assert.equal(f.gy, 3)
  assert.ok(Math.abs(t - 3.5) < 0.2) // 7 Kacheln bei 2 Kacheln/s
  assert.equal(f.face, 'dl') // zuletzt in +gy: links unten
  const g = { gx: 1, gy: 1, path: [], face: 'ur' }
  assert.equal(C.stepAlong(g, 1, 3), false)
  assert.equal(g.face, 'ur')
})

test('Blickrichtung', () => {
  assert.equal(C.facing(1, 0), 'dr'); assert.equal(C.facing(0, 1), 'dl')
  assert.equal(C.facing(-1, 0), 'ul'); assert.equal(C.facing(0, -1), 'ur')
})

test('Zeichenreihenfolge: wer vor einer Wand steht, liegt vor dem Gebaeude', () => {
  const b = C.buildingById('werkstatt')
  assert.equal(C.inFront({ gx: b.x + 2, gy: b.y + b.d + 0.5 }, b), true)
  assert.equal(C.inFront({ gx: b.x + b.w + 0.5, gy: b.y + 1 }, b), true)
  assert.equal(C.inFront({ gx: b.x + 2, gy: b.y - 0.5 }, b), false)
})
