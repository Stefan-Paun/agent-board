# Plan: shareable day card (SVG/PNG, numbers only)

## Goal
Download today's summary as a 1200x630 card (pixel look, big numbers, small 24-hour bar) for a README or portfolio.
The card is guaranteed to hold nothing private: the renderer takes an allow-list of numbers plus a date, never project names, paths, commands, prompts or agent names.

## Stages
1. **Stats**: `summarize` in `public/fx/daystats.js` also returns `hours` (24 buckets of active ms) and `totals.approvals` (PermissionRequest count). Test in `test/daystats.test.mjs`.
2. **Renderer**: new pure module `public/fx/daycard.js` (browser and Node, no DOM): `AgentBoardDayCard.render(input, opts)` returns SVG text. Allow-list input, escaped optional title, light/dark. Tests in `test/daycard.test.mjs` (well-formed, no `http`/`<script>`/`foreignObject`, escaping attacks, number formatting, extra fields never appear).
3. **UI**: "Share card" button in the day summary: preview, save SVG, save PNG (canvas, local), copy image when the clipboard supports it. Texts in `public/i18n.js` (EN/DE/ES), styles in `public/fx/day.css`. No upload, no new server route.
4. **Docs**: README section with an example, this plan updated.

## Tests
`npm test` (new file listed in the `test` script); i18n completeness test covers new keys.

## Not included
Upload, share links, weekly card. The existing 800x450 PNG export stays unchanged.
