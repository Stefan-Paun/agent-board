# Agent-Board on your phone

[Deutsche Version → IPHONE.de.md](IPHONE.de.md)

The board only listens on your computer (`127.0.0.1`). With [Tailscale](https://tailscale.com) you can still open it from your phone, encrypted and only inside your own tailnet.

> **Note:** the board has no login. Once it is shared this way, **every device and every user in your tailnet** can open it and see what your agents are doing (tool names, file names, shortened commands). If you share your tailnet with other people, restrict access with [Tailscale ACLs](https://tailscale.com/kb/1018/acls) or don't use this.

## 1. Tailscale

Install Tailscale on your computer and your phone and sign in with the same account. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.

## 2. HTTPS on your computer

```bash
tailscale serve --bg 4777
```

The board is now reachable at `https://<computer-name>.<tailnet>.ts.net/` (inside your tailnet only). `tailscale serve status` shows the exact name. Turn it off again with `tailscale serve --https=443 off`.

## 3. Allow the host name

The server rejects unknown host names. Allow your Tailscale name explicitly:

```bash
AGENT_BOARD_ALLOW_HOST=<computer-name>.<tailnet>.ts.net npm start
```

Several names can be comma separated. The server stays bound to `127.0.0.1`; Tailscale forwards locally.

## 4. Add to home screen

1. On the iPhone, open `https://<computer-name>.<tailnet>.ts.net/` in Safari.
2. Share button → **Add to Home Screen**.
3. The board now starts without Safari's toolbars, with the little pixel house as its icon.

The service worker only caches the static files (page, scripts, styles). Live data always comes fresh from your computer; if it is off or Tailscale is disconnected, the board shows that the connection is gone.
