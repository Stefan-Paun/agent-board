// Ende-zu-Ende: echter Server, echter SSE-Stream. Nach dem Kuerzen von events.jsonl muss das
// direkt danach angehaengte Ereignis beim Browser ankommen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 47000 + Math.floor(Math.random() * 1000)
const line = (n) => JSON.stringify({ t: n, ev: 'PreToolUse', what: `z${n}` }) + '\n'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('Ereignis direkt nach dem Kuerzen kommt im Live-Stream an', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-srv-'))
  const file = join(data, 'events.jsonl')
  writeFileSync(file, '')
  const srv = spawn(process.execPath, [join(DIR, 'server.mjs')], {
    env: { ...process.env, AGENT_BOARD_DATA: data, AGENT_BOARD_PORT: String(PORT) }, stdio: 'ignore',
  })
  t.after(() => { srv.kill(); rmSync(data, { recursive: true, force: true }) })
  await sleep(400)

  const got = []
  const req = request({ host: '127.0.0.1', port: PORT, path: '/events', headers: { Host: `localhost:${PORT}` } }, (res) => {
    res.setEncoding('utf8')
    res.on('data', (c) => { for (const m of c.matchAll(/event: ev\ndata: (.+)\n/g)) got.push(JSON.parse(m[1]).what) })
  })
  req.end()
  t.after(() => req.destroy())
  await sleep(300)

  // viele Live-Ereignisse, damit die Datei gross ist ...
  for (let n = 1; n <= 50; n++) appendFileSync(file, line(n))
  await sleep(600)
  // ... dann kuerzen (letzte 10 behalten) und sofort ein neues Ereignis anhaengen - wie der Collector
  let kept = ''
  for (let n = 41; n <= 50; n++) kept += line(n)
  writeFileSync(file, kept + line(51))
  await sleep(600)

  assert.ok(got.includes('z50'), `vor dem Kuerzen angekommen: ${got.length}`)
  assert.ok(got.includes('z51'), 'Ereignis nach dem Kuerzen fehlt im Live-Stream')
  assert.equal(got.filter((w) => w === 'z45').length, 1, 'behaltene Zeilen duerfen nicht doppelt kommen')
})
