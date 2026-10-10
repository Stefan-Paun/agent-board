# Agent-Board am iPhone

[English version → IPHONE.md](IPHONE.md)

Das Board läuft nur auf deinem Mac (127.0.0.1). Mit Tailscale kommst du trotzdem vom iPhone hin, verschlüsselt und nur aus deinem eigenen Tailnet.

> **Hinweis:** Das Board hat kein Login. Ist es so freigegeben, kann **jedes Gerät und jede Person in deinem Tailnet** es öffnen und sehen, was deine Agents tun (Werkzeuge, Dateinamen, gekürzte Befehle). Teilst du dein Tailnet mit anderen, schränke den Zugriff mit [Tailscale-ACLs](https://tailscale.com/kb/1018/acls) ein oder nutze das nicht.

## 1. Tailscale

Tailscale auf Mac und iPhone installieren und mit demselben Konto anmelden. In der Tailscale-Verwaltung HTTPS-Zertifikate (MagicDNS + HTTPS) einschalten.

## 2. HTTPS-Weiterleitung am Mac

```
tailscale serve --bg 4777
```

Damit ist das Board unter `https://<mac-name>.<tailnet>.ts.net/` erreichbar (nur im Tailnet). Den genauen Namen zeigt `tailscale serve status`.
Wieder abschalten: `tailscale serve --https=443 off`.

## 3. Host-Namen erlauben

Der Server lehnt fremde Host-Namen ab. Den Tailscale-Namen ausdrücklich erlauben:

```
AGENT_BOARD_ALLOW_HOST=<mac-name>.<tailnet>.ts.net npm start
```

Mehrere Namen kommagetrennt. Der Server bleibt an 127.0.0.1 gebunden, Tailscale leitet lokal weiter.

## 4. Zum Home-Bildschirm

1. Am iPhone in Safari `https://<mac-name>.<tailnet>.ts.net/` öffnen.
2. Teilen-Knopf → **Zum Home-Bildschirm**.
3. Das Board startet dann ohne Safari-Leisten, mit dem Pixel-Haus als Icon.

Der Service Worker merkt sich nur die statischen Dateien (Seite, Skripte, Stile). Live-Daten kommen immer frisch vom Mac; ist der Mac aus oder Tailscale getrennt, zeigt das Board „Offline“.
