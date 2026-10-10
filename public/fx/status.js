(() => {
'use strict'
const AB = window.AgentBoard
if (!AB) return
const T = AB.t || ((k) => k)
const WAIT_MS = 60000
const waitAt = new Map() // Lead-ID -> seit wann wartet diese Session auf dich
const baseTitle = document.title.replace(/^(\(\d+\)|\(\?\)|⚠|⏸)\s*/, '') || 'Agent-Board'

AB.on('event', (ev) => {
  // Erlaubnis-Anfragen zeigt attention.js; hier nur "Runde fertig, wartet auf neue Eingabe"
  const lid = AB.leadOf(ev)
  if (ev.ev === 'Stop' || (ev.ev === 'Notification' && (!ev.nt || ev.nt === 'idle_prompt'))) waitAt.set(lid, ev.t || Date.now())
  else if (ev.ev === 'UserPromptSubmit') waitAt.delete(lid)
})

function disc(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(251,243,228,0.95)'
  ctx.strokeStyle = 'rgba(58,44,32,0.12)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
}

function bubble(ctx, text, x, y, u, time, col = AB.COL.amber) {
  ctx.font = `700 ${Math.round(14 * u)}px "Avenir Next","Helvetica Neue",system-ui,sans-serif`
  const padX = 12 * u, h = 28 * u
  const w = ctx.measureText(text).width + padX * 2 + 14 * u
  const bob = AB.reduce ? 0 : Math.sin(time * 2.4) * 2 * u
  const bx = Math.max(4, Math.min(AB.geo.w - w - 4, x - w / 2)), by = y - h + bob
  ctx.fillStyle = '#fbf3e4'; ctx.strokeStyle = col; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.rect(bx, by, w, h); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x - 6 * u, by + h); ctx.lineTo(x, by + h + 8 * u); ctx.lineTo(x + 6 * u, by + h)
  ctx.closePath(); ctx.fillStyle = '#fbf3e4'; ctx.fill(); ctx.stroke()
  // Pause-Symbol links
  ctx.fillStyle = col
  ctx.fillRect(bx + 9 * u, by + h / 2 - 5 * u, 3 * u, 10 * u); ctx.fillRect(bx + 15 * u, by + h / 2 - 5 * u, 3 * u, 10 * u)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + padX + 12 * u, by + h / 2 + 1)
}

AB.on('agents', (ctx, time) => {
  const u = AB.geo.u, C = AB.COL
  ctx.save()
  for (const a of AB.S.agents.values()) {
    const x = a.x + 19 * u, y = a.y - 17 * u, r = 8 * u
    ctx.globalAlpha = a.alpha == null ? 1 : a.alpha
    if (a.state === 'done') {
      disc(ctx, x, y, r)
      ctx.strokeStyle = C.mint; ctx.lineWidth = 2 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(x - 4 * u, y); ctx.lineTo(x - 1 * u, y + 3.2 * u); ctx.lineTo(x + 4.5 * u, y - 3.5 * u); ctx.stroke()
    } else if (a.state === 'error') {
      const on = AB.reduce || Math.floor(time * 3) % 2 === 0
      const k = on ? 1 : 0.35
      ctx.globalAlpha *= k
      const s = 10 * u
      ctx.fillStyle = C.coral; ctx.strokeStyle = '#3a2c20'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.75); ctx.lineTo(x - s, y + s * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#1a0608'
      ctx.fillRect(x - 1 * u, y - 4 * u, 2 * u, 6 * u); ctx.fillRect(x - 1 * u, y + 3 * u, 2 * u, 2 * u)
    } else if (a.state === 'idle') {
      disc(ctx, x, y, r)
      ctx.fillStyle = C.dim
      ctx.fillRect(x - 3.5 * u, y - 4 * u, 2.5 * u, 8 * u); ctx.fillRect(x + 1 * u, y - 4 * u, 2.5 * u, 8 * u)
    } else if (a.state === 'active' && !AB.reduce) {
      // kleine Zielmarken-Klammern, gegenläufig zum vorhandenen Kreis
      const rr = 27 * u, s = -time * 1.5 + a.slot
      ctx.strokeStyle = a.color; ctx.globalAlpha *= 0.55; ctx.lineWidth = 2 * u
      for (let i = 0; i < 4; i++) {
        const st = s + i * Math.PI / 2
        ctx.beginPath(); ctx.arc(a.x, a.y, rr, st, st + 0.22); ctx.stroke()
      }
    }
  }
  ctx.restore()

  const shown = AB.leadsShown()
  // bei mehreren Tischen ein kurzes Schild, sonst ueberlappen sich die Schilder benachbarter Tische
  const label = shown.length > 1 ? T('st.waitShort') : T('st.waitBubble')
  for (const lid of shown) {
    if (!isWaiting(lid)) continue
    const d = AB.deskPos(lid)
    ctx.save()
    bubble(ctx, label, d.x, d.y - 60 * u, u, time, AB.leadColor(lid))
    ctx.restore()
  }
})

function isWaiting(lid) { const w = waitAt.get(lid); return AB.lead(lid).state === 'idle' && !!w && Date.now() - w < WAIT_MS }

let lastTitle = ''
AB.on('ui', () => {
  let act = 0, err = 0
  for (const a of AB.S.agents.values()) { if (a.state === 'active') act++; else if (a.state === 'error') err++ }
  const waiting = AB.leadsShown().some(isWaiting)
  let t = baseTitle
  if (err) t = `⚠ ${baseTitle}`
  else if (act) t = `(${act}) ${baseTitle}`
  else if (waiting) t = `⏸ ${baseTitle}`
  if (t !== lastTitle) { document.title = t; lastTitle = t }
})
})()
