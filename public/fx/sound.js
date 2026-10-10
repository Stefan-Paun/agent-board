// Klangkulisse fuer das Agent-Board: alles per WebAudio synthetisiert, keine Audiodateien.
// Standard: AUS. Hauptschalter bleibt der Ton-Knopf (#b-sound) im Kern; dieses Modul haengt
// daneben nur einen Lautstaerke-Regler und einen kleinen "Musik"-Schalter (Lo-Fi, eigene Einstellung).
//
// API
//   AB.playSound(name, audioCtx?)  - spielt einen Klang. Ohne audioCtx nur, wenn der Ton an ist.
//                                    Unbekannte Namen werden still ignoriert (Rueckgabe true).
//   AB.soundOn()                   - true, wenn der Ton an ist
//   AB.setSoundVolume(0..1)        - Lautstaerke (localStorage 'ab-vol')
//   AB.setLofi(bool), AB.lofiOn()  - Lo-Fi-Hintergrund (localStorage 'ab-lofi'), spielt nur bei Ton an
//   AB.lofiPlaying()               - true, solange die Musik gerade laeuft (pausiert bei verstecktem Tab)
//
// Namen
//   Kern:     tool, click, spawn, done, error, prompt, stop, alert
//   Signale:  wait  (sanfter Zwei-Ton-Gong, "wartet auf dich"), hour (leise warme Glocke), chime (Erfolg)
//   Raeume:   archiv, werkstatt, terminal, terminal-end, funkturm, leitstand, pausenraum
//             (je 4 Varianten, leichte Zufalls-Tonhoehe/-Lautstaerke, nach Raumposition gepannt)
// Lautstaerke-Hierarchie: nur wait/stop/alert/error sind lauter, alles andere ist leise Routine.
// Drosselung: hoechstens ~4 Routine-Klaenge pro Sekunde, gleiche Station hoechstens alle 250 ms.
(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return

// ---------- Lautstaerke (Regler im Header) ----------
let vol = 0.7
try { const v = parseFloat(localStorage.getItem('ab-vol')); if (v >= 0 && v <= 1) vol = v } catch { /* egal */ }
const gainOf = (v) => v * v * 1.6 // weiche Kurve

// ---------- Master-Kette pro AudioContext (einmal) ----------
const chains = new WeakMap()
function chainFor(ac) {
  let ch = chains.get(ac)
  if (ch) return ch
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.22
  const master = ac.createGain(); master.gain.value = gainOf(vol)
  const dry = ac.createGain()
  const verb = ac.createConvolver()
  const wet = ac.createGain(); wet.gain.value = 1
  // Impulsantwort: Stereo-Rauschen, exponentiell abklingend, nach hinten dumpfer (1-pol-Tiefpass)
  const len = Math.floor(ac.sampleRate * 1.5)
  const ir = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const k = 0.55 - 0.45 * t
      lp += k * (((Math.random() * 2 - 1)) - lp)
      d[i] = lp * Math.pow(1 - t, 3) * 0.9
    }
  }
  verb.buffer = ir
  dry.connect(master); verb.connect(wet); wet.connect(master)
  master.connect(comp); comp.connect(ac.destination)
  // Rausch-Puffer (1 s)
  const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
  const nd = nb.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  ch = { ac, comp, master, dry, verb, noise: nb, voices: 0, recent: [], lastSt: {}, lastVar: {}, pendingTool: false }
  chains.set(ac, ch)
  return ch
}

// ---------- Bausteine ----------
const rnd = (a, b) => a + Math.random() * (b - a)
const now = () => (window.performance ? performance.now() : Date.now())

function env(g, t0, atk, dur, v) { // Attack linear-exp, weicher exponentieller Abfall
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
}

function panTo(ac, node, pan) {
  if (!pan || !ac.createStereoPanner) return node
  const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); return p
}

