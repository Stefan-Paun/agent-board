// Lokaler Server: liefert die Seite aus und streamt events.jsonl per SSE.
// Bindet nur an 127.0.0.1 und prueft den Host-Header.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { extname, join, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { EVENTS_FILE, DATA_DIR } from './collector.mjs'

const PORT = Number(process.env.AGENT_BOARD_PORT || 4777)
const HOST = '127.0.0.1'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'public')
const REPLAY_LINES = 400
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png',
}
const STATUS_FILE = join(DATA_DIR, 'status.json')
const SUBAGENTS_FILE = join(DATA_DIR, 'subagents.json')
// Subagent-Zeilen, die so lange nicht mehr aktualisiert wurden, gelten als vorbei
const SUBAGENTS_STALE_MS = 60000
// Zusaetzlich erlaubte Host-Header (z.B. Tailscale-Name), kommagetrennt; Standard: keine
const ALLOW_HOSTS = String(process.env.AGENT_BOARD_ALLOW_HOST || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

// Alles kommt vom eigenen Server; Inline-Styles nur fuer das <style> in index.html, data:/blob: fuer das Favicon
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

const clients = new Set()
let offset = 0

function readLines(from, to) {
  const len = to - from
  if (len <= 0) return []
  const buf = Buffer.alloc(len)
  const fd = openSync(EVENTS_FILE, 'r')
  try { readSync(fd, buf, 0, len, from) } finally { closeSync(fd) }
  return buf.toString('utf8').split('\n').filter(Boolean)
}

function size() {
  try { return statSync(EVENTS_FILE).size } catch { return 0 }
}

// Replay nur bis zum bereits verteilten Offset, den Rest liefert poll():
// so kommt jede Zeile genau einmal an.
function lastLines() {
  try {
    return readLines(0, offset).slice(-REPLAY_LINES)
  } catch { return [] }
}

function poll() {
  const now = size()
  if (now < offset) offset = now // Datei wurde gekuerzt (Rotation): alte Zeilen nicht erneut als Live-Ereignisse senden
  if (now <= offset) return
  // nur vollstaendige Zeilen verschicken: eine gerade halb geschriebene Zeile kommt beim naechsten Mal
  const buf = Buffer.alloc(now - offset)
  const fd = openSync(EVENTS_FILE, 'r')
  try { readSync(fd, buf, 0, buf.length, offset) } finally { closeSync(fd) }
  const end = buf.lastIndexOf(10)
  if (end < 0) return
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue
    for (const res of clients) res.write(`event: ev\ndata: ${line}\n\n`)
  }
  offset += end + 1
}

export function hostOk(host, allow = ALLOW_HOSTS) {
  if (host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`) return true
  const h = String(host || '').toLowerCase()
  return allow.length > 0 && (allow.includes(h) || allow.includes(h.replace(/:\d+$/, '')))
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

// status.json + subagents.json zu einem Objekt zusammenfuehren (null, wenn es beides nicht gibt)
export function mergedStatus(now = Date.now(), st = readJson(STATUS_FILE), sub = readJson(SUBAGENTS_FILE)) {
  if (!st && !sub) return null
  const out = { ...(st && typeof st === 'object' ? st : {}) }
  const fresh = sub && Array.isArray(sub.subagents) && now - (Number(sub.t) || 0) < SUBAGENTS_STALE_MS
  out.subagents = fresh ? sub.subagents : []
  return out
}

// Tagesbilanz (/day): dieselbe reine Auswertung wie im Browser (public/fx/daystats.js), nur ueber die
// ganze events.jsonl statt nur ueber das Replay. Antwortet nur mit Zaehlern und Dauern.
const DayStats = (() => {
  const ctx = {}
  vm.runInNewContext(readFileSync(join(ROOT, 'fx', 'daystats.js'), 'utf8'), ctx)
  return ctx.AgentBoardDayStats
})()

export function daySummary(from, to, text = (() => { try { return readFileSync(EVENTS_FILE, 'utf8') } catch { return '' } })()) {
  const evs = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { const e = JSON.parse(line); if (e && e.t >= from && e.t < to) evs.push(e) } catch { /* kaputte Zeile */ }
  }
  return DayStats.summarize(evs, from, to)
}

let lastStatus = null // zuletzt verteilter Status als JSON-Text

function pollStatus() {
  const m = mergedStatus()
  const txt = m ? JSON.stringify(m) : null
  if (txt === lastStatus) return
  lastStatus = txt
  if (txt) for (const res of clients) res.write(`event: status\ndata: ${txt}\n\n`)
}

// Anzahl Zeilen und Zeit des letzten Ereignisses fuer /health
function health() {
  let events = 0, lastEventAt = null
  try {
    const buf = readFileSync(EVENTS_FILE)
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) events++
    const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString('utf8').split('\n').filter(Boolean).pop()
    if (tail) lastEventAt = Number(JSON.parse(tail).t) || null
  } catch { /* noch keine Ereignisse */ }
  return { ok: true, events, bytes: size(), lastEventAt, clients: clients.size }
}

export const server = createServer((req, res) => {
  if (!hostOk(req.headers.host || '')) { res.writeHead(403).end('forbidden'); return }
  let url
  try { url = new URL(req.url, `http://${HOST}:${PORT}`) } catch { res.writeHead(400).end('bad request'); return }

  if (url.pathname === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'max-age=86400' }).end(); return }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(health()))
    return
  }

  if (url.pathname === '/day') {
    // from/to in ms (Tagesgrenzen kommen vom Browser, damit seine Zeitzone gilt), hoechstens 2 Tage
    const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 2 * 86400e3) { res.writeHead(400).end('bad range'); return }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(daySummary(from, to)))
    return
  }

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    const batch = lastLines().map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    res.write(`event: replay\ndata: ${JSON.stringify(batch)}\n\n`)
    const st = mergedStatus()
    if (st) res.write(`event: status\ndata: ${JSON.stringify(st)}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const file = join(ROOT, rel)
  if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP,
  })
  createReadStream(file).pipe(res)
})

// kaputte Anfragen beenden nur die eine Verbindung, nie den Server
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); else socket.destroy() })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  offset = size() // bestehende Zeilen kommen beim ersten Verbindungsaufbau per Replay
  try { // nicht mitten in einer halb geschriebenen Zeile anfangen
    if (offset) { const tail = readFileSync(EVENTS_FILE).subarray(0, offset); offset = tail.lastIndexOf(10) + 1 }
  } catch { offset = 0 }
  setInterval(poll, 250)
  lastStatus = (() => { const m = mergedStatus(); return m ? JSON.stringify(m) : null })()
  setInterval(pollStatus, 1000)
  // Herzschlag: EventSource verwirft Ereignisse ohne data-Zeile, daher mit Zeitstempel
  setInterval(() => { const msg = `event: ping\ndata: ${Date.now()}\n\n`; for (const res of clients) res.write(msg) }, 15000)
  server.listen(PORT, HOST, () => console.log(`Agent-Board laeuft auf http://localhost:${PORT}`))
}
