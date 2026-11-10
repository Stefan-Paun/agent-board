// Read-only window over events.jsonl for the time machine (GET /replay?from=&to= in server.mjs).
// The file is read as a stream (never loaded whole) and the answer is written as NDJSON: one line per
// event, exactly the line from the log, i.e. the same fields as the live protocol and nothing else.
// Hard caps: number of events, bytes written, line length, concurrent requests. The last line is a
// control line {"ev":"__end","n":<count>,"truncated":<bool>} so the client knows if the window was cut.
import { createReadStream, existsSync } from 'node:fs'

export const LIMITS = {
  maxEvents: 20000,
  maxBytes: 8 * 1024 * 1024,
  maxLine: 64 * 1024, // longer log lines are skipped (the collector never writes such lines)
  maxSpan: 2 * 86400e3, // widest window, like /day
  maxActive: 2, // concurrent scans
}

// from/to (ms timestamps) from the query string; null if missing, not numeric, empty or too wide.
export function parseWindow(params, limits = LIMITS) {
  const num = (k) => { const v = params.get(k); return v == null || v.trim() === '' ? NaN : Number(v) }
  const from = num('from'), to = num('to')
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > limits.maxSpan) return null
  return { from, to }
}

// An event line from the log: a JSON object with a string `ev` and a numeric `t`.
function parseEvent(line) {
  try {
    const e = JSON.parse(line)
    return e && typeof e === 'object' && !Array.isArray(e) && typeof e.ev === 'string' && Number.isFinite(Number(e.t)) ? e : null
  } catch { return null }
}

// Scan `input` (async iterable of Buffers) and call write(string) for every event with from <= t < to.
// Returns { n, truncated }. Broken, oversized and foreign lines are skipped.
export async function scanWindow(input, from, to, write, limits = LIMITS) {
  let n = 0, bytes = 0, truncated = false
  let rest = Buffer.alloc(0), skipping = false
  const take = (buf) => {
    const line = buf.toString('utf8').replace(/\r$/, '')
    if (!line) return true
    const e = parseEvent(line)
    if (!e) return true
    const t = Number(e.t)
    if (t < from || t >= to) return true
    const size = Buffer.byteLength(line) + 1
    if (n >= limits.maxEvents || bytes + size > limits.maxBytes) { truncated = true; return false }
    n++; bytes += size
    write(line + '\n')
    return true
  }
  scan: for await (const chunk of input) {
    rest = rest.length ? Buffer.concat([rest, chunk]) : chunk
    let at
    while ((at = rest.indexOf(10)) >= 0) {
      const lineBuf = rest.subarray(0, at)
      rest = rest.subarray(at + 1)
      if (skipping) { skipping = false; continue } // tail of an oversized line
      if (lineBuf.length > limits.maxLine) continue
      if (!take(lineBuf)) break scan
    }
    if (rest.length > limits.maxLine) { rest = Buffer.alloc(0); skipping = true } // never buffer a huge line
  }
  // a last line without newline may still be half written: only count it if it parses
  if (!truncated && !skipping && rest.length && rest.length <= limits.maxLine) take(rest)
  return { n, truncated }
}

let active = 0

// Answer one /replay request: res is the Node response, file the events file.
export async function serveWindow(res, file, from, to, limits = LIMITS) {
  if (active >= limits.maxActive) { res.writeHead(503, { 'Retry-After': '2' }).end('busy'); return }
  active++
  const stream = existsSync(file) ? createReadStream(file) : null
  try {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    let closed = false
    res.on('close', () => { closed = true; if (stream) stream.destroy() })
    const write = async (s) => { if (!closed && !res.write(s)) await new Promise((r) => res.once('drain', r).once('close', r)) }
    let chain = Promise.resolve()
    const out = (s) => { chain = chain.then(() => write(s)) }
    let r = { n: 0, truncated: false }
    if (stream) { try { r = await scanWindow(stream, from, to, out, limits) } catch { /* file vanished or stream destroyed: answer what we have */ } }
    await chain
    if (!closed) res.end(JSON.stringify({ ev: '__end', n: r.n, truncated: r.truncated }) + '\n')
  } finally { active-- }
}
