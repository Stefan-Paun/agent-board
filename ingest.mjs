// Zweiter Rechner (opt-in): Empfaenger-Logik fuer POST /ingest und die gemeinsame Feldpruefung.
// Nur aktiv, wenn AGENT_BOARD_INGEST_TOKEN gesetzt ist (mindestens 32 Zeichen). Ohne Token gibt es die
// Route nicht (404) und der Server bleibt nur lesend.
// Jedes entfernte Ereignis wird Feld fuer Feld neu aufgebaut (unbekannte Felder fallen weg, Typen und
// Laengen werden geprueft) und bekommt serverseitig `machine` sowie den Vorsatz `<machine>~` vor sid, aid
// und tid. Lokale Ereignisse haben nie `machine` und nie ein `~` aus diesem Weg: ein entfernter Absender
// kann deshalb keine lokale Session ueberschreiben und sich nicht als lokal ausgeben.
// tools/forward.mjs nutzt dieselbe Feldliste, damit nichts den zweiten Rechner verlaesst, was hier ohnehin wegfiele.
import { createHash, timingSafeEqual } from 'node:crypto'
import { redact } from './collector.mjs'

export const LIMITS = {
  minToken: 32,
  maxBody: 64 * 1024, // Bytes je Anfrage
  maxEvents: 50, // Ereignisse je Anfrage
  rateMax: 120, // Anfragen je Absender-Adresse ...
  rateWindowMs: 60000, // ... in diesem Fenster
  rateKeys: 500, // so viele Absender-Adressen merkt sich der Zaehler hoechstens
  maxAgeMs: 3600e3, // aeltere Ereignisse werden verworfen (das Board ist eine Live-Ansicht)
}

const MACHINE_RE = /^[a-z0-9][a-z0-9-]{0,15}$/
// Namen, die wie "dieser Rechner" oder wie eine Quelle aussehen, sind als Maschinenname gesperrt
const RESERVED = new Set(['local', 'localhost', 'this', 'all', 'claude', 'codex', 'gemini'])
export const DEFAULT_MACHINE = 'remote'

export function machineOk(name) { return typeof name === 'string' && MACHINE_RE.test(name) && !RESERVED.has(name) }

// Einstellungen aus der Umgebung. `error` ist gesetzt, wenn der Modus gewollt, aber falsch eingestellt ist:
// der Server startet dann nicht (und die Route bleibt aus).
export function ingestConfig(env = process.env) {
  const token = String(env.AGENT_BOARD_INGEST_TOKEN || '')
  if (!token) return { enabled: false, token: '', machines: [], error: null }
  const off = (error) => ({ enabled: false, token: '', machines: [], error })
  if (token.length < LIMITS.minToken) return off(`AGENT_BOARD_INGEST_TOKEN is too short: use at least ${LIMITS.minToken} characters (e.g. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").`)
  if (/\s/.test(token)) return off('AGENT_BOARD_INGEST_TOKEN must not contain whitespace.')
  if (new Set(token).size < 8) return off('AGENT_BOARD_INGEST_TOKEN is too simple: use a random value.')
  const raw = String(env.AGENT_BOARD_INGEST_MACHINES || '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)
  const machines = raw.length ? [...new Set(raw)] : [DEFAULT_MACHINE]
  const bad = machines.find((m) => !machineOk(m))
  if (bad !== undefined) return off(`AGENT_BOARD_INGEST_MACHINES: "${bad.slice(0, 20)}" is not allowed. Use short names of a-z, 0-9 and "-" (at most 16 characters; not local, this, all, claude, codex, gemini).`)
  if (machines.length > 8) return off('AGENT_BOARD_INGEST_MACHINES: at most 8 names.')
  return { enabled: true, token, machines, error: null }
}

// Vergleich in konstanter Zeit: beide Seiten werden gehasht, dann sind die Puffer immer gleich lang
export function tokenOk(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string' || !token) return false
  const h = (s) => createHash('sha256').update(s, 'utf8').digest()
  return timingSafeEqual(h(given), h(token))
}

// "Authorization: Bearer <token>" -> Token oder ''
export function bearer(header) {
  const m = /^Bearer[ ]+(\S+)$/i.exec(String(header || '').trim())
  return m ? m[1] : ''
}

// Ratenlimit je Absender: festes Zeitfenster, Speicher begrenzt
export function createLimiter({ max = LIMITS.rateMax, windowMs = LIMITS.rateWindowMs, maxKeys = LIMITS.rateKeys } = {}) {
  const seen = new Map() // Adresse -> { start, n }
  return {
    // true = Anfrage erlaubt
    take(key, now = Date.now()) {
      key = String(key || '?')
      let e = seen.get(key)
      if (!e || now - e.start >= windowMs) {
        if (!e && seen.size >= maxKeys) {
          for (const [k, v] of seen) if (now - v.start >= windowMs) seen.delete(k)
          if (seen.size >= maxKeys) return false // zu viele verschiedene Absender: lieber ablehnen als wachsen
        }
        e = { start: now, n: 0 }
        seen.set(key, e)
      }
      e.n++
      return e.n <= max
    },
    size: () => seen.size,
  }
}

// ---------- Feldpruefung ----------
// Steuerzeichen, Zeilentrenner und Richtungswechsel-Zeichen fliegen raus, Leerraum wird zusammengezogen
const clean = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// Text: nur echte Strings, bereinigt, gekuerzt; leer -> undefined (Feld faellt weg)
const text = (v, n) => { if (typeof v !== 'string') return undefined; const s = clip(clean(v), n); return s || undefined }
// wie text, zusaetzlich die Schwaerzung des Collectors (schadet schon geschwaerzten Texten nicht)
const secretFree = (v, n) => { if (typeof v !== 'string') return undefined; const s = clip(redact(clean(v)), n); return s || undefined }
// Kennungen: nur Buchstaben, Ziffern, _ und -
const ident = (v, n) => (typeof v === 'string' && v.length <= n && /^[A-Za-z0-9_-]+$/.test(v) ? v : undefined)
const count = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : undefined)

