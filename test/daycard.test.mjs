// Share card (public/fx/daycard.js): Tageswerte -> SVG. Prueft Wohlgeformtheit, Sicherheit
// (keine Verweise/Skripte, Maskierung), Zahlenformat und dass fremde Felder nie in der Ausgabe landen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ctx = {}
vm.runInNewContext(readFileSync(join(PUB, 'fx', 'daycard.js'), 'utf8'), ctx)
const DC = ctx.AgentBoardDayCard
const render = (...a) => DC.render(...a)

const HOURS = Array.from({ length: 24 }, (_, i) => (i >= 9 && i <= 17 ? (i - 8) * 360000 : 0))
const BASE = { dateMs: new Date(2026, 10, 10, 12).getTime(), activeMs: 3 * 3600000 + 5 * 60000, sessions: 4, tools: 1234, approvals: 7, hours: HOURS }

// kleine Wohlgeformtheitspruefung: Tags passend geschachtelt, Attribute in Anfuehrungszeichen, keine nackten & oder <
function assertWellFormed(svg) {
  assert.ok(svg.startsWith('<svg '), 'beginnt mit <svg')
  assert.ok(svg.endsWith('</svg>'))
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g
  let m, pos = 0
  while ((m = re.exec(svg))) {
    assert.equal(m.index, pos, `unerwartetes Zeichen bei ${pos}: ${svg.slice(pos, pos + 30)}`)
    pos = re.lastIndex
    if (m[5] !== undefined) { assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(m[5]), `nacktes &: ${m[5]}`); continue }
    if (m[1]) assert.equal(stack.pop(), m[2], `Tag ${m[2]} falsch geschlossen`)
    else if (!m[4]) stack.push(m[2])
    if (m[3]) assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(m[3]), `nacktes & im Attribut: ${m[3]}`)
  }
  assert.equal(pos, svg.length)
  assert.deepEqual(stack, [])
}
// einziges erlaubtes "http": der Namensraum des Wurzelelements
const noNs = (svg) => svg.replace(' xmlns="http://www.w3.org/2000/svg"', '')