// Ein Ton: o = {type, f, to, t, atk, dur, v, det, lp:[f0,f1,q], pan, send, out}
function note(ch, o) {
  const ac = ch.ac, t0 = ac.currentTime + (o.t || 0)
  const osc = ac.createOscillator(), g = ac.createGain()
  osc.type = o.type || 'sine'
  osc.frequency.setValueAtTime(o.f, t0)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur * 0.9)
  if (o.det) osc.detune.value = o.det
  env(g, t0, o.atk || 0.01, o.dur, o.v)
  let node = osc
  osc.connect(g); node = g
  if (o.lp) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.lp[2] || 1
    f.frequency.setValueAtTime(o.lp[0], t0); f.frequency.exponentialRampToValueAtTime(o.lp[1], t0 + o.dur)
    node.connect(f); node = f
  }
  node = panTo(ac, node, o.pan)
  node.connect(o.out || ch.dry)
  if (o.send) { const s = ac.createGain(); s.gain.value = o.send; node.connect(s); s.connect(ch.verb) }
  ch.voices++
  osc.onended = () => { ch.voices-- }
  osc.start(t0); osc.stop(t0 + o.dur + 0.05)
  return osc
}

// FM-Glocke: Traeger + Modulator (Verhaeltnis r), Index fadet aus; out = Ziel-Knoten (optional)
function bell(ch, f, t, dur, v, send, pan, r, out, idx) {
  const ac = ch.ac, t0 = ac.currentTime + t
  const car = ac.createOscillator(), mod = ac.createOscillator()
  const mg = ac.createGain(), g = ac.createGain()
  car.frequency.value = f; mod.frequency.value = f * (r || 3.5)
  mg.gain.setValueAtTime(f * (idx || 0.9), t0); mg.gain.exponentialRampToValueAtTime(1, t0 + dur)
  mod.connect(mg); mg.connect(car.frequency)
  env(g, t0, 0.006, dur, v)
  car.connect(g)
  const node = panTo(ac, g, pan)
  node.connect(out || ch.dry)
  const s = ac.createGain(); s.gain.value = send == null ? 0.5 : send; node.connect(s); s.connect(ch.verb)
  ch.voices += 2
  const done = () => { ch.voices-- }
  car.onended = done; mod.onended = done
  car.start(t0); mod.start(t0); car.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05)
}

// Gefiltertes Rauschen: o = {t, dur, v, bp:[f0,f1,q] | lp:f | hp:f, send, pan, out}
function noise(ch, o) {
  const ac = ch.ac, t0 = ac.currentTime + (o.t || 0)
  const src = ac.createBufferSource(); src.buffer = ch.noise; src.loop = true
  const f = ac.createBiquadFilter()
  if (o.bp) {
    f.type = 'bandpass'; f.Q.value = o.bp[2] || 1
    f.frequency.setValueAtTime(o.bp[0], t0); f.frequency.exponentialRampToValueAtTime(o.bp[1], t0 + o.dur)
  } else if (o.lp) { f.type = 'lowpass'; f.frequency.value = o.lp }
  else { f.type = 'highpass'; f.frequency.value = o.hp || 3000 }
  const g = ac.createGain(); env(g, t0, o.atk || 0.01, o.dur, o.v)
  src.connect(f); f.connect(g)
  const node = panTo(ac, g, o.pan)
  node.connect(o.out || ch.dry)
  if (o.send) { const s = ac.createGain(); s.gain.value = o.send; node.connect(s); s.connect(ch.verb) }
  ch.voices++
  src.onended = () => { ch.voices-- }
  src.start(t0, Math.random() * 0.5); src.stop(t0 + o.dur + 0.05)
}

// Raum-Bus: Lautstaerke-Faktor + Stereo-Position, endet in der Master-Kette
function bus(ch, pan, v) {
  const ac = ch.ac
  const g = ac.createGain(); g.gain.value = v
  panTo(ac, g, pan).connect(ch.dry)
  return g
}

