// fx/daycard.js: "Share card" - Tageswerte -> SVG-Text (1200 x 630), rein und ohne DOM, Netz oder Uhr.
// Laeuft im Browser (window.AgentBoardDayCard) und in Node (globalThis / test/daycard.test.mjs).
// Zulassungsliste statt Filter: render() liest NUR diese Felder von `input`:
//   dateMs, activeMs, sessions, tools, approvals (Zahlen), hours (24 Zahlen), title (optionaler Text).
// Alles andere (Projektnamen, Pfade, Befehle, Prompts, Agent-Namen, ...) wird nie angefasst und kann
// deshalb nicht in der Ausgabe landen. Die Ausgabe enthaelt keine Skripte, keine eingebetteten Dateien
// und keine Verweise; das einzige "http" ist der Namensraum xmlns des SVG-Wurzelelements.
(function (root) {
'use strict'

const W = 1200, H = 630
const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const MAX_NUM = 9999999, TITLE_MAX = 40, LABEL_MAX = 24
const THEMES = {
  light: { bg: '#f4ead7', frame: '#3a2c20', panel: '#fbf3e4', tile: '#eeddbf', line: '#ddc9a3', ink: '#3a2c20', dim: '#6f5a40', accent: '#3f6048', bar: '#96491f', wall: '#8a7a64' },
  dark: { bg: '#21222c', frame: '#6272a4', panel: '#282a36', tile: '#343746', line: '#44475a', ink: '#f8f8f2', dim: '#a9aed0', accent: '#50fa7b', bar: '#ffb86c', wall: '#6272a4' },
}
const ROOMS = ['#5f8f5a', '#b5653a', '#4f7a96', '#7d5f80', '#a68a2e', '#8a7a64'] // wie die Raumfarben im Board
const DEFAULT_LABELS = { title: 'Day summary', active: 'active time', sessions: 'Sessions', tools: 'Tool calls', approvals: 'Approvals', hours: 'by hour' }

// Text -> sicherer SVG-Text: Steuerzeichen und einzelne Surrogate raus, Leerraum zusammenfassen,
// auf n Zeichen kuerzen, dann maskieren. Nur hier entsteht Text aus freien Eingaben.
function clean(s, n) {
  let t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/\s+/g, ' ').trim()
  const cp = Array.from(t)
  if (cp.length > n) t = cp.slice(0, n - 1).join('').trimEnd() + '…'
  return esc(t)
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const num = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(MAX_NUM, Math.max(0, n)) : 0 }
// Tausendertrennung: Komma (en), Punkt (de, es)
function fmtInt(n, lang) {
  const sep = lang === 'de' || lang === 'es' ? '.' : ','
  return String(num(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}
// "45 s", "12 min", "1 h 05 min" (wie fmtActive in daystats.js)
function fmtDur(ms) {
  const v = Math.min(99 * 3600000 + 59 * 60000, Math.max(0, Number(ms) || 0))
  const m = Math.floor(v / 60000)
  if (m < 1) return `${Math.round(v / 1000)} s`
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
// lokales Datum als JJJJ-MM-TT; ungueltig -> ''
function fmtDate(ms) {
  const d = new Date(Number(ms))
  if (!Number.isFinite(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function render(input, opts) {
  const inp = input && typeof input === 'object' ? input : {}
  const o = opts && typeof opts === 'object' ? opts : {}
  const th = THEMES[o.theme === 'dark' ? 'dark' : 'light']
  const lang = o.lang === 'de' || o.lang === 'es' ? o.lang : 'en'
  const lb = {}
  for (const k of Object.keys(DEFAULT_LABELS)) lb[k] = clean(o.labels && typeof o.labels[k] === 'string' && o.labels[k].trim() ? o.labels[k] : DEFAULT_LABELS[k], LABEL_MAX)
  const title = typeof inp.title === 'string' && inp.title.trim() ? clean(inp.title, TITLE_MAX) : lb.title
  const date = fmtDate(inp.dateMs)
  const active = fmtDur(inp.activeMs)
  const tiles = [[lb.sessions, num(inp.sessions)], [lb.tools, num(inp.tools)], [lb.approvals, num(inp.approvals)]]
  const hrs = Array.from({ length: 24 }, (_, i) => Math.max(0, Number(Array.isArray(inp.hours) ? inp.hours[i] : 0)) || 0)
  const maxH = Math.max(...hrs)

  const out = []
  const rect = (x, y, w, h, fill) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`)
  const text = (s, x, y, size, fill, anchor, bold) => out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}${bold ? ' font-weight="700"' : ''}>${s}</text>`)

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" font-family="${FONT}" shape-rendering="crispEdges">`)
  out.push(`<title>${title}${date ? ' · ' + date : ''}</title>`)
  rect(0, 0, W, H, th.bg); rect(16, 16, W - 32, H - 32, th.frame); rect(22, 22, W - 44, H - 44, th.panel)
  text(title, 60, 90, 44, th.ink, '', true)
  if (date) text(date, W - 60, 90, 32, th.dim, 'end')
  rect(60, 112, W - 120, 4, th.line)

  text(esc(active), 60, 236, 108, th.accent, '', true)
  text(lb.active, 66, 280, 28, th.dim)

  // kleines Board-Motiv: Grundriss mit sechs Raeumen, Tueren und einer Figur
  const bx = 880, by = 150, rw = 86, rh = 62, g = 6
  rect(bx - 8, by - 8, 3 * rw + 2 * g + 16, 2 * rh + g + 16, th.wall)
  ROOMS.forEach((c, i) => {
    const x = bx + (i % 3) * (rw + g), y = by + Math.floor(i / 3) * (rh + g)
    rect(x, y, rw, rh, c); rect(x + 6, y + 6, rw - 12, 8, 'rgba(255,255,255,0.28)')
    rect(x + rw / 2 - 8, y + (i < 3 ? rh - 6 : 0), 16, 6, th.panel)
  })
  rect(bx + rw + g + 36, by + 28, 12, 12, th.panel); rect(bx + rw + g + 38, by + 30, 8, 8, th.ink)

  tiles.forEach(([k, v], i) => {
    const x = 60 + i * 364, y = 316
    rect(x, y, 340, 118, th.frame); rect(x + 4, y + 4, 332, 110, th.tile)
    text(fmtInt(v, lang), x + 24, y + 70, 60, th.ink, '', true)
    text(k, x + 24, y + 100, 22, th.dim)
  })

  text(lb.hours, 60, 470, 20, th.dim)
  const cw = 45, base = 560, maxBar = 70
  hrs.forEach((v, i) => {
    const x = 60 + i * cw
    if (v > 0 && maxH > 0) { const h = Math.max(6, Math.round(maxBar * v / maxH)); rect(x, base - h, cw - 5, h, th.bar) }
    else rect(x, base - 3, cw - 5, 3, th.line)
  })
  for (const h of [0, 6, 12, 18]) text(String(h), 60 + h * cw, 592, 18, th.dim)
  text('agent-board', W - 60, 592, 18, th.dim, 'end', true)
  out.push('</svg>')
  return out.join('\n')
}

root.AgentBoardDayCard = { render, clean, fmtInt, fmtDur, fmtDate, WIDTH: W, HEIGHT: H }
})(typeof window !== 'undefined' ? window : globalThis)
