// Beschriftungen unter den Schreibtischen in die Breite eines Tisches einpassen, damit sich bei
// 3-4 Tischen Namen und "Projekt · arbeitet" nicht ineinanderschieben. Reine Funktionen ohne DOM:
// gemessen wird ueber measure(text, px) -> Breite in CSS-Pixeln (im Browser: canvas measureText,
// im Test: eine Attrappe). Getestet in test/labels.test.mjs.
(function (root) {
'use strict'
const ELL = '…'

// Text auf hoechstens maxW kuerzen, mit "…" am Ende (laengster Anfang, der noch passt)
function ellipsize(text, maxW, measure) {
  if (measure(text) <= maxW) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(text.slice(0, mid).trimEnd() + ELL) <= maxW) lo = mid; else hi = mid - 1
  }
  if (lo > 0) return text.slice(0, lo).trimEnd() + ELL
  return measure(ELL) <= maxW ? ELL : ''
}

// Groesste ganze Schriftgroesse zwischen minPx und px, bei der text in maxW passt (sonst minPx)
function shrinkTo(text, px, minPx, maxW, measure) {
  let p = Math.round(px)
  const lo = Math.min(p, Math.round(minPx))
  while (p > lo && measure(text, p) > maxW) p--
  return p
}

// Ein Label einpassen: erst die Schrift etwas verkleinern (bis minPx), erst dann mit "…" kuerzen.
// Ohne Breitengrenze (maxW = Infinity, z.B. nur ein Tisch) bleibt alles wie es ist.
function fitLabel(text, px, minPx, maxW, measure) {
  if (!(maxW < Infinity) || measure(text, px) <= maxW) return { text, px }
  const p = shrinkTo(text, px, minPx, maxW, measure)
  if (measure(text, p) <= maxW) return { text, px: p }
  return { text: ellipsize(text, maxW, (s) => measure(s, p)), px: p }
}

// Untertitel eines Tisches: "projekt · arbeitet". Passt er nicht, wird erst die Schrift kleiner,
// dann der Projektname gekuerzt ("agent-b… · arbeitet") - der Zustand bleibt immer lesbar.
// Bleibt fuer den Projektnamen fast nichts uebrig, steht nur noch der Zustand da.
function deskSubtitle(proj, word, px, minPx, maxW, measure) {
  if (!proj) return fitLabel(word, px, minPx, maxW, measure)
  const full = `${proj} · ${word}`
  if (!(maxW < Infinity) || measure(full, px) <= maxW) return { text: full, px }
  const p = shrinkTo(full, px, minPx, maxW, measure)
  if (measure(full, p) <= maxW) return { text: full, px: p }
  const tail = ` · ${word}`
  const room = maxW - measure(tail, p)
  const short = room > 0 ? ellipsize(proj, room, (s) => measure(s, p)) : ''
  // mindestens zwei Zeichen vom Projekt plus "…", sonst lohnt es nicht
  if (short.length >= 3) return { text: short + tail, px: p }
  return fitLabel(word, px, minPx, maxW, measure)
}

root.AgentBoardLabels = { ellipsize, fitLabel, deskSubtitle }
})(typeof window !== 'undefined' ? window : globalThis)