// ---------- Die Kern-Klaenge ----------
const SOUNDS = {
  tool(ch) { // Fallback ohne Station: weiches Klicken vom Leitstand
    playRoom(ch, 'leitstand')
  },
  click(ch) {
    const f = 700 * rnd(0.98, 1.03)
    note(ch, { type: 'sine', f, to: f * 1.35, dur: 0.09, atk: 0.005, v: 0.06, send: 0.1 })
    note(ch, { type: 'triangle', f: f * 2, dur: 0.05, atk: 0.003, v: 0.02, lp: [4000, 1000, 1] })
  },
  spawn(ch) { // Whoosh + aufsteigender Sweep + Glocke (Routine: leise)
    noise(ch, { bp: [250, 3200, 1.6], dur: 0.6, atk: 0.2, v: 0.06, send: 0.35, pan: -0.2 })
    noise(ch, { bp: [400, 4200, 2], dur: 0.55, atk: 0.22, v: 0.03, send: 0.3, pan: 0.25 })
    const b = 196 * rnd(0.97, 1.04)
    note(ch, { type: 'sawtooth', f: b, to: b * 3, dur: 0.55, atk: 0.12, v: 0.022, lp: [500, 2600, 3], send: 0.3 })
    note(ch, { type: 'sawtooth', f: b, to: b * 3, dur: 0.55, atk: 0.12, v: 0.018, det: 9, lp: [500, 2600, 3], send: 0.3 })
    bell(ch, 880 * rnd(0.98, 1.03), 0.4, 0.7, 0.035, 0.6, 0.15, 2)
  },
  done(ch) { // Dur-Arpeggio, leise
    const base = 523.25 * rnd(0.985, 1.02)
    ;[1, 1.25, 1.5, 2].forEach((r, i) => {
      const t = i * 0.085, f = base * r, pan = (i - 1.5) * 0.18
      note(ch, { type: 'sine', f, dur: i === 3 ? 0.8 : 0.35, v: 0.045, det: -6, t, send: 0.4, pan })
      note(ch, { type: 'triangle', f, dur: i === 3 ? 0.8 : 0.35, v: 0.02, det: 7, t, send: 0.4, pan, lp: [3000, 900, 1] })
    })
    bell(ch, base * 4, 0.27, 0.9, 0.012, 0.7, 0, 3.5)
  },
  chime(ch) { // Erfolg: drei helle, kurze Toene
    const base = 659.25 * rnd(0.98, 1.02)
    ;[1, 1.26, 1.5].forEach((r, i) => {
      note(ch, { type: 'sine', f: base * r, dur: i === 2 ? 0.7 : 0.3, v: 0.05, t: i * 0.09, send: 0.4, pan: (i - 1) * 0.2 })
    })
    bell(ch, base * 3, 0.2, 0.8, 0.015, 0.6, 0, 3.5)
  },
  error(ch) { // dumpf, zweimal, ohne Schrillen (lautes Signal)
    ;[0, 0.17].forEach((t, i) => {
      const f = (i ? 118 : 150) * rnd(0.97, 1.03)
      note(ch, { type: 'sawtooth', f, to: f * 0.55, dur: 0.3, atk: 0.008, v: 0.11, t, lp: [1400, 180, 4], send: 0.15 })
      note(ch, { type: 'square', f: f / 2, to: f * 0.28, dur: 0.3, atk: 0.008, v: 0.06, t, lp: [500, 120, 1] })
    })
    noise(ch, { bp: [900, 200, 1], dur: 0.2, atk: 0.003, v: 0.05 })
  },
  prompt(ch) { // zwei freundliche aufsteigende Glocken (mittel)
    const f = 659.25 * rnd(0.99, 1.02)
    bell(ch, f, 0, 0.5, 0.045, 0.4, -0.1, 2)
    bell(ch, f * 1.5, 0.1, 0.7, 0.045, 0.5, 0.1, 2)
    note(ch, { type: 'sine', f: f / 2, dur: 0.4, v: 0.03, t: 0, send: 0.2 })
  },
  stop(ch) { // wartet auf dich: absteigend, beruhigend (lautes Signal)
    const f = 587.33 * rnd(0.99, 1.02)
    note(ch, { type: 'sine', f, dur: 0.35, v: 0.09, send: 0.45, det: -5 })
    note(ch, { type: 'sine', f: f * 0.75, dur: 0.7, v: 0.09, t: 0.14, send: 0.5, det: 5 })
    note(ch, { type: 'triangle', f: f * 0.375, dur: 0.7, v: 0.05, t: 0.14, lp: [1200, 300, 1] })
  },
  alert(ch) { // zwei Ping-Toene, klar aber nicht schrill (lautes Signal)
    const f = 880 * rnd(0.99, 1.02)
    bell(ch, f, 0, 0.55, 0.09, 0.45, 0, 2)
    bell(ch, f * 1.335, 0.2, 0.9, 0.09, 0.55, 0, 2)
    note(ch, { type: 'sine', f: f / 2, dur: 0.5, v: 0.04, send: 0.2 })
  },
  wait(ch) { // sanfter Zwei-Ton-Gong, absteigend (lautes Signal)
    const f = 523.25 * rnd(0.98, 1.02)
    bell(ch, f, 0, 1.4, 0.08, 0.55, -0.08, 1.41, null, 0.5)
    bell(ch, f * 0.8, 0.42, 1.9, 0.08, 0.6, 0.08, 1.41, null, 0.5)
    note(ch, { type: 'sine', f: f * 0.4, dur: 1.6, atk: 0.04, v: 0.04, t: 0.42, send: 0.3 })
  },
  hour(ch) { // leise, warme Glocke
    const f = 330 * rnd(0.98, 1.02)
    bell(ch, f, 0, 2.6, 0.035, 0.7, 0, 2, null, 0.6)
    note(ch, { type: 'sine', f: f * 2, dur: 1.8, atk: 0.02, v: 0.012, send: 0.6 })
    note(ch, { type: 'sine', f: f / 2, dur: 2.2, atk: 0.05, v: 0.02, send: 0.3 })
  },
}

