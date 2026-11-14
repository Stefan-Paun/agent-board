# A second machine on the same board

Agents that run on another computer (for example a PC with WSL in the same private network) can show up on one board, clearly marked with the name of their machine. This is **opt-in**: without the settings below nothing changes, the board stays local and read-only, and the route used here does not exist.

All names and addresses on this page are placeholders: `board.example` is the computer that shows the board, `pc-two` is the second machine.

## How it works

```
second machine (pc-two)                         board machine (board.example)
hooks -> events.jsonl -> tools/forward.mjs  ->  POST /ingest -> events.jsonl -> board
```

The second machine keeps collecting its own events as usual. A small script, `tools/forward.mjs`, follows that local log and sends new events in batches to the board machine. The board checks every event again, stamps it with the machine name and shows it with an `@pc-two` badge. A filter above the crew list switches between *All machines*, *This machine* and each remote name.

## Setup

**1. Make a token** (on either machine), at least 32 characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it out of your shell history and out of any repository, for example in a file only you can read.

**2. Board machine**: start the server with the token, the allowed machine names, and reachable from your private network:

```bash
AGENT_BOARD_INGEST_TOKEN=<token> \
AGENT_BOARD_INGEST_MACHINES=pc-two \
AGENT_BOARD_BIND=<private address of this machine> \
AGENT_BOARD_HOSTS=board.example \
npm start
```

The console prints a warning while ingest is on. If you already use `tailscale serve` as described in [IPHONE.md](IPHONE.md), keep the server on `127.0.0.1`, leave out `AGENT_BOARD_BIND` and allow the Tailscale name in `AGENT_BOARD_HOSTS`; the sender then uses the `https://` address.

**3. Second machine**: clone this repository, connect the hooks as usual (`node install.mjs`, or `--codex` / `--gemini`), then start the sender and leave it running:

```bash
AGENT_BOARD_FORWARD_URL=http://board.example:4777 \
AGENT_BOARD_INGEST_TOKEN=<token> \
AGENT_BOARD_MACHINE=pc-two \
node tools/forward.mjs
```

`--once` sends what is new and exits (handy for a first test), `--from-start` also sends what is already in the log on the first run (events older than an hour are skipped). The sender remembers its position in `forward-state.json` in the data folder, retries with a growing pause (1 s up to 60 s) when the board is not reachable, and never needs the board machine to reach back.

**4. Look at the board**: sessions from the second machine appear with `@pc-two` next to their name. Try it without a second machine: `?demo=1&machine=1`.

## Settings

| Variable | Where | |
|---|---|---|
| `AGENT_BOARD_INGEST_TOKEN` | both | shared secret, at least 32 characters. Not set on the board machine = ingest off. Too short = the server refuses to start. |
| `AGENT_BOARD_INGEST_MACHINES` | board | allowed machine names, comma separated (default `remote`). Short names of `a-z`, `0-9`, `-`, at most 16 characters, at most 8 names. |
| `AGENT_BOARD_FORWARD_URL` | second machine | address of the board, `http://` or `https://` |
| `AGENT_BOARD_MACHINE` | second machine | which of the allowed names this sender uses (optional if the board allows exactly one) |

## What is sent, what is checked

The sender only sends the fields the board shows anyway (see the Privacy section of the README): time, event type, shortened ids, agent type, project folder name, tool name, shortened and redacted target and the short extra fields. No paths, no prompt text, no tool output. Events that already came from another machine are never forwarded again.

The receiver trusts none of it. For every request it checks the token in constant time, the content type (`application/json` only), the size (64 KB), the number of events (50) and a rate limit per sender address. Every event is rebuilt field by field from the same list: unknown fields are dropped, types are checked, lengths are cut, secrets are redacted again. The machine name is set by the server from its allow list, never taken from the event, and it is put in front of the session, agent and tool ids (`pc-two~…`). A remote sender can therefore neither write into a local session nor pose as this machine.

Remote events also have their own small share of the log (the newest 4000 lines or 1 MB): a flood from a second machine cannot push your local history out of `events.jsonl`. The status line (context, cost, limits) always belongs to a session of this machine.

| Answer | Meaning |
|---|---|
| `404` | ingest is off (no token on the board machine) |
| `401` | wrong or missing token |
| `403` | machine name not in the allow list, or host name not in `AGENT_BOARD_HOSTS` |
| `400` | broken request, or `AGENT_BOARD_MACHINE` is missing while the board allows several names (the sender keeps the events and tries again) |
| `413` / `415` | too large or too slow, wrong content type |
| `429` | too many requests, too many wrong tokens, or more than 1200 events per minute from one machine; the sender waits and tries again |

## Threat model in five sentences

Anyone who has the token can make agents appear on your board, but nothing more: there is no way to control agents, read files or change local sessions through this route. The token travels in a header, so over plain `http://` everyone on the path can read it; the board has no TLS of its own. Use this only inside a private network you control, ideally an encrypted one such as Tailscale (or its HTTPS via `tailscale serve`), and never on the open internet. All machines share one token and the machine name is a label, not an identity: a sender with the token can use any name from the allow list. Reading the board is still without login for every device that can reach it, exactly as with `AGENT_BOARD_BIND` alone.

## Switching it off

1. Stop `tools/forward.mjs` on the second machine.
2. Restart the board without `AGENT_BOARD_INGEST_TOKEN` (and without `AGENT_BOARD_BIND` / `AGENT_BOARD_HOSTS` if you no longer need them). `/ingest` answers `404` again.
3. Optional: delete `forward-state.json` in the data folder of the second machine, and throw the token away.

Remote events already in the log disappear on their own with the normal log trimming; the *This machine* filter hides them right away.
