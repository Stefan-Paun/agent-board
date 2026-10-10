// Kuerzen von events.jsonl unter gleichzeitigen Hook-Prozessen: keine Zeile darf verloren gehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILLER = JSON.stringify({ t: 0, ev: 'PreToolUse', what: 'x'.repeat(200) }) + '\n'

function hook(env, i) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [join(DIR, 'collector.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
    p.on('close', done)
    p.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `s${i}`, tool_name: 'Read', tool_input: { file_path: `/x/neu${i}.js` } }))
  })
}

test('gleichzeitige Hooks verlieren beim Kuerzen keine Zeilen', async () => {
  const data = mkdtempSync(join(tmpdir(), 'agent-board-rot-'))
  try {
    const file = join(data, 'events.jsonl')
    const env = { ...process.env, AGENT_BOARD_DATA: data }
    for (let round = 0; round < 5; round++) {
      // Datei knapp ueber der 5-MB-Grenze: der erste Hook kuerzt, die anderen schreiben gleichzeitig
      writeFileSync(file, FILLER.repeat(Math.ceil((5 * 1024 * 1024) / FILLER.length) + 1))
      const N = 30
      await Promise.all(Array.from({ length: N }, (_, i) => hook(env, i)))
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      const kaputt = lines.filter((l) => { try { JSON.parse(l); return false } catch { return true } })
      assert.deepEqual(kaputt, [], `Runde ${round}: halbe/kaputte Zeilen`)
      const neu = lines.map((l) => JSON.parse(l).what).filter((w) => w.startsWith('neu'))
      assert.deepEqual(neu.sort(), Array.from({ length: N }, (_, i) => `neu${i}.js`).sort(), `Runde ${round}`)
    }
  } finally { rmSync(data, { recursive: true, force: true }) }
})
