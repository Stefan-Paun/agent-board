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

// ---------- Werkzeugnamen kuerzen (Karte, Zeitleiste, Tagesbilanz) ----------
// "mcp__github__create_issue" -> "github · create_issue"; Plugin-/claude.ai-Praefixe fallen weg
// ("mcp__plugin_x_y__t" -> "y", "mcp__claude_ai_Gmail__t" -> "gmail"). Server- und Werkzeugnamen
// werden bereinigt und gekuerzt, weil sie persoenliche Anteile enthalten koennen. Skill-Aufrufe
// (Werkzeug "Skill", Name steht in `what`) bekommen kind 'skill'. Alles andere bleibt unveraendert.
const SERVER_MAX = 16, TOOL_MAX = 28, SKILL_MAX = 32
const clipTo = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + ELL : s)
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()

function cleanServer(raw) {
  let s = clean(raw)
  if (/^plugin_/i.test(s)) { const r = s.slice(7); const i = r.lastIndexOf('_'); s = i >= 0 && i < r.length - 1 ? r.slice(i + 1) : r }
  else if (/^claude_ai_/i.test(s)) s = s.slice(10)
  s = s.toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').replace(/^-+|-+$/g, '')
  return clipTo(s || 'mcp', SERVER_MAX)
}

// parseTool(tool, what) -> { kind: 'mcp'|'skill'|'tool', label, target, server?, tool?, name? }
// target = der Rest, der hinter dem Label steht (bei Skills leer, weil der Name schon im Label ist)
function parseTool(tool, what) {
  const raw = typeof tool === 'string' ? tool.trim() : ''
  const w = clean(what)
  if (raw === 'Skill') {
    const name = clipTo(w, SKILL_MAX)
    return { kind: 'skill', name, label: name || 'Skill', target: '' }
  }
  const m = /^mcp__(.*?)(?:__(.*))?$/s.exec(raw)
  if (m && m[1]) {
    const server = cleanServer(m[1])
    const t = clipTo(clean(m[2]), TOOL_MAX)
    return { kind: 'mcp', server, tool: t, label: t ? `${server} · ${t}` : server, target: w }
  }
  return { kind: 'tool', label: raw, target: w }
}

root.AgentBoardLabels = { ellipsize, fitLabel, deskSubtitle, parseTool }
})(typeof window !== 'undefined' ? window : globalThis)
