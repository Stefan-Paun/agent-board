// Winziger Helfer fuer Browser-Tests ohne Abhaengigkeiten: startet Chrome headless und spricht
// das DevTools-Protokoll (CDP) ueber das in Node 22+ eingebaute WebSocket.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Chrome suchen: CHROME_PATH, sonst uebliche Orte je Betriebssystem. null, wenn keiner da ist.
export function findChrome() {
  const env = process.env.CHROME_PATH
  if (env) return existsSync(env) ? env : null
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: [join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe')],
  }[process.platform] || []
  return candidates.find((p) => existsSync(p)) || null
}

// Wartet, bis fn() etwas Wahres liefert (Polling statt fester Pausen); wirft nach timeout ms.
export async function waitFor(fn, { timeout = 15000, interval = 100, what = 'Bedingung' } = {}) {
  const end = Date.now() + timeout
  let last
  for (;;) {
    try { last = await fn(); if (last) return last } catch (e) { last = e }
    if (Date.now() > end) throw new Error(`Zeitueberschreitung beim Warten auf ${what} (zuletzt: ${last})`)
    await sleep(interval)
  }
}

// Chrome mit eigenem Temp-Profil starten. Port 0 = Chrome waehlt selbst und schreibt ihn in DevToolsActivePort.
export async function launchChrome(path) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-board-chrome-'))
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--window-size=1400,900', 'about:blank']
  // Auf Linux-CI-Runnern verhindert AppArmor oft die Chrome-Sandbox
  if (process.platform === 'linux' && process.env.CI) args.unshift('--no-sandbox')
  const proc = spawn(path, args, { stdio: 'ignore' })
  let exited = false
  proc.on('exit', () => { exited = true })
  const close = async () => {
    if (!exited) { proc.kill('SIGKILL'); await waitFor(() => exited, { timeout: 5000, what: 'Chrome-Ende' }).catch(() => {}) }
    for (let i = 0; i < 5; i++) { try { rmSync(dir, { recursive: true, force: true }); break } catch { await sleep(200) } }
  }
  try {
    const port = await waitFor(() => {
      if (exited) throw new Error('Chrome hat sich sofort beendet')
      const f = join(dir, 'DevToolsActivePort')
      return existsSync(f) && Number(readFileSync(f, 'utf8').split('\n')[0])
    }, { timeout: 20000, what: 'Chrome-Debugport' })
    return { port, close }
  } catch (e) { await close(); throw e }
}

// Neuen Tab oeffnen und per CDP verbinden. Liefert { send, on, close }.
export async function openPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  const { webSocketDebuggerUrl, id } = await res.json()
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('CDP-Verbindung fehlgeschlagen')) })
  let nextId = 0
  const pending = new Map(), listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) fail(new Error(`${msg.error.message}`)); else ok(msg.result)
    } else if (msg.method) listeners.forEach(([name, fn]) => name === msg.method && fn(msg.params))
  }
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const i = ++nextId
    pending.set(i, { ok, fail })
    ws.send(JSON.stringify({ id: i, method, params }))
    setTimeout(() => { if (pending.delete(i)) fail(new Error(`CDP ${method}: keine Antwort`)) }, 15000).unref()
  })
  const on = (name, fn) => listeners.push([name, fn])
  const close = async () => {
    try { ws.close() } catch {}
    await fetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => {})
  }
  return { send, on, close }
}
