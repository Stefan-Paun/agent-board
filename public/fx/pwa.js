// fx/pwa.js: registriert den Service Worker (nur in sicherem Kontext: localhost oder HTTPS ueber Tailscale)
(() => {
  'use strict'
  try {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return
    navigator.serviceWorker.register('sw.js').catch(() => { /* still ignorieren */ })
  } catch { /* still ignorieren */ }
})()
