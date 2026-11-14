// fx/machines.js: zweiter Rechner (docs/SECOND-MACHINE.md). Zeigt ueber der Besatzungsliste einen Filter
// "alle / dieser Rechner / <Name>", sobald Ereignisse eines anderen Rechners da sind. Die Abzeichen selbst
// ("@name" an Karte und Figur) kommen aus crew.js und app.js; die Logik steht in machine-logic.js.
// Gemerkt wird nur die Wahl des Filters im Browser (localStorage 'ab-machine').
(() => {
'use strict'
const AB = window.AgentBoard, ML = window.AgentBoardMachines
if (!AB || !ML || !AB.machines) return
const T = AB.t || ((k) => k)
const KEY = 'ab-machine'
const tryLS = (fn) => { try { return fn() } catch { return null } }
const crew = document.getElementById('crew')
if (!crew || !crew.parentNode) return

// gemerkter Wunsch: 'this' oder ein Name; gilt erst, wenn es den Rechner auf dem Board wirklich gibt
let wish = tryLS(() => localStorage.getItem(KEY))
if (wish !== 'this' && ML.normalize(wish, [wish]) !== wish) wish = null

const box = document.createElement('div')
box.className = 'ab-machines'
box.hidden = true
const sel = document.createElement('select')
sel.id = 'ab-machine-filter'
sel.setAttribute('aria-label', T('machine.filter'))
sel.title = T('machine.filter')
box.append(sel)
crew.parentNode.insertBefore(box, crew)

const labelOf = (v) => (v === 'all' ? T('machine.all') : v === 'this' ? T('machine.this') : v)
let key = ''

function sync() {
  // waehrend einer Zeitreise bleibt der Filter, wie er ist (die Aufzeichnung wird nicht neu aufgebaut)
  const travelling = !!(AB.travel && AB.travel.active)
  if (sel.disabled !== travelling) sel.disabled = travelling
  if (travelling) return
  const names = AB.machines.list()
  const opts = ML.options(names)
  let cur = AB.machines.filter()
  // der gefilterte Rechner ist nicht mehr da (z.B. nach einem Neuaufbau): nicht vor einem leeren Board stehen
  if (cur !== 'all' && cur !== 'this' && !names.includes(cur)) cur = AB.machines.set('all')
  if (wish && wish !== cur && opts.includes(wish)) cur = AB.machines.set(wish)
  const k = opts.join('|')
  if (k !== key) {
    key = k
    sel.replaceChildren(...opts.map((v) => { const o = document.createElement('option'); o.value = v; o.textContent = labelOf(v); return o }))
    box.hidden = !opts.length
  }
  if (opts.length && sel.value !== cur && document.activeElement !== sel) sel.value = cur
}

sel.addEventListener('change', () => {
  const v = sel.value
  wish = v === 'all' ? null : v
  tryLS(() => (wish ? localStorage.setItem(KEY, wish) : localStorage.removeItem(KEY)))
  AB.machines.set(v)
  sync()
})

AB.on('ui', sync)
sync()
})()
