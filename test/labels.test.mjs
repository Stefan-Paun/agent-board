// Tisch-Beschriftungen (public/labels.js): passen in die Tischbreite, kuerzen erst die Schrift,
// dann den Projektnamen - der Zustand ("working") bleibt immer ganz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = { window: {} }
vm.runInNewContext(readFileSync(join(PUB, 'labels.js'), 'utf8'), ctx)
const { ellipsize, fitLabel, deskSubtitle } = ctx.window.AgentBoardLabels

// Attrappe: jedes Zeichen ist 0.6 * px breit
const measure = (s, px) => s.length * px * 0.6
const m10 = (s) => measure(s, 10)

test('ellipsize laesst passende Texte in Ruhe und kuerzt sonst mit …', () => {
  assert.equal(ellipsize('jarvis', 100, m10), 'jarvis')
  const r = ellipsize('agent-board', 40, m10)
  assert.ok(r.endsWith('…'))
  assert.ok(m10(r) <= 40)
  assert.equal(r, 'agent…') // 6 Zeichen = 36 <= 40, 7 Zeichen = 42 > 40
  assert.equal(ellipsize('abc', 3, m10), '')
})

test('ohne Breitengrenze (ein Tisch) bleibt alles unveraendert', () => {
  assert.deepEqual({ ...fitLabel('Claude', 13, 10, Infinity, measure) }, { text: 'Claude', px: 13 })
  assert.deepEqual({ ...deskSubtitle('agent-board', 'working', 10, 9, Infinity, measure) }, { text: 'agent-board · working', px: 10 })
})

test('was passt, behaelt Text und Schriftgroesse (2 Tische sehen aus wie vorher)', () => {
  assert.deepEqual({ ...fitLabel('Codex', 13, 10, 200, measure) }, { text: 'Codex', px: 13 })
  const full = 'website · working'
  assert.deepEqual({ ...deskSubtitle('website', 'working', 10, 9, measure(full, 10), measure) }, { text: full, px: 10 })
})

test('etwas zu breit: erst kleinere Schrift statt Kuerzen', () => {
  const r = fitLabel('Claude 2', 13, 10, measure('Claude 2', 12), measure)
  assert.deepEqual({ ...r }, { text: 'Claude 2', px: 12 })
})

test('viel zu breit: Projekt wird gekuerzt, der Zustand bleibt ganz', () => {
  const maxW = 80
  const r = deskSubtitle('agent-board', 'working', 10, 9, maxW, measure)
  assert.equal(r.px, 9)
  assert.ok(r.text.endsWith(' · working'), r.text)
  assert.ok(r.text.includes('…'), r.text)
  assert.ok(measure(r.text, r.px) <= maxW)
})

test('kein Platz mehr fuer das Projekt: nur der Zustand, notfalls gekuerzt', () => {
  const r = deskSubtitle('agent-board', 'working', 10, 9, measure('working', 9) + 1, measure)
  assert.deepEqual({ ...r }, { text: 'working', px: 9 })
  const r2 = deskSubtitle('agent-board', 'working', 10, 9, 30, measure)
  assert.ok(measure(r2.text, r2.px) <= 30)
  assert.ok(r2.text.endsWith('…'))
})

test('ohne Projekt wird nur der Zustand eingepasst', () => {
  assert.deepEqual({ ...deskSubtitle('', 'waiting', 10, 9, 500, measure) }, { text: 'waiting', px: 10 })
})

test('vier Tische nebeneinander: keine Beschriftung ragt in den Nachbartisch', () => {
  const step = 66, slotW = step - 8
  const subs = [['agent-board', 'working'], ['website', 'working'], ['jarvis', 'waiting'], ['a-really-long…', 'working']]
  const names = ['Claude', 'Codex', 'Claude 2', 'Codex 2']
  for (let i = 0; i < 4; i++) {
    const n = fitLabel(names[i], 13, 10, slotW, measure)
    const s = deskSubtitle(subs[i][0], subs[i][1], 10, 9, slotW, measure)
    assert.ok(measure(n.text, n.px) <= slotW, n.text)
    assert.ok(measure(s.text, s.px) <= slotW, s.text)
  }
})