const EV_RE = /^[A-Z][A-Za-z]{2,39}$/
const SOURCES = new Set(['codex', 'gemini'])
// Feldliste der Ereignisse (siehe reduce() in collector.mjs und docs/FX-API.md). sid/aid/tid/t/ev stehen unten gesondert.
const FIELDS = {
  at: (v) => text(v, 40),
  proj: (v) => { const s = text(v, 200); return s ? clip(s.split(/[\\/]/).filter(Boolean).pop() || '', 40) || undefined : undefined },
  src: (v) => (SOURCES.has(v) ? v : undefined),
  tool: (v) => text(v, 40),
  what: (v) => secretFree(v, 48),
  todos: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
    const c = { done: count(v.done, 500) || 0, progress: count(v.progress, 500) || 0, open: count(v.open, 500) || 0 }
    return c
  },
  ok: (v) => (v === false ? false : undefined),
  len: (v) => count(v, 10_000_000),
  msg: (v) => secretFree(v, 80),
  nt: (v) => text(v, 40),
  dur: (v) => count(v, 86400e3),
  err: (v) => secretFree(v, 40),
  trig: (v) => text(v, 12),
  task: (v) => secretFree(v, 60),
}
export const EVENT_FIELDS = ['t', 'ev', 'sid', 'aid', 'tid', ...Object.keys(FIELDS)]

// Ein Ereignis gegen die Feldliste pruefen. Rueckgabe: bereinigtes Ereignis OHNE machine (so verlaesst es
// den zweiten Rechner) oder null, wenn Pflichtfelder fehlen oder kaputt sind.
export function cleanEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || raw.t <= 0) return null
  if (typeof raw.ev !== 'string' || !EV_RE.test(raw.ev)) return null
  const sid = ident(raw.sid, 8)
  if (!sid) return null
  const out = { t: Math.floor(raw.t), ev: raw.ev, sid }
  if (raw.aid != null) {
    const aid = ident(raw.aid, 24)
    if (!aid) return null // ein Subagent-Ereignis ohne brauchbare Kennung wuerde sonst der Hauptfigur zugeschrieben
    out.aid = aid
  }
  const tid = ident(raw.tid, 12)
  if (tid) out.tid = tid
  for (const [k, fn] of Object.entries(FIELDS)) {
    if (raw[k] == null) continue
    const v = fn(raw[k])
    if (v !== undefined) out[k] = v
  }
  return out
}

