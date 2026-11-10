# Plan: Week in review (`/week`)

## Goal
A weekly counterpart to the day summary: for the last 7 local days show active minutes, sessions,
tool calls, approvals and errors per day, a weekday x hour heatmap, the 8 most used tools,
totals per project and a comparison with the previous week. Computed only from the existing
`events.jsonl`; no new log fields, nothing stored, no money costs.

## Stages
1. **Pure evaluation** `public/fx/weekstats.js` (browser and Node, like `daystats.js`) plus
   `test/weekstats.test.mjs` (empty week, one day, day boundary, DST, broken lines).
   `daystats.js` gets an opt-in `opts.intervals` so the active intervals can be clipped per day/hour.
2. **Server route** `GET /week` (read only, same host/peer check as `/day`). The log is streamed
   with a byte cap; answer has only numbers, tool names and project names. Tests in
   `test/week.test.mjs`.
3. **UI** `public/fx/week.js` + `week.css`: "Week" button, card with 7 bars (SVG), heatmap as a real
   `<table>` with numbers (colour only on top), tool list, project list, previous-week delta.
   Texts in EN/DE/ES, demo mode with plausible sample values, key `W`.
4. **Docs**: README section, FX-API note, test list in `package.json`.

## Files
`public/fx/weekstats.js`, `public/fx/week.js`, `public/fx/week.css`, `public/fx/daystats.js` (small),
`server.mjs`, `public/i18n.js`, `public/index.html`, `public/fx/keys.js`, tests, README, package.json.

## Testing
`npm test` (unit + route tests with a temporary data dir and a test server on a free port).
UI is checked via generated DOM in tests where possible.

## Not included
New log fields, persisting results, money costs, charting libraries.

## Status
(see end of file, updated per stage)
