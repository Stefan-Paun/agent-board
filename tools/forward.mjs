#!/usr/bin/env node
// Absender fuer den zweiten Rechner: verfolgt das lokale events.jsonl und schickt neue Ereignisse gebuendelt
// an POST /ingest eines Agent-Boards auf einem anderen Rechner (siehe docs/SECOND-MACHINE.md).
//   AGENT_BOARD_FORWARD_URL=http://board.example:4777 AGENT_BOARD_INGEST_TOKEN=... node tools/forward.mjs
// Optional: AGENT_BOARD_MACHINE=<name> (muss beim Empfaenger in AGENT_BOARD_INGEST_MACHINES stehen),
//   --once (einmal alles Neue senden und beenden), --from-start (beim ersten Lauf nicht am Dateiende beginnen).
// Gesendet werden nur die Felder der Feldliste aus ingest.mjs (cleanEvent): keine Pfade, keine Prompt-Texte,
// nichts, was das Board nicht ohnehin zeigt. Die Position steht in forward-state.json im Datenordner.
// Keine Abhaengigkeiten; laeuft unter Linux, macOS, Windows und WSL.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { openSync, readSync, closeSync, fstatSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENTS_FILE, DATA_DIR } from '../collector.mjs'
import { cleanEvent, machineOk, LIMITS } from '../ingest.mjs'

export const FORWARD = {
  maxEvents: LIMITS.maxEvents,
  maxBytes: 48 * 1024, // unter der 64-KB-Grenze des Empfaengers
  readChunk: 256 * 1024, // so viel wird je Schritt hoechstens aus dem Log gelesen
  maxLine: 16 * 1024, // laengere Zeilen schreibt der Collector nie: ueberspringen
  pollMs: 1000,
  backoffMinMs: 1000,
  backoffMaxMs: 60000,
  timeoutMs: 10000,
}

// Wartezeit nach dem n-ten Fehlversuch in Folge (1 s, 2 s, 4 s ... hoechstens 60 s)
export function backoffMs(failures, min = FORWARD.backoffMinMs, max = FORWARD.backoffMaxMs) {
  return Math.min(max, min * 2 ** Math.max(0, Math.min(30, failures - 1)))
}

// Ziel pruefen: nur http(s), ohne Zugangsdaten in der Adresse. Rueckgabe: URL von /ingest oder null.
export function ingestUrl(base) {
  let u
  try { u = new URL(String(base || '')) } catch { return null }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null
  return new URL('/ingest', u)
}

// Position: `offset` = bis hierhin ist das Log verbraucht; `last` = Bytes der letzten verbrauchten Zeile
// (als Buffer, in der Datei base64: so stimmt der Vergleich auch bei kaputtem UTF-8), `lastEnd` = Offset
// direkt hinter dieser Zeile. Mit `last` wird erkannt, ob der Collector die Datei inzwischen gekuerzt hat.
function loadState(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (s && Number.isSafeInteger(s.offset) && s.offset >= 0) {
      const last = typeof s.last === 'string' && s.last ? Buffer.from(s.last, 'base64') : null
      return { offset: s.offset, last, lastEnd: last && Number.isSafeInteger(s.lastEnd) ? s.lastEnd : s.offset }
    }
  } catch { /* noch keine Position */ }
  return null
}

const stateJson = (st) => JSON.stringify({ offset: st.offset, last: st.last ? st.last.toString('base64') : null, lastEnd: st.lastEnd })

function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, stateJson(state), { mode: 0o600 })
  try { renameSync(tmp, file) } catch { writeFileSync(file, stateJson(state), { mode: 0o600 }) } // Windows: Ziel evtl. gerade gesperrt
}

function readAt(fd, from, len) {
  const buf = Buffer.alloc(len)
  let got = 0
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, from + got)
    if (!n) break
    got += n
  }
  return buf.subarray(0, got)
}

