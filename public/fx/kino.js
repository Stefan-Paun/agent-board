(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const body = document.body
let on = false, lock = null, still = 0

const btn = document.createElement('button')
btn.type = 'button'; btn.id = 'b-kino'; btn.textContent = 'Kino'; btn.setAttribute('aria-pressed', 'false')
btn.title = 'Kino-Modus (Taste K): Vollbild, nur die Karte'
const tools = document.querySelector('header .tools')
if (tools) tools.prepend(btn)

const poke = () => {
  body.classList.remove('abx-still'); clearTimeout(still)
  if (on) still = setTimeout(() => body.classList.add('abx-still'), 3000)
}
const remeasure = () => { window.dispatchEvent(new Event('resize')); setTimeout(() => window.dispatchEvent(new Event('resize')), 150) }

async function getLock() {
  try {
    if (!on || lock || !navigator.wakeLock || document.hidden) return
    lock = await navigator.wakeLock.request('screen')
    lock.addEventListener('release', () => { lock = null })
  } catch { lock = null }
}
function dropLock() { try { if (lock) lock.release() } catch {} lock = null }

function apply(v) {
  on = v
  body.classList.toggle('abx-kino', on)
  btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Kino aus' : 'Kino'
  if (on) { getLock(); poke() } else { dropLock(); clearTimeout(still); body.classList.remove('abx-still') }
  remeasure()
}

function enter() {
  apply(true)
  try {
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen()
    if (p && p.catch) p.catch(() => {}) // Layout bleibt auch ohne Vollbild aktiv
  } catch {}
}
function leave() {
  apply(false)
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) } catch {}
}
const toggle = () => (on ? leave() : enter())

btn.addEventListener('click', toggle)
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Escape' && on) { leave(); return }
  if (e.key.toLowerCase() !== 'k') return
  const t = document.activeElement
  if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return
  toggle()
})
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && on) apply(false); else remeasure() })
document.addEventListener('visibilitychange', () => { if (!document.hidden) getLock() })
for (const ev of ['mousemove', 'pointerdown', 'touchstart']) addEventListener(ev, poke, { passive: true })
})()