// Empfaengerseite: pruefen, Zeit begrenzen, Namensraum der Maschine davorsetzen und `machine` stempeln.
// `machine` kommt nie aus dem Ereignis selbst, nur aus der Zulassungsliste des Servers.
export function stampEvent(raw, machine, now = Date.now()) {
  if (!machineOk(machine)) return null
  const e = cleanEvent(raw)
  if (!e) return null
  if (e.t < now - LIMITS.maxAgeMs) return null
  if (e.t > now) e.t = now // Uhr des zweiten Rechners geht vor
  const rec = { t: e.t, ev: e.ev, sid: `${machine}~${e.sid}`, machine }
  if (e.aid) rec.aid = `${machine}~${e.aid}`
  if (e.tid) rec.tid = `${machine}~${e.tid}`
  for (const k of Object.keys(FIELDS)) if (e[k] !== undefined) rec[k] = e[k]
  return rec
}

// Anfragekoerper mit harter Obergrenze lesen. Rueckgabe: Buffer oder null (zu gross / abgebrochen).
function readBody(req, max) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0, done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => {
      if (done) return
      size += c.length
      if (size > max) { finish(null); return }
      chunks.push(c)
    })
    req.on('end', () => finish(Buffer.concat(chunks)))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}

// POST /ingest. `append(records)` schreibt die geprueften Ereignisse ins Log (collector.appendRecords).
// Antworten: 404 Modus aus, 405 falsche Methode, 429 Ratenlimit, 401 Token, 415 Typ, 413 zu gross,
// 400 kaputt, 403 Maschinenname nicht zugelassen, 200 { ok, accepted, dropped }.
export function createIngest({ config, append, limiter = createLimiter(), now = () => Date.now() }) {
  const reply = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body))
  }
  // Fehler vor dem Lesen des Koerpers: Verbindung danach schliessen, damit kein Rest gelesen werden muss
  const refuse = (req, res, status, error, headers = {}) => {
    reply(res, status, { ok: false, error }, { Connection: 'close', ...headers })
    req.resume()
  }
  return async function handleIngest(req, res) {
    if (!config || !config.enabled) { res.writeHead(404).end('not found'); return }
    if (req.method !== 'POST') { refuse(req, res, 405, 'method', { Allow: 'POST' }); return }
    if (!limiter.take(req.socket.remoteAddress, now())) { refuse(req, res, 429, 'rate limit', { 'Retry-After': String(Math.ceil(LIMITS.rateWindowMs / 1000)) }); return }
    if (!tokenOk(bearer(req.headers.authorization), config.token)) { refuse(req, res, 401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' }); return }
    if (!/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''))) { refuse(req, res, 415, 'content type'); return }
    const named = req.headers['x-agent-board-machine']
    const machine = named == null || named === '' ? (config.machines.length === 1 ? config.machines[0] : null) : String(named).trim().toLowerCase()
    if (machine === null) { refuse(req, res, 400, 'machine header missing'); return }
    if (!config.machines.includes(machine)) { refuse(req, res, 403, 'machine not allowed'); return }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > LIMITS.maxBody) { refuse(req, res, 413, 'body too large'); return }
    const body = await readBody(req, LIMITS.maxBody)
    if (!body) { refuse(req, res, 413, 'body too large'); return }
    let data
    try { data = JSON.parse(body.toString('utf8')) } catch { reply(res, 400, { ok: false, error: 'bad json' }); return }
    const list = data && typeof data === 'object' && !Array.isArray(data) ? data.events : null
    if (!Array.isArray(list)) { reply(res, 400, { ok: false, error: 'events missing' }); return }
    if (list.length > LIMITS.maxEvents) { reply(res, 413, { ok: false, error: 'too many events' }); return }
    const t = now()
    const recs = []
    for (const raw of list) { const r = stampEvent(raw, machine, t); if (r) recs.push(r) }
    try { if (recs.length) append(recs) } catch { reply(res, 500, { ok: false, error: 'write failed' }); return }
    reply(res, 200, { ok: true, accepted: recs.length, dropped: list.length - recs.length })
  }
}