// Stimmt die gemerkte Position noch? Der Collector kuerzt die Datei ab und zu (Rotation): dann steht vor
// `lastEnd` nicht mehr die zuletzt verbrauchte Zeile. In dem Fall hinter dieser Zeile weitermachen, und wenn
// es sie nicht mehr gibt, am Dateianfang (zu alte Ereignisse verwirft der Schritt danach ohnehin).
// Rueckgabe: { offset, last, lastEnd }.
export function resolveState(fd, size, state) {
  if (!state.last) return { offset: state.offset <= size ? state.offset : 0, last: null, lastEnd: 0 }
  const needle = Buffer.concat([state.last, Buffer.from('\n')])
  const from = state.lastEnd - needle.length
  if (state.offset <= size && state.lastEnd <= state.offset && from >= 0 && readAt(fd, from, needle.length).equals(needle) && (from === 0 || readAt(fd, from - 1, 1)[0] === 10)) return state
  const all = readAt(fd, 0, size)
  for (let at = all.lastIndexOf(needle); at >= 0; at = at > 0 ? all.lastIndexOf(needle, at - 1) : -1) {
    if (at === 0 || all[at - 1] === 10) return { offset: at + needle.length, last: state.last, lastEnd: at + needle.length }
  }
  return { offset: 0, last: null, lastEnd: 0 }
}

// Ab `offset` die naechsten vollstaendigen Zeilen lesen und ein Buendel bauen.
// Rueckgabe: { events, state (Position hinter der letzten verbrauchten Zeile), skipped }.
export function readBatch(file, state, now = Date.now(), limits = FORWARD) {
  let fd
  try { fd = openSync(file, 'r') } catch { return { events: [], state, skipped: 0 } }
  try {
    const size = fstatSync(fd).size
    let { offset, last, lastEnd } = resolveState(fd, size, state)
    const buf = readAt(fd, offset, Math.min(limits.readChunk, Math.max(0, size - offset)))
    const events = []
    let bytes = 0, skipped = 0, pos = 0
    while (events.length < limits.maxEvents) {
      const nl = buf.indexOf(10, pos)
      if (nl < 0) {
        // keine ganze Zeile mehr im Puffer: eine ueberlange Zeile ueberspringen, sonst auf den Rest warten
        if (buf.length - pos > limits.maxLine && buf.length === limits.readChunk) { offset += buf.length - pos; pos = buf.length; last = null; lastEnd = 0; skipped++ }
        break
      }
      const rawLine = buf.subarray(pos, nl)
      const line = rawLine.toString('utf8').replace(/\r$/, '')
      let ev = null
      if (line && rawLine.length <= limits.maxLine) {
        try {
          const raw = JSON.parse(line)
          // Ereignisse, die selbst schon von einem anderen Rechner stammen, nie weiterreichen (keine Schleifen)
          if (raw && typeof raw === 'object' && raw.machine == null) ev = cleanEvent(raw)
        } catch { /* kaputte Zeile */ }
      }
      if (ev && ev.t < now - LIMITS.maxAgeMs) ev = null // zu alt: der Empfaenger wuerde es verwerfen
      if (ev) {
        const size1 = Buffer.byteLength(JSON.stringify(ev)) + 1
        if (events.length && bytes + size1 > limits.maxBytes) break // passt erst ins naechste Buendel
        events.push(ev); bytes += size1
      } else if (line) skipped++
      offset += nl + 1 - pos
      pos = nl + 1
      // Anker fuer die Rotations-Erkennung: jede nicht-leere Zeile normaler Laenge (Leerzeilen aendern ihn nicht)
      if (rawLine.length && rawLine.length <= limits.maxLine) { last = Buffer.from(rawLine); lastEnd = offset }
    }
    return { events, state: { offset, last, lastEnd }, skipped }
  } finally { closeSync(fd) }
}

// Ein Buendel senden. Rueckgabe: { status } (0 = Netzwerkfehler oder Zeitueberschreitung).
export function post(url, token, machine, events, timeoutMs = FORWARD.timeoutMs) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ events }))
    const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length, Authorization: `Bearer ${token}` }
    if (machine) headers['X-Agent-Board-Machine'] = machine
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'POST', headers, timeout: timeoutMs }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode || 0 }))
      res.on('error', () => resolve({ status: 0 }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve({ status: 0 }))
    req.end(body)
  })
}

const HINTS = {
  400: 'refused (400): if the board allows more than one machine name, set AGENT_BOARD_MACHINE to one of them.',
  415: 'refused (415): something between this machine and the board changed the request (a proxy?).',
  429: 'the board asks to slow down (429), waiting.',
  401: 'token rejected (401): AGENT_BOARD_INGEST_TOKEN must be the same on both machines.',
  403: 'refused (403): the machine name is not in AGENT_BOARD_INGEST_MACHINES on the board, or the host name is not in AGENT_BOARD_HOSTS.',
  404: 'no /ingest there (404): the board runs without AGENT_BOARD_INGEST_TOKEN.',
}

