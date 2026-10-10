// fx/people.js: zeichnet jeden Agent als kleine Pixel-Figur (setzt AB.drawShip).
// Neuer Vertrag seit dem Pixel-Umbau: AB.drawShip(actx, agent, farbe, time, artX, artY) -
// actx ist der kleine, niedrig aufgeloeste Kunst-Pixel-Puffer; artX/artY sind bereits
// ganzzahlige Kunst-Pixel-Koordinaten (Fuesse/Boden der Figur). Nur ganzzahlige fillRect-
// Aufrufe verwenden, sonst verschwimmen die Kanten beim Hochskalieren.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return

const INK = '#3a2c20'
const SKIN = '#e8b98a'

function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0x888888
  const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const motion = new WeakMap()
function motionOf(a) {
  let m = motion.get(a)
  if (!m) { m = { facing: 1, ph: Math.random() * 6, step: 0 }; motion.set(a, m) }
  return m
}

AB.drawShip = (actx, a, color, time, ax, ay) => {
  const m = motionOf(a)
  const moving = Math.hypot(a.vx || 0, a.vy || 0) > 0.15
  if (Math.abs(a.vx || 0) > 0.08) m.facing = a.vx < 0 ? -1 : 1
  if (moving && !AB.reduce) m.step += 1

  const idle = a.state === 'idle', done = a.state === 'done'
  const bob = AB.reduce ? 0 : Math.round(Math.sin(time * (moving ? 7 : 2.2) + m.ph) * (moving ? 1 : 0))
  const oy = ay + bob - (done ? 1 : 0)
  const flip = m.facing < 0

  const dark = shade(color, -0.35)
  const baseA = actx.globalAlpha
  if (idle) actx.globalAlpha = baseA * 0.8

  // Bodenschatten (etwas kraeftiger/breiter fuer mehr Tiefenwirkung)
  actx.globalAlpha = (idle ? baseA * 0.8 : baseA) * 0.3
  actx.fillStyle = INK
  actx.fillRect(ax - 5, oy, 10, 2)
  actx.globalAlpha = idle ? baseA * 0.8 : baseA

  // Beine: wechseln beim Gehen (2-Frame-Laufzyklus)
  const walkFrame = moving && !AB.reduce ? (Math.floor(m.step / 8) % 2) : 0
  const stepOff = walkFrame === 0 ? 0 : 1
  actx.fillStyle = dark
  actx.fillRect(ax - 3, oy - 7 + (flip ? stepOff : -stepOff), 3, 7)
  actx.fillRect(ax, oy - 7 + (flip ? -stepOff : stepOff), 3, 7)

  // Koerper (Hemd in Agent-Farbe)
  actx.fillStyle = color
  actx.fillRect(ax - 4, oy - 15, 8, 9)
  // Schattenkante rechts
  actx.fillStyle = dark
  actx.fillRect(ax + 2, oy - 15, 2, 9)

  // Arme
  actx.fillStyle = dark
  actx.fillRect(ax - 6, oy - 14, 2, 6)
  actx.fillRect(ax + 4, oy - 14, 2, 6)

  // Kopf
  actx.fillStyle = SKIN
  actx.fillRect(ax - 4, oy - 23, 8, 8)
  actx.fillStyle = shade(SKIN, -0.25)
  actx.fillRect(ax + 2, oy - 23, 2, 8)
  // Haar/Kappe in Agent-Farbe
  actx.fillStyle = color
  actx.fillRect(ax - 4, oy - 24, 8, 3)
  actx.fillRect(ax - 4, oy - 21, 2, 2)
  // Auge (nur in Blickrichtung, winziger dunkler Punkt)
  actx.fillStyle = INK
  actx.fillRect(ax + (flip ? -2 : 1), oy - 20, 1, 1)

  if (a.state === 'error' && !AB.reduce && Date.now() - (a.errAt || 0) < 700) {
    actx.globalAlpha = (idle ? baseA * 0.8 : baseA) * ((Math.floor(time * 10) % 2) ? 1 : 0.4)
  }
  actx.globalAlpha = baseA
}
})()
