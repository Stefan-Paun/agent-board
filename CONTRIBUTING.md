# Contributing to Agent-Board

Thanks for wanting to help. Small, focused contributions are the easiest to review. Questions and ideas: open a [GitHub issue](https://github.com/Stefan-Paun/agent-board/issues) (bug, feature or new language template). Issues that are a good start are labelled `good first issue`.

## Setup

Node 20 or newer, nothing else to install.

```bash
git clone https://github.com/Stefan-Paun/agent-board.git
cd agent-board
npm start                 # http://localhost:4777, add ?demo=1 for a simulated session
npm test                  # unit and integration tests
npm run test:browser      # UI smoke test in headless Chrome (Node 22+; skipped without Chrome, set CHROME_PATH if it is not found)
```

Syntax check, as in CI:

```bash
for f in *.mjs public/*.js public/fx/*.js; do node --check "$f"; done
```

## Project rules

- **Zero dependencies.** No npm packages, no build step, no CDN scripts. Plain Node and plain browser JavaScript. This applies to tests, too.
- **i18n.** Every UI text lives in `public/i18n.js` as `'key': ['English', 'Deutsch', 'Español']`. No hard-coded strings in `app.js`, `fx/` or `index.html`. `test/i18n.test.mjs` checks that every key has every language.
- **Privacy.** Everything stays local. Never store prompt texts, tool output, error texts or compaction summaries - only counters, names and short shortened targets. Secrets are masked before writing. See the Privacy section of the README.
- **Windows too.** Hooks and tools must work on Linux, macOS and Windows (paths, shell); the CI matrix tests all three.
- **Pixel look.** Keep the cozy pixel-art style and respect reduced motion.
- **Public repo.** No private paths, email addresses, keys or screenshots with personal data.

## Pull requests

- Keep PRs small and about one thing. Open an issue first for bigger changes.
- Add or update tests; new test files go into the `test` script in `package.json`.
- `npm test` must be green (check the exit code) before you open the PR.
- Short English commit subject in the imperative ("Add Spanish tooltip for ...").

## Add a language

1. Open `public/i18n.js`. Add your code (for example `'fr'`) to `LANGS`, and a locale to `LOCALES` (`fr: 'fr-FR'`).
2. Extend `detect()` so the browser language maps to your code (like the `de` and `es` checks).
3. Add one more entry to **every** row of `D`: `'key': ['English', 'Deutsch', 'Español', 'Français']`. Keep the `{placeholders}` exactly as they are. Rows that are functions `(vars) => text` need the same shape.
4. Add an `<option value="fr" lang="fr">FR · Français</option>` to the language picker in `public/index.html`.
5. Update the expected languages in `test/i18n.test.mjs` and run `npm test`. That test uses `fr` as its example of an *unsupported* language (fallback to English); if you add French, switch that example to another code. Check the UI with `?lang=<code>`, also for text that is too long for its box.
6. Mention the language in the READMEs.

If you are not a developer, open a "New language" issue instead and say that you can translate; someone can do the wiring.

## Labels

Maintainer note: suggested labels for these templates are `bug`, `enhancement`, `translation` and `good first issue`.

## Code of conduct

Be kind and assume good intent. Harassment or discrimination is not tolerated; the maintainer may remove comments or block people who do not follow this.
