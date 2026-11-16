# Jhapi (ঝাঁপি)

Personal finance tracker in rupees: bank and card transactions read automatically from bank alert emails, every kind of asset and loan, net worth, goals and an AI outlook.

**Status:** planned, not yet built.

- **Requirements:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Design and build plan:** [docs/DESIGN.md](docs/DESIGN.md)
- **Screen mockups:** [design canvas](https://claude.ai/artifact/UNS95CTG4QsjUPiycrECjM) (private)

Made for iPhone and iPad, in Safari.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/jhapi/
npm test
npm run lint
npm run build
npm run icons    # rebuild PNG icons from public/favicon.svg (macOS)
```

`samples/` holds real emails for building the parsers. It is git-ignored and must never be committed.

## Layout

```
src/core/       money, dates and calculators: EPF/PPF/SSY, deposits, loans, goals, market (pure, tested)
src/pages/      screens
public/         icons (favicon.svg is the source)
scripts/        helper scripts
docs/           design, requirements, and later the user guide (synced to GitBook)
```

## Stack

React, TypeScript and Vite as an installable PWA on GitHub Pages, set up the same way as [Bhag](../bhag). No database server: data is encrypted on each device and backed up, encrypted, to the owner's Google Drive. A Google Apps Script in the owner's Gmail puts bank alerts into a Google Sheet that the app reads.