// ---------- Raum-Klaenge: je 4 Varianten; p = Tonhoehen-Faktor, out = Raum-Bus ----------
const tick = (ch, out, t, f, v, hp) => { // ein Tastenanschlag
  noise(ch, { hp: hp || 2500, dur: 0.018, atk: 0.002, v: v * 0.7, t, out })
  note(ch, { type: 'triangle', f, to: f * 0.7, dur: 0.03, atk: 0.002, v, t, lp: [4000, 1200, 1], out })
}
const ROOMS = {
  archiv: [ // Papierrascheln / Blaettern
    (ch, p, out) => { // kurzes Rascheln: drei Bursts
      for (let i = 0; i < 3; i++) noise(ch, { bp: [2600 * p * rnd(0.9, 1.1), 4200 * p, 1.4], dur: rnd(0.04, 0.08), atk: 0.006, v: 0.03, t: i * rnd(0.04, 0.07), out })
    },
    (ch, p, out) => { // Seite umblaettern: Wisch + leiser Abschluss
      noise(ch, { bp: [900 * p, 3400 * p, 1.2], dur: 0.22, atk: 0.08, v: 0.03, out, send: 0.1 })
      noise(ch, { bp: [3000 * p, 2000 * p, 2], dur: 0.04, atk: 0.003, v: 0.02, t: 0.2, out })
    },
    (ch, p, out) => { // zwei Seiten
      for (let i = 0; i < 2; i++) noise(ch, { bp: [1200 * p, 3800 * p, 1.3], dur: 0.15, atk: 0.05, v: 0.025, t: i * 0.19, out })
    },
    (ch, p, out) => { // Mappe ablegen: dumpfer Papierton
      noise(ch, { lp: 700 * p, dur: 0.09, atk: 0.004, v: 0.05, out })
      noise(ch, { bp: [2400 * p, 1600 * p, 1.5], dur: 0.07, atk: 0.004, v: 0.015, t: 0.02, out })
    },
  ],
  werkstatt: [ // Tastaturklackern / Holzklopfer
    (ch, p, out) => { let t = 0; for (let i = 0; i < 4; i++) { tick(ch, out, t, 2000 * p * rnd(0.9, 1.1), 0.02); t += rnd(0.06, 0.11) } },
    (ch, p, out) => { let t = 0; for (let i = 0; i < 6; i++) { tick(ch, out, t, 2200 * p * rnd(0.88, 1.12), 0.016); t += rnd(0.05, 0.09) } },
    (ch, p, out) => { // kleiner Holzklopfer
      note(ch, { type: 'sine', f: 440 * p, to: 380 * p, dur: 0.09, atk: 0.002, v: 0.05, out, send: 0.12 })
      noise(ch, { bp: [900 * p, 700 * p, 3], dur: 0.04, atk: 0.002, v: 0.03, out })
    },
    (ch, p, out) => { // Klopf-klopf
      ;[0, 0.13].forEach((t, i) => {
        note(ch, { type: 'sine', f: (i ? 400 : 460) * p, to: 360 * p, dur: 0.08, atk: 0.002, v: 0.04, t, out, send: 0.1 })
        noise(ch, { bp: [1000 * p, 800 * p, 3], dur: 0.03, atk: 0.002, v: 0.022, t, out })
      })
    },
  ],
  terminal: [ // sanftes Tastenklicken (weicher, hoeher als die Werkstatt)
    (ch, p, out) => { let t = 0; for (let i = 0; i < 3; i++) { tick(ch, out, t, 2800 * p * rnd(0.95, 1.05), 0.012, 4000); t += rnd(0.07, 0.12) } },
    (ch, p, out) => { tick(ch, out, 0, 2600 * p, 0.014, 4000); tick(ch, out, 0.09, 2700 * p, 0.01, 4000) },
    (ch, p, out) => { let t = 0; for (let i = 0; i < 5; i++) { tick(ch, out, t, 3000 * p * rnd(0.92, 1.06), 0.01, 4500); t += rnd(0.05, 0.08) } },
    (ch, p, out) => { // Eingabetaste: etwas tiefer
      tick(ch, out, 0, 2400 * p, 0.012, 3500)
      tick(ch, out, 0.14, 1700 * p, 0.016, 2500)
    },
  ],
  'terminal-end': [ // leises Piepen bei Ende
    (ch, p, out) => note(ch, { type: 'sine', f: 1320 * p, dur: 0.09, atk: 0.004, v: 0.018, out }),
    (ch, p, out) => { note(ch, { type: 'sine', f: 1180 * p, dur: 0.06, atk: 0.004, v: 0.016, out }); note(ch, { type: 'sine', f: 1570 * p, dur: 0.08, atk: 0.004, v: 0.016, t: 0.08, out }) },
    (ch, p, out) => note(ch, { type: 'triangle', f: 1480 * p, dur: 0.07, atk: 0.003, v: 0.014, lp: [3000, 1800, 1], out }),
    (ch, p, out) => { note(ch, { type: 'sine', f: 1400 * p, dur: 0.05, atk: 0.003, v: 0.014, out }); note(ch, { type: 'sine', f: 1400 * p, dur: 0.05, atk: 0.003, v: 0.012, t: 0.09, out }) },
  ],
  funkturm: [ // Funk-Zirpen / zwei Toene
    (ch, p, out) => note(ch, { type: 'sine', f: 1700 * p, to: 2500 * p, dur: 0.09, atk: 0.006, v: 0.022, out, send: 0.15 }),
    (ch, p, out) => { note(ch, { type: 'sine', f: 1200 * p, dur: 0.08, atk: 0.006, v: 0.02, out, send: 0.15 }); note(ch, { type: 'sine', f: 1600 * p, dur: 0.11, atk: 0.006, v: 0.02, t: 0.1, out, send: 0.15 }) },
    (ch, p, out) => { for (let i = 0; i < 3; i++) note(ch, { type: 'sine', f: (1900 + i * 180) * p, dur: 0.035, atk: 0.003, v: 0.016, t: i * 0.055, out }) },
    (ch, p, out) => { // kurzes Rauschen, dann Zirpen
      noise(ch, { bp: [2400 * p, 1800 * p, 1.2], dur: 0.08, atk: 0.01, v: 0.012, out })
      note(ch, { type: 'sine', f: 2200 * p, to: 1700 * p, dur: 0.08, atk: 0.005, v: 0.018, t: 0.08, out, send: 0.15 })
    },
  ],
  leitstand: [ // weiches Klicken
    (ch, p, out) => note(ch, { type: 'sine', f: 900 * p, to: 1050 * p, dur: 0.045, atk: 0.003, v: 0.026, lp: [3000, 1200, 1], out }),
    (ch, p, out) => { note(ch, { type: 'sine', f: 820 * p, dur: 0.04, atk: 0.003, v: 0.022, out }); note(ch, { type: 'sine', f: 980 * p, dur: 0.04, atk: 0.003, v: 0.02, t: 0.07, out }) },
    (ch, p, out) => { // Schalter: kleiner Ruck
      note(ch, { type: 'triangle', f: 600 * p, to: 480 * p, dur: 0.05, atk: 0.002, v: 0.024, lp: [2400, 900, 1], out })
      noise(ch, { hp: 3500, dur: 0.015, atk: 0.002, v: 0.01, out })
    },
    (ch, p, out) => note(ch, { type: 'sine', f: 1100 * p, to: 950 * p, dur: 0.05, atk: 0.003, v: 0.022, out, send: 0.08 }),
  ],
  pausenraum: [ // Tassenklirren / Seufzer
    (ch, p, out) => bell(ch, 2350 * p, 0, 0.35, 0.018, 0.25, 0, 2.76, out, 0.35),
    (ch, p, out) => { bell(ch, 2500 * p, 0, 0.3, 0.016, 0.25, 0, 2.76, out, 0.35); bell(ch, 2280 * p, 0.12, 0.35, 0.012, 0.25, 0, 2.76, out, 0.35) },
    (ch, p, out) => { for (let i = 0; i < 3; i++) bell(ch, 2900 * p * rnd(0.97, 1.03), i * 0.11, 0.18, 0.008, 0.2, 0, 2.76, out, 0.3) }, // Loeffel ruehrt
    (ch, p, out) => { // Seufzer-Ton: weiche, fallende Linie mit Hauch
      note(ch, { type: 'sine', f: 330 * p, to: 247 * p, dur: 0.6, atk: 0.12, v: 0.022, out, send: 0.25 })
      noise(ch, { bp: [900 * p, 500 * p, 0.8], dur: 0.5, atk: 0.15, v: 0.008, out })
    },
  ],
}
const PAN = { '-1': -0.6, '0': 0, '1': 0.6 }
function roomPan(id) {
  const key = id === 'terminal-end' ? 'terminal' : id
  const st = AB.stationById ? AB.stationById(key) : null
  return st ? (PAN[String(st.col)] || 0) : 0
}
function playRoom(ch, id) {
  const vars = ROOMS[id]
  if (!vars) return
  // Variante waehlen, nicht zweimal hintereinander dieselbe
  let i = Math.floor(Math.random() * vars.length)
  if (vars.length > 1 && i === ch.lastVar[id]) i = (i + 1) % vars.length
  ch.lastVar[id] = i
  const p = rnd(0.94, 1.06) // ±6 % Tonhoehe
  const out = bus(ch, roomPan(id), rnd(0.8, 1.1))
  vars[i](ch, p, out)
}