// ---------- parseTool: kurze Namen fuer MCP-Werkzeuge und Skills ----------
const { parseTool } = ctx.window.AgentBoardLabels
const pt = (...a) => JSON.parse(JSON.stringify(parseTool(...a)))

test('parseTool: mcp__server__tool -> "server · tool"', () => {
  assert.deepEqual(pt('mcp__github__create_issue', 'x'), { kind: 'mcp', server: 'github', tool: 'create_issue', label: 'github · create_issue', text: 'github · create_issue', target: 'x' })
  // Unterstriche im Werkzeugnamen bleiben, auch ein weiteres "__"
  assert.equal(parseTool('mcp__fs__read_text_file').label, 'fs · read_text_file')
  assert.equal(parseTool('mcp__fs__a__b').label, 'fs · a__b')
})

test('parseTool: Plugin- und claude.ai-Server werden gekuerzt und klein geschrieben', () => {
  assert.equal(parseTool('mcp__claude_ai_Gmail__search_threads').label, 'gmail · search_threads')
  assert.equal(parseTool('mcp__plugin_chrome-devtools-mcp_chrome-devtools__click').label, 'chrome-devtools · click')
  assert.equal(parseTool('mcp__plugin_solo__x').label, 'solo · x')
})

test('parseTool: Servernamen werden bereinigt und begrenzt', () => {
  assert.equal(parseTool('mcp__Stefan Notes!__t').server, 'stefan-notes')
  const long = parseTool('mcp__' + 'a'.repeat(80) + '__' + 'b'.repeat(80))
  assert.equal(long.server.length, 16)
  assert.ok(long.server.endsWith('…'))
  assert.equal(long.tool.length, 28)
  assert.ok(long.label.length <= 16 + 3 + 28)
  assert.equal(parseTool('mcp__!!!__t').server, 'mcp') // nichts Brauchbares uebrig
})

test('parseTool: Grenzfaelle', () => {
  assert.deepEqual(pt(''), { kind: 'tool', label: '', text: '', target: '' })
  assert.deepEqual(pt(undefined, null), { kind: 'tool', label: '', text: '', target: '' })
  assert.deepEqual(pt('mcp__'), { kind: 'tool', label: 'mcp__', text: 'mcp__', target: '' }) // kein Server -> unveraendert
  assert.deepEqual(pt('mcp____x'), { kind: 'tool', label: 'mcp____x', text: 'mcp____x', target: '' })
  assert.deepEqual(pt('mcp__github'), { kind: 'mcp', server: 'github', tool: '', label: 'github', text: 'github', target: '' })
  assert.equal(parseTool('mcp__github__').label, 'github')
})

test('parseTool: Skills zeigen den Namen, alles andere bleibt unveraendert', () => {
  assert.deepEqual(pt('Skill', 'jarvis-test'), { kind: 'skill', name: 'jarvis-test', label: 'jarvis-test', text: 'Skill: jarvis-test', target: '' })
  assert.deepEqual(pt('Skill', ''), { kind: 'skill', name: '', label: 'Skill', text: 'Skill', target: '' })
  assert.equal(parseTool('Skill', 'x'.repeat(100)).label.length, 32)
  assert.deepEqual(pt('Read', 'app.js'), { kind: 'tool', label: 'Read', text: 'Read', target: 'app.js' })
  assert.deepEqual(pt('Bash', 'ls\n -la'), { kind: 'tool', label: 'Bash', text: 'Bash', target: 'ls -la' })
})

test('parseTool: persoenliche Teile (E-Mail-aehnliche Servernamen) fallen weg', () => {
  assert.equal(parseTool('mcp__max.muster@gmail.com__send').label, 'gmail · send')
  assert.equal(parseTool('mcp__x@__t').server, 'mcp')
  assert.ok(!parseTool('mcp__max.muster@firma.at__t').label.includes('muster'))
})

test('parseTool: text fuer reine Textstellen, Rohname wird begrenzt', () => {
  assert.equal(parseTool('Skill', 'jarvis-test').text, 'Skill: jarvis-test')
  assert.equal(parseTool('mcp__a__b').text, 'a · b')
  assert.equal(parseTool('x'.repeat(100)).label.length, 40)
})