// Ein Schritt: neues lesen, senden, Position merken. `send` ist austauschbar (Tests).
// Rueckgabe: { sent, status, idle (nichts Neues), retry (gleiches Buendel spaeter noch einmal) }.
export function createForwarder({ file = EVENTS_FILE, stateFile = join(DATA_DIR, 'forward-state.json'), url, token, machine = '', fromStart = false, now = () => Date.now(), send = post, log = () => {} }) {
  let state = loadState(stateFile)
  if (!state) {
    // erster Lauf: am Dateiende beginnen (keine alte Geschichte nachschicken), ausser mit --from-start
    state = { offset: 0, last: null, lastEnd: 0 }
    if (!fromStart) {
      try {
        const buf = readFileSync(file)
        const end = buf.lastIndexOf(10) + 1
        if (end) {
          const start = buf.lastIndexOf(10, end - 2) + 1
          const tail = buf.subarray(start, end - 1)
          state = { offset: end, last: tail.length && tail.length <= FORWARD.maxLine ? Buffer.from(tail) : null, lastEnd: end }
        }
      } catch { /* Datei gibt es noch nicht */ }
    }
    try { saveState(stateFile, state) } catch { /* beim naechsten Schritt */ }
  }
  let lastHint = 0
  const same = (a, b) => a.offset === b.offset && a.lastEnd === b.lastEnd && (a.last === b.last || (!!a.last && !!b.last && a.last.equals(b.last)))
  return {
    state: () => ({ ...state }),
    async step() {
      const b = readBatch(file, state, now())
      const moved = !same(b.state, state)
      const commit = () => { state = b.state; try { saveState(stateFile, state) } catch (e) { log(`could not save position: ${e.code || e.message}`) } }
      if (!b.events.length) { if (moved) commit(); return { sent: 0, status: 200, idle: !moved, retry: false } }
      const { status } = await send(url, token, machine, b.events)
      if (status >= 200 && status < 300) { lastHint = 0; commit(); return { sent: b.events.length, status, idle: false, retry: false } }
      // 413: genau dieses Buendel ist zu gross (sollte nie vorkommen) -> ueberspringen statt ewig wiederholen.
      // Alles andere (auch 400: meist eine Einstellung) bleibt liegen und wird spaeter noch einmal versucht.
      if (status === 413) { log(`batch rejected (413), skipped ${b.events.length} events`); commit(); return { sent: 0, status, idle: false, retry: false } }
      if (lastHint !== status) { log(HINTS[status] || (status ? `not accepted (status ${status}), trying again later` : 'board not reachable, trying again later')); lastHint = status }
      return { sent: 0, status, idle: false, retry: true }
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main(argv = process.argv.slice(2), env = process.env) {
  const log = (m) => console.error(`[forward] ${m}`)
  const url = ingestUrl(env.AGENT_BOARD_FORWARD_URL)
  const token = String(env.AGENT_BOARD_INGEST_TOKEN || '')
  const machine = String(env.AGENT_BOARD_MACHINE || '').trim().toLowerCase()
  if (!url) { log('Set AGENT_BOARD_FORWARD_URL to the board, e.g. http://board.example:4777 (http or https, no credentials in the URL).'); return 1 }
  if (token.length < LIMITS.minToken) { log(`Set AGENT_BOARD_INGEST_TOKEN (at least ${LIMITS.minToken} characters, the same value as on the board).`); return 1 }
  if (machine && !machineOk(machine)) { log('AGENT_BOARD_MACHINE: use a short name of a-z, 0-9 and "-" (at most 16 characters).'); return 1 }
  if (url.protocol === 'http:') log('Note: plain http. Use this only inside a private network (e.g. Tailscale or your own LAN).')
  const once = argv.includes('--once')
  const fw = createForwarder({ url, token, machine, fromStart: argv.includes('--from-start'), log })
  log(`forwarding to ${url.host}${machine ? ` as "${machine}"` : ''}`)
  let failures = 0
  for (;;) {
    const r = await fw.step()
    if (r.retry) {
      if (once) { log(`not sent (status ${r.status || 'network error'})`); return 1 }
      failures++
      await sleep(backoffMs(failures))
      continue
    }
    failures = 0
    if (r.idle) { if (once) return 0; await sleep(FORWARD.pollMs) }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((code) => process.exit(code), (e) => { console.error(`[forward] ${e.message}`); process.exit(1) })
