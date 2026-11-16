# Jhapi (ঝাঁপি)

Personal finance tracker in rupees: bank and card transactions read automatically from bank alert emails, every kind of asset and loan, net worth, goals and an AI outlook.

**Status:** planned, not yet built.

- **Requirements:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Design and build plan:** [docs/DESIGN.md](docs/DESIGN.md)
- **Screen mockups:** [design canvas](https://claude.ai/artifact/UNS95CTG4QsjUPiycrECjM) (private)

## Stack

React, TypeScript and Vite as an installable PWA on GitHub Pages, set up the same way as [Bhag](../bhag). No database server: data is encrypted on each device and backed up, encrypted, to the owner's Google Drive. A Google Apps Script in the owner's Gmail puts bank alerts into a Google Sheet that the app reads.
