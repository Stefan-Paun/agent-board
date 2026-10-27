// fx/keys.js: Tastenkuerzel und Hilfe-Fenster ("?"). H = Verlauf, T = Heute (Tagesbilanz), ? = Hilfe,
// Esc schliesst offene Karten/Fenster. K (Kino, fx/kino.js) und M (Ton, app.js) haben ihre eigenen
// Handler und stehen nur in der Hilfe. Die Tastenzuordnung ist eine reine Funktion (getestet in
// test/keys.test.mjs); der Rest haengt am DOM und tut nichts, wenn es die Seite nicht gibt.
(() => {
'use strict'

// Welche Aktion loest diese Taste aus? Nie mit Strg/Cmd/Alt und nie beim Tippen in einem Eingabefeld.
function keyAction(e, typing) {
  if (!e || typeof e.key !== 'string' || e.ctrlKey || e.metaKey || e.altKey || typing) return null
  switch (e.key) {
    case '?': return 'help'
    case 'h': case 'H': return 'history'
    case 't': case 'T': return 'today'
    default: return null
  }
}
// Zeilen der Hilfe: [Taste, i18n-Schluessel]
const ROWS = [['H', 'keys.history'], ['T', 'keys.today'], ['K', 'keys.kino'], ['M', 'keys.sound'], ['?', 'keys.help'], ['Esc', 'keys.esc']]

const root = typeof window !== 'undefined' ? window : globalThis
root.AgentBoardKeys = { keyAction, ROWS }

const AB = root.AgentBoard
if (!AB || typeof document === 'undefined') return
const T = AB.t || ((k) => k)
const stage = document.querySelector('.stage')
if (!stage) return

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const isTyping = () => {
  const t = document.activeElement
  return !!t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)
}

let card = null
// day.js raeumt beim Oeffnen alle Karten ausser der Tagesbilanz weg - dann ist card veraltet
function closeHelp() {
  const was = !!card && card.isConnected
  if (card) card.remove()
  card = null
  return was
}
function openHelp() {
  // wie day.js: nicht mehrere Karten uebereinander
  for (const c of stage.querySelectorAll('.ab-sum')) c.remove()
  card = el('section', 'ab-sum ab-keys')
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', T('keys.label'))
  const h = el('div', 'ab-sum-head')
  const x = el('button', 'ab-sum-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('keys.close'))
  x.addEventListener('click', closeHelp)
  h.append(el('h3', null, T('keys.title')), el('span', 'ab-sum-dur', ''), x)
  const dl = el('dl', 'ab-keys-list')
  for (const [k, id] of ROWS) {
    const row = el('div')
    const dt = el('dt'); dt.append(el('kbd', null, k))
    row.append(dt, el('dd', null, T(id)))
    dl.append(row)
  }
  card.append(h, dl)
  stage.append(card)
  x.focus()
}

// offenes Fenster mit seinem eigenen Knopf schliessen; liefert true, wenn etwas zuging
function closeOne() {
  if (closeHelp()) return true
  const sum = stage.querySelector('.ab-sum:not(.ab-day):not(.ab-keys) .ab-sum-x')
  if (sum) { sum.click(); return true }
  for (const sel of ['.ab-day-btn', '.ab-tl-btn']) {
    const b = document.querySelector(sel)
    if (b && b.getAttribute('aria-expanded') === 'true') { b.click(); return true }
  }
  return false
}

// Esc: zuerst Fenster/Karten, erst danach (in fx/kino.js) der Kino-Modus
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (closeOne()) { e.stopPropagation(); e.preventDefault() }
}, true)

addEventListener('keydown', (e) => {
  if (e.repeat) return
  const a = keyAction(e, isTyping())
  if (!a) return
  if (a === 'help') { e.preventDefault(); if (!closeHelp()) openHelp(); return }
  const b = document.querySelector(a === 'history' ? '.ab-tl-btn' : '.ab-day-btn')
  if (b) { e.preventDefault(); b.click() }
})
})()
