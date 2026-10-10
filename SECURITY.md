# Security

Agent-Board is meant to run on your own machine: the server binds to `127.0.0.1`, checks the `Host` header, sends a strict Content-Security-Policy and only serves files from `public/`. The collector never stores prompt text or tool output and redacts secret-looking strings (see the Privacy section in the README).

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. You will get an answer within a week.

## Scope

In scope: the server (`server.mjs`), the hook collector (`collector.mjs`), the status line (`statusline.mjs`), the installer (`install.mjs`) and the page (`public/`).

Out of scope: exposing the board to other machines yourself (e.g. via `AGENT_BOARD_ALLOW_HOST` or a reverse proxy) beyond what `docs/IPHONE.md` describes.