// ---------- Drosselung ----------
const LOUD = new Set(['wait', 'stop', 'alert', 'error'])
function allowed(ch, name) {
  const n = now()
  if (LOUD.has(name) || name === 'click') return true // wichtige Signale und direktes Feedback nie verschlucken
  if (ROOMS[name] || name === 'tool') {
    const key = name === 'terminal-end' ? 'terminal' : name
    if (n - (ch.lastSt[key] || -1e9) < 250) return false
    if (ch.voices > 24) return false
  }
  while (ch.recent.length && n - ch.recent[0] > 1000) ch.recent.shift()
  if (ch.recent.length >= 4) return false
  if (ROOMS[name] || name === 'tool') ch.lastSt[name === 'terminal-end' ? 'terminal' : name] = n
  ch.recent.push(n)
  return true
}

function play(name, ac) {
  const ch = chainFor(ac)
  const offline = window.OfflineAudioContext && ac instanceof window.OfflineAudioContext
  if (!offline && ac.state === 'suspended' && ac.resume) {
    try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}) } catch { /* egal */ }
  }
  if (ch.voices > 60) return
  if (!allowed(ch, name)) return
  try { if (SOUNDS[name]) SOUNDS[name](ch); else playRoom(ch, name) } catch (e) { console.error('[sound]', e) }
}

