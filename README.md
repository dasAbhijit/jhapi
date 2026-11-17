# Jhapi (ঝাঁপি)

Personal finance tracker in rupees: bank and card transactions read automatically from bank alert emails, every kind of asset and loan, net worth, goals and an AI outlook.

**Live app:** https://dasabhijit.github.io/jhapi/ (bank emails → your own Google Sheet → this app)

**Status:** built and live: email reading and two-way sheet sync (M4), display names and changing many transactions at once (M4d), holdings, prices and net worth (M5a–b), goals with forecasts (M6). Next: EPF/PPF rates by year and loan prepayments (M5c), Ask (chat about your money with your own Gemini key) and AI Outlook (M7), encryption and CAS import (M8). See the build plan in [docs/DESIGN.md](docs/DESIGN.md#10-build-plan).

- **Requirements:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Design and build plan:** [docs/DESIGN.md](docs/DESIGN.md)
- **Owner setup (Jhapi's sheet and script, connecting devices):** [docs/admin/setup.md](docs/admin/setup.md)
- **Screen mockups:** [design canvas](https://claude.ai/artifact/UNS95CTG4QsjUPiycrECjM) (private). The top rows are the first concepts; the "As built" row matches the live app

Made for iPhone and iPad, in Safari.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/jhapi/
npm test
npm run lint
npm run build
npm run icons    # rebuild PNG icons from public/favicon.svg (macOS)
npm run build:cloud  # rebuild cloud/Code.gs after changing parsers, src/core or cloud/main.js
```

`samples/` holds real emails for building the parsers. It is git-ignored and must never be committed.

## Layout

```
src/core/          money, dates, calculators, records, display names, holdings, prices, net worth,
                   goals, forecast, sheet layout, DKIM check (pure, tested)
src/core/parsers/  bank email parsers (shared with the script)
src/cloud/         what the script bundles, plus a fake of Google's services for tests
src/data/          sheet client, device storage, sync store, summaries
src/pages/, src/ui/ screens
cloud/main.js      the Apps Script, by hand
cloud/Code.gs      GENERATED: npm run build:cloud (bundled parsers + main.js); paste into the sheet
docs/              design, requirements, owner setup
```

## Stack

React, TypeScript and Vite as a PWA on GitHub Pages, set up like [Bhag](../bhag). Data lives in **Jhapi's own Google Sheet**. Its own Apps Script reads bank alert emails every 10 minutes (read-only, DKIM-checked) and answers the app as a web app protected by a secret code. The app pulls on every open and pushes edits back. Encryption on the device comes later.