test('Ausgabe ist wohlgeformtes SVG, 1200 x 630, hell und dunkel', () => {
  for (const theme of ['light', 'dark']) {
    const svg = render(BASE, { theme })
    assertWellFormed(svg)
    assert.match(svg, /width="1200" height="630" viewBox="0 0 1200 630"/)
  }
  assert.notEqual(render(BASE, { theme: 'light' }), render(BASE, { theme: 'dark' }))
  assert.match(render(BASE, { theme: 'dark' }), /#282a36/)
})

test('keine Verweise, Skripte oder eingebetteten Inhalte', () => {
  const svg = noNs(render({ ...BASE, title: 'http://evil.example/<script>x</script>' }, { theme: 'dark' }))
  assert.ok(!/http/i.test(svg.replace(/http:\/\/evil\.example/g, '')), 'http-Verweis')
  for (const bad of [/<script/i, /foreignObject/i, /<image/i, /<use/i, /href/i, /url\(/i, /@import/i, /\son\w+=/i, /javascript:/i, /data:/i, /<style/i]) {
    assert.ok(!bad.test(svg), String(bad))
  }
  // ohne Titel gibt es gar kein "http" ausser dem Namensraum
  assert.ok(!/http/i.test(noNs(render(BASE))))
})

test('Titel wird maskiert, gekuerzt und gesaeubert (Angriffstexte)', () => {
  const attacks = [
    '<script>alert(1)</script>', '</text><script>alert(1)</script>', '"><svg onload=alert(1)>', "' onload='alert(1)",
    '<foreignObject><iframe src="x"/></foreignObject>', '&lt;b&gt; & &amp; &#60;', ']]><![CDATA[x', '<!-- c -->', '\u0000\u0008\u001b[31m', 'a‮b', '\ud800 lone',
  ]
  for (const a of attacks) {
    const svg = render({ ...BASE, title: a })
    assertWellFormed(svg)
    assert.ok(!/<script|<foreignObject|<iframe|<!--|<!\[CDATA|<svg[^>]*onload/i.test(svg.replace(/^<svg /, '')), a)
    assert.equal((svg.match(/<svg/g) || []).length, 1, a)
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f‮]/.test(svg), 'Steuerzeichen')
  }
  assert.equal(DC.clean('a<b>&"\'', 40), 'a&lt;b&gt;&amp;&quot;&#39;')
  assert.equal(DC.clean('x'.repeat(100), 10), 'xxxxxxxxx…')
  assert.equal(DC.clean('  viel \n\t Platz  ', 40), 'viel Platz')
  assert.equal(DC.clean('\ud800', 5), '')
  assert.match(render({ ...BASE, title: 'Mein <Tag> & "Ziel"' }), /Mein &lt;Tag&gt; &amp; &quot;Ziel&quot;/)
  // ohne Titel: Standardtext
  assert.match(render(BASE), />Day summary</)
})

test('Beschriftungen kommen nur aus bekannten Schluesseln und werden ebenso maskiert', () => {
  const svg = render(BASE, { labels: { title: 'Tagesbilanz', tools: '<b>Aufrufe</b>', evil: '<script>', sessions: 5 } })
  assertWellFormed(svg)
  assert.match(svg, />Tagesbilanz</)
  assert.match(svg, /&lt;b&gt;Aufrufe&lt;\/b&gt;/)
  assert.ok(!/evil|<script/.test(svg))
  assert.match(svg, />Sessions</) // Nicht-Text faellt auf den Standard zurueck
})

test('Zahlen werden richtig formatiert', () => {
  assert.equal(DC.fmtInt(1234567, 'en'), '1,234,567')
  assert.equal(DC.fmtInt(1234567, 'de'), '1.234.567')
  assert.equal(DC.fmtInt(999, 'en'), '999')
  assert.equal(DC.fmtInt(-5, 'en'), '0')
  assert.equal(DC.fmtInt('abc', 'en'), '0')
  assert.equal(DC.fmtInt(12.9, 'en'), '12')
  assert.equal(DC.fmtDur(0), '0 s')
  assert.equal(DC.fmtDur(45000), '45 s')
  assert.equal(DC.fmtDur(12 * 60000), '12 min')
  assert.equal(DC.fmtDur(3900000), '1 h 05 min')
  assert.equal(DC.fmtDur(NaN), '0 s')
  assert.equal(DC.fmtDate(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05')
  assert.equal(DC.fmtDate('x'), '')
  const svg = render(BASE)
  assert.match(svg, />3 h 05 min</)
  assert.match(svg, />1,234</)
  assert.match(svg, />2026-11-10</)
  assert.match(render(BASE, { lang: 'de' }), />1\.234</)
})

test('kaputte oder fehlende Werte ergeben trotzdem eine gueltige Karte', () => {
  for (const inp of [undefined, null, 5, 'x', {}, { activeMs: 'NaN', sessions: -3, tools: Infinity, approvals: {}, hours: 'abc', dateMs: NaN }, { hours: [1, 'x', null, -4] }]) {
    const svg = render(inp, null)
    assertWellFormed(svg)
    assert.ok(!/NaN|undefined|null|Infinity/.test(svg), String(inp))
  }
  // 24 Stundenbalken, immer
  assert.equal((render(BASE).match(/fill="#96491f"/g) || []).length, 9)
  assert.equal((render({}).match(/<rect/g) || []).length, (render(BASE).match(/<rect/g) || []).length - 9 + 9)
})

test('Zulassungsliste: zusaetzliche Felder (Pfad, Prompt, Projekt, Agent) tauchen nie auf', () => {
  const secrets = ['/Users/someone/secret-project', 'rm -rf /tmp/geheim', 'Please refactor the payroll module', 'payroll-service', 'agent-7-alice', 'sk-ant-abcdef123456']
  const input = {
    ...BASE, path: secrets[0], cwd: secrets[0], cmd: secrets[1], prompt: secrets[2], proj: secrets[3], agent: secrets[4], key: secrets[5],
    commanders: [{ name: secrets[4], proj: secrets[3] }], tools: 1234, toolNames: [['Bash', 3]], events: [{ what: secrets[1] }],
    labels: { path: secrets[0] },
  }
  for (const theme of ['light', 'dark']) {
    const svg = render(input, { theme, lang: 'de', labels: { path: secrets[0], proj: secrets[3] }, cwd: secrets[0] })
    for (const s of secrets) assert.ok(!svg.includes(s), `${s} in der Ausgabe`)
    assert.ok(!/Users|payroll|alice|sk-ant|geheim/.test(svg))
    assertWellFormed(svg)
  }
  // Zusatzfelder aendern die Ausgabe nicht: byteweise gleich wie ohne
  assert.equal(render(input), render(BASE))
  // auch ein Titel ist die einzige Textspur
  assert.notEqual(render({ ...BASE, title: 'Hallo' }), render(BASE))
})

test('Stundenleiste: Balkenhoehe folgt dem Wert, nur eingelesene Zahlen', () => {
  const one = render({ hours: Array.from({ length: 24 }, (_, i) => (i === 5 ? 1000 : 0)) })
  assert.equal((one.match(/fill="#96491f"/g) || []).length, 1)
  assert.match(one, /<rect x="285" y="490" width="40" height="70" fill="#96491f"\/>/)
})