const ctxNow = () => (AB.Snd && AB.Snd.on && AB.Snd.ctx) || null
AB.soundOn = () => !!(AB.Snd && AB.Snd.on && AB.Snd.ctx)

AB.playSound = (art, ac) => {
  if (!SOUNDS[art] && !ROOMS[art]) return true // unbekannt: still
  const c = ac || ctxNow()
  if (!c) return true
  if (art === 'tool' && !ac) { play('leitstand', c); return true }
  if (art === 'tool') {
    // Der Kern ruft 'tool' kurz vor der Phase 'event'; dort kennen wir die Station.
    // Kommt kein Event hinterher (anderer Aufrufer), spielt der Leitstand.
    const ch = chainFor(c)
    ch.pendingTool = true
    Promise.resolve().then(() => { if (ch.pendingTool) { ch.pendingTool = false; play('leitstand', c) } })
    return true
  }
  play(art, c)
  return true
}
AB.soundSounds = Object.keys(SOUNDS).concat(Object.keys(ROOMS))

AB.setSoundVolume = (v) => {
  vol = Math.max(0, Math.min(1, v))
  const ac = AB.Snd && AB.Snd.ctx
  const ch = ac && chains.get(ac)
  if (ch) ch.master.gain.setTargetAtTime(gainOf(vol), ac.currentTime, 0.02)
  try { localStorage.setItem('ab-vol', String(vol)) } catch { /* egal */ }
}

