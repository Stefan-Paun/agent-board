// tailLines() und der Tail-Reader hinter /events und /health
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tailLines } from '../server.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 48000 + Math.floor(Math.random() * 1000)
const line = (n) => JSON.stringify({ t: n, ev: 'PreToolUse', what: `z${n}` }) + '\n'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('tailLines: last 400 of 30000 complete lines', () => {
  let s = ''
  for (let i = 1; i <= 30000; i++) s += line(i)
  const out = tailLines(Buffer.from(s), 400)
  assert.equal(out.length, 400)
  assert.equal(JSON.parse(out[0]).t, 29601)
  assert.equal(JSON.parse(out[399]).t, 30000)
})

test('tailLines: no trailing newline keeps the last line', () => {
  const out = tailLines(Buffer.from(line(1) + line(2) + '{"t":3}'), 2)
  assert.deepEqual(out, [line(2).trim(), '{"t":3}'])
})

test('tailLines: fewer lines than n, empty buffer, blank lines', () => {
  assert.equal(tailLines(Buffer.from(line(1) + line(2)), 400).length, 2)
  assert.deepEqual(tailLines(Buffer.alloc(0), 400), [])
  assert.deepEqual(tailLines(Buffer.from('a\n\n\nb\n'), 400), ['a', 'b'])
})

function get(path, port = PORT) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path }, (res) => {
      let b = ''
      res.on('data', (c) => { b += c })
      res.on('end', () => resolve(b))
    }).on('error', reject).end()
  })
}

function sseLines(port, ms) {
  return new Promise((resolve) => {
    const got = []
    const req = request({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      res.on('data', (c) => { for (const m of String(c).matchAll(/^event: replay\ndata: (\[.*\])$/gm)) got.push(...JSON.parse(m[1])) })
    })
    req.on('error', () => {}).end()
    setTimeout(() => { req.destroy(); resolve(got) }, ms)
  })
}

test('server: replay from a big file is the last 400 lines once; /health counts incrementally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-tail-'))
  const file = join(dir, 'events.jsonl')
  let s = ''
  for (let i = 1; i <= 30000; i++) s += line(i)
  writeFileSync(file, s)
  const child = spawn(process.execPath, ['server.mjs'], { cwd: DIR, env: { ...process.env, AGENT_BOARD_PORT: String(PORT), AGENT_BOARD_DATA: dir }, stdio: 'ignore' })
  try {
    let h
    for (let i = 0; i < 40; i++) { try { h = JSON.parse(await get('/health')); break } catch { await sleep(200) } }
    assert.ok(h, 'server did not start')
    assert.equal(h.events, 30000)
    assert.equal(h.lastEventAt, 30000)
    appendFileSync(file, line(30001))
    await sleep(700)
    h = JSON.parse(await get('/health'))
    assert.equal(h.events, 30001)
    assert.equal(h.lastEventAt, 30001)
    const evs = await sseLines(PORT, 800)
    const ts = evs.map((e) => e.t)
    assert.equal(ts.length, 400)
    assert.equal(ts[0], 29602)
    assert.equal(ts[399], 30001)
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }) }
})
