// Server nach dem Kuerzen von events.jsonl: das naechste Ereignis darf nicht verloren gehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumeOffset } from '../server.mjs'

test('nach dem Kuerzen geht der Server hinter der zuletzt gesendeten Zeile weiter', () => {
  // vorher gesendet: ...{"n":2}; gekuerzte Datei behaelt 1-2, danach kam 3 dazu
  const buf = Buffer.from('{"n":1}\n{"n":2}\n{"n":3}\n')
  const off = resumeOffset(buf, '{"n":2}')
  assert.equal(buf.subarray(off).toString(), '{"n":3}\n')
})

test('ist die zuletzt gesendete Zeile nicht mehr da, kommt alles in der Datei als neu', () => {
  assert.equal(resumeOffset(Buffer.from('{"n":7}\n'), '{"n":2}'), 0)
  assert.equal(resumeOffset(Buffer.from('{"n":7}\n'), null), 0)
})