// ---------- Ereignisse -> Raum-Klaenge ----------
if (AB.on) AB.on('event', (ev, silent) => {
  if (!ev) return
  const ac = AB.Snd && AB.Snd.ctx
  const ch = ac && chains.get(ac)
  if (ev.ev === '__reset') { if (ch) { ch.recent = []; ch.lastSt = {}; ch.lastVar = {}; ch.pendingTool = false } return }
  if (silent || !AB.soundOn()) return
  if (ev.ev === 'PreToolUse') {
    const st = AB.stationFor ? AB.stationFor(ev.tool) : null
    if (ch) ch.pendingTool = false
    play(st ? st.id : 'leitstand', ac)
  } else if (ev.ev === 'PostToolUse') {
    const st = AB.stationFor ? AB.stationFor(ev.tool) : null
    if (st && st.id === 'terminal') play('terminal-end', ac)
  } else if (ev.ev === 'SubagentStop') {
    // fertig -> ab in den Pausenraum: kurz danach ein Tassenklirren
    setTimeout(() => { if (AB.soundOn()) play('pausenraum', AB.Snd.ctx) }, 700)
  }
})

// ---------- Lo-Fi-Hintergrund (generativ, sehr leise) ----------
let lofiPref = false
try { lofiPref = localStorage.getItem('ab-lofi') === '1' } catch { /* egal */ }
const L = { ac: null, bus: null, crackle: null, timer: 0, next: 0, step: 0 }
// Akkorde in Hz (Grundton tief, dann Akkordtoene) - Fmaj7, Em7, Dm7, Cmaj7 / Am7 als Abwechslung
const CHORDS = [
  [87.31, 174.61, 220.0, 261.63, 329.63],
  [82.41, 164.81, 196.0, 246.94, 293.66],
  [73.42, 146.83, 174.61, 220.0, 261.63],
  [65.41, 130.81, 164.81, 196.0, 246.94],
]
const ALT = [110.0, 130.81, 164.81, 196.0, 261.63] // Am7
const MELO = [523.25, 587.33, 659.25, 783.99, 880.0] // Pentatonik
const BAR = 5.2

function crackleBuffer(ac) {
  const len = ac.sampleRate * 4
  const b = ac.createBuffer(1, len, ac.sampleRate)
  const d = b.getChannelData(0)
  let lp = 0
  for (let i = 0; i < len; i++) {
    lp += 0.08 * ((Math.random() * 2 - 1) - lp)
    d[i] = lp * 0.25 // leises Rauschen
    if (Math.random() < 0.00035) { // Knackser
      const a = rnd(0.2, 0.7) * (Math.random() < 0.5 ? -1 : 1)
      for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += a * Math.exp(-k / 6)
    }
  }
  return b
}

function pad(ch, f, t0, dur, v) {
  const ac = ch.ac
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(v, t0 + 1.2)
  g.gain.setValueAtTime(v, t0 + dur - 0.2)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 1.2)
  g.connect(L.bus)
  ;[['triangle', -7], ['sine', 6]].forEach(([type, det]) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det + rnd(-3, 3)
    o.connect(g); o.start(t0); o.stop(t0 + dur + 1.3)
  })
}

function scheduleLofi() {
  if (!L.ac || !L.bus) return
  const ch = chainFor(L.ac)
  while (L.next < L.ac.currentTime + 1.5) {
    const i = L.step % 4
    const chord = (i === 1 && Math.random() < 0.35) ? ALT : CHORDS[i]
    chord.forEach((f, k) => pad(ch, f, L.next + k * 0.03, BAR, k === 0 ? 0.016 : 0.008))
    if (Math.random() < 0.55) { // gelegentlich ein weicher Melodieton
      const f = MELO[Math.floor(Math.random() * MELO.length)]
      note(ch, { type: 'sine', f, dur: 1.6, atk: 0.04, v: 0.008, t: L.next - L.ac.currentTime + rnd(0.8, 3.2), out: L.bus, send: 0.3 })
    }
    L.next += BAR; L.step++
  }
}

