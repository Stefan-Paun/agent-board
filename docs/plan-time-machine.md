# Plan: time machine (replay part of a day on the board)

## Goal
Rewind the board: pick a window of today (or an earlier day, as far as `events.jsonl` reaches) and
watch the agents work again, with play/pause, speed (1x/10x/60x) and a draggable scrubber.
Read-only; no export, nothing stored, no new data in the log.

## Stages
1. **Core** `public/fx/timecore.js` (pure, loads in browser and Node like `daystats.js`): normalise an
   event list, position -> number of events to apply, forward step vs. rebuild (backward jump),
   speeds, skipping long idle gaps, marks ("waiting for approval", "round done"), next/previous mark.
   Test: `test/timecore.test.mjs`.
2. **Endpoint** `GET /replay?from=&to=` in `server.mjs` (helper in `replay.mjs`): streams the events of a
   window as NDJSON, hard caps for events and bytes, bounded line length and concurrency, same host
   check as every other route, broken log lines skipped, same fields as the live protocol, plus one
   closing control line that says whether the window was cut. Test: `test/replay.test.mjs`.
3. **Hooks in `app.js`**: `AB.travel` (hold live events while travelling, rebuild state from a
   list, virtual clock for sweeping, abort on demo toggle / SSE replay). Live behaviour is unchanged
   when it is not used. Test: `test/travel.test.mjs` (state rebuilt via the real `handle` in a vm).
4. **UI** `public/fx/timemachine.js/.css`: button, bar with scrubber, marks, jump to next mark, speed,
   "recording, not live" banner, back-to-live button, keyboard (Space, arrows), window choice
   (last hour / today / yesterday), demo mode uses the demo events. Texts in `i18n.js` (EN/DE/ES).
5. **Docs**: README, `docs/FX-API.md`, this plan brought to the final state.

## Not part of it
Export, saving recordings, new log fields, multi-day browsing beyond what the log holds.
