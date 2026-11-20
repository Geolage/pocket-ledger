# Pocket Ledger

[![CI and GitHub Pages](https://github.com/Geolage/pocket-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/Geolage/pocket-ledger/actions/workflows/ci.yml)

[简体中文](README.zh-CN.md)

**Live demo:** <https://geolage.github.io/pocket-ledger/>

Pocket Ledger is a local-first personal income and expense tracker. Record income and expenses, review monthly summaries and spending trends, and set category budgets. All data stays in the browser's `localStorage`; there is no backend, bank connection, or network request.

## Features

- Record income and expenses with categories, dates, and notes; amounts are calculated in integer cents
- Edit and delete records, with a confirmation step before deletion
- Review monthly income, expenses, balance, and remaining budget
- Visualize spending by category and daily expense trends
- Filter records by type, category, and keyword
- Set category budgets, track progress, and receive over-budget warnings
- Add, rename, disable, and delete unused custom categories
- Export JSON backups and CSV records, and import a JSON backup with undo
- Undo deletions, category changes, data clearing, and demo-data restoration
- Switch among three light blue-green themes: L1 Celadon, L2 Mist, and L3 Sage
- Favicon and browser theme-color metadata adapt to the selected theme
- Restore demo data, clear local data, and migrate the legacy storage key automatically
- Responsive desktop and mobile layouts

## Stack

- React 19, TypeScript, Vite 8, and Tailwind CSS 4
- Radix UI / shadcn-style components and Lucide icons
- Static Vite build with no backend or external requests
- Browser `localStorage` persistence
- Node built-in tests and Playwright end-to-end tests

## Run locally

Requires Node 22.13 or newer in the 22.x line, or Node 24+. Playwright tests also require Google Chrome on the local machine.

```sh
npm ci
npm run dev
```

Build and preview:

```sh
npm run build
npm run preview
```

## Tests

```sh
npm run test:unit   # Domain calculations and validation: 87 tests
npm run test:e2e    # Desktop and mobile interactions: 71 tests
npm test            # Run both suites
```

Playwright uses port 4175 and isolated browser contexts, so it does not read or overwrite the ledger data in your normal browser profile.

## CI and deployment

- [ci.yml](.github/workflows/ci.yml) runs linting, formatting checks, builds, unit tests, and Playwright tests for pull requests and main-branch pushes.
- After verification succeeds on the main branch, the deployment job builds `dist/` and publishes it to GitHub Pages at `https://geolage.github.io/pocket-ledger/`.
- Before the first deployment, set **Settings → Pages → Source** to **GitHub Actions**.
- To reproduce the Pages build locally, run `GITHUB_PAGES=true npm run build`. In Windows PowerShell, use `$env:GITHUB_PAGES="true"; npm run build`.

## Data and scope

- Storage key: `pocket-ledger.v1`; the legacy `xiaozhanben.v1` key is migrated automatically on first read.
- Backups stay on the machine. JSON holds the whole ledger (format version 2: records, budgets, theme, categories) and CSV holds the records with a UTF-8 BOM so spreadsheets read Chinese text correctly. Importing validates the file first, then shows what it would replace and asks before replacing the current ledger.
- Undo covers exactly one step and only while its notification is on screen; any later change takes that step over.
- If a stored payload cannot be migrated, the app switches to a safe-recovery view and leaves the original bytes in storage untouched — nothing overwrites them until you make a real change to the ledger.
- The demo ledger is generated from a fixed seed. All amounts, merchants, and people are fictional. Demo data can be restored or cleared from the settings page.
- There is no login, cloud synchronization, or account connection. Amounts and budgets remain on the local machine.
- The project demonstrates interface and interaction behavior only. It does not provide financial or investment advice.

## Project layout

- `src/`: application, domain calculations, themes, storage, and feature components
- `components/ui/`: shadcn-style primitives actually used by the project
- `scripts/`: Node domain tests and build scripts
- `e2e/`: Playwright desktop and mobile regression tests
- `vendor/`: licensed template stylesheet files

## Development approach

The developer defined the product scope, information architecture, and interaction trade-offs. Implementation, test scaffolding, and deployment configuration were completed with Qoder AI assistance. Core amount calculations, local storage, and desktop/mobile interactions are covered by automated regression tests, and relevant commits use the `Assisted-by: Qoder` trailer to distinguish human decisions from AI-assisted work.

## Attribution

Frontend starter and vendored shadcn stylesheet attribution are recorded in `PROVENANCE.md` and `vendor/`.

## License

[MIT](LICENSE) © 2026 Geolage Wu