function startLofi(ac) {
  if (L.ac) return
  const ch = chainFor(ac)
  L.ac = ac
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.5
  L.bus = ac.createGain(); L.bus.gain.setValueAtTime(0.0001, ac.currentTime)
  L.bus.gain.exponentialRampToValueAtTime(0.55, ac.currentTime + 3)
  L.bus.connect(lp); lp.connect(ch.master)
  L.lp = lp
  const src = ac.createBufferSource(); src.buffer = crackleBuffer(ac); src.loop = true
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900
  const cg = ac.createGain(); cg.gain.value = 0.05
  src.connect(hp); hp.connect(cg); cg.connect(L.bus)
  src.start()
  L.crackle = src
  L.next = ac.currentTime + 0.1
  scheduleLofi()
  L.timer = setInterval(scheduleLofi, 400)
}

function stopLofi() {
  if (!L.ac) return
  const ac = L.ac, bus = L.bus, src = L.crackle, lp = L.lp
  clearInterval(L.timer)
  try {
    bus.gain.cancelScheduledValues(ac.currentTime)
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ac.currentTime)
    bus.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6)
  } catch { /* egal */ }
  setTimeout(() => { try { src.stop(); bus.disconnect(); lp.disconnect() } catch { /* egal */ } }, 2600)
  L.ac = null; L.bus = null; L.crackle = null; L.lp = null; L.timer = 0
}

function syncLofi() {
  const want = lofiPref && AB.soundOn() && !document.hidden
  if (want && !L.ac) startLofi(AB.Snd.ctx)
  else if (!want && L.ac) stopLofi()
  const b = document.getElementById('ab-snd-lofi')
  if (b) {
    b.setAttribute('aria-pressed', String(lofiPref))
    b.classList.toggle('ab-snd-muted', lofiPref && !AB.soundOn())
  }
}
AB.lofiOn = () => lofiPref
AB.lofiPlaying = () => !!L.ac
AB.setLofi = (v) => {
  lofiPref = !!v
  try { localStorage.setItem('ab-lofi', lofiPref ? '1' : '0') } catch { /* egal */ }
  syncLofi()
}
document.addEventListener('visibilitychange', syncLofi)
setInterval(syncLofi, 1000) // Ton-Knopf und Taste M leben im Kern

// ---------- Regler + Musik-Schalter neben dem Ton-Knopf ----------
function addControls() {
  const btn = document.getElementById('b-sound')
  if (!btn || document.getElementById('ab-vol')) return
  const r = document.createElement('input')
  r.type = 'range'; r.id = 'ab-vol'; r.min = '0'; r.max = '1'; r.step = '0.05'; r.value = String(vol)
  r.setAttribute('aria-label', 'Lautstärke'); r.title = 'Lautstärke'
  r.style.cssText = 'width:72px;accent-color:#96491f;cursor:pointer;align-self:center;margin:0'
  r.addEventListener('input', () => AB.setSoundVolume(parseFloat(r.value)))
  r.addEventListener('change', () => { if (AB.Snd && AB.Snd.on) AB.Snd.play('click') })
  btn.insertAdjacentElement('afterend', r)

  const m = document.createElement('button')
  m.type = 'button'; m.id = 'ab-snd-lofi'; m.className = 'ab-snd-lofi'; m.textContent = 'Musik'
  m.setAttribute('aria-pressed', String(lofiPref))
  m.title = 'Leise Lo-Fi-Musik im Hintergrund (spielt nur, wenn der Ton an ist)'
  m.addEventListener('click', () => AB.setLofi(!lofiPref))
  r.insertAdjacentElement('afterend', m)
  btn.addEventListener('click', () => setTimeout(syncLofi, 0))

  const css = document.createElement('style')
  css.textContent = '.ab-snd-lofi{min-height:44px;padding:0 14px;font-size:.9rem;align-self:center}' +
    '.ab-snd-lofi.ab-snd-muted{opacity:.6}'
  document.head.append(css)
}
addControls()
})()
