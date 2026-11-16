# Jhapi: design

A personal finance tracker for Indian money: bank and card transactions read automatically from bank alert emails, plus every kind of asset and loan (EPF, PPF, NPS, mutual funds, stocks, FDs, gold, property, home loan), goals with forecasts, and an AI outlook. Amounts are in rupees (₹). See [Requirements](REQUIREMENTS.md) for what it must do and how each item will be checked.

**Status:** planned, not yet built.

Jhapi (ঝাঁপি) is short for *Lokkhir Jhapi*, the small pot of savings kept in many Bengali homes.

Screen mockups are on the [design canvas](https://claude.ai/artifact/UNS95CTG4QsjUPiycrECjM) (private to the owner).

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| App hosting | GitHub Pages at `https://dasabhijit.github.io/jhapi/`, deployed by GitHub Actions on every push to `main`. Same setup as Bhag | Free, static, sits with the code |
| Repo | `dasAbhijit/jhapi`, public | GitHub Pages on a free account needs a public repo. No data or keys ever live in the repo |
| Client | React, TypeScript, Vite, installable PWA. Tooling copied from Bhag (oxlint, vitest, `vite-plugin-pwa`) | One codebase for iPhone, Android and desktop |
| Main devices | **iPhone and iPad, in Safari** (mostly in the browser, not installed). Mac Chrome now and then. iOS Safari is the browser every feature is built and tested against first | The owner said so. Shapes storage, layout and unlock (section 5 and section 9) |
| Where data lives | **Encrypted on each device** (IndexedDB), with an **encrypted backup and sync in the owner's Google Drive** (`appDataFolder`). No database server | Financial data never sits readable on any server. Google stores only ciphertext |
| Reading email | A **Google Apps Script** in the owner's own Google account checks Gmail every 10 minutes and puts new bank alerts into an "Inbox" Google Sheet. The app reads and clears that sheet | Runs while the app is closed. Avoids Gmail's restricted OAuth scope, which would need Google's security review |
| Google scopes in the app | `drive.appdata` (backup) and `drive.file` (only the Inbox sheet the owner picks). Both are non-sensitive | No Google verification needed |
| Parsing | Bank email parsers live in the app (`src/core/parsers`), not in the script, and are tested in CI against saved real emails | A parser fix ships with a normal deploy; the script rarely changes |
| AI | Google Gemini with the owner's own API key, stored inside the encrypted vault. Used for unparsed emails (owner confirms) and the AI Outlook | Same approach as Bhag's invoice scanning. No shared key to pay for |
| Prices | Stocks, ETFs and SGBs through `GOOGLEFINANCE` formulas in a "Prices" tab of the same sheet. Mutual fund NAVs fetched daily by the script from AMFI | Free and needs no server (the browser cannot call AMFI or NSE directly because of CORS) |
| Currency | INR only, integer paise, Indian grouping (12,34,567.89). Financial year April to March | |
| Accessibility | Real buttons, links and labels, 44px touch targets, 4.5:1 contrast | |

### Rejected: Supabase, as in Bhag

Simpler sync, but the finance data would be readable in the database, and pulling Gmail from a server needs a stored Gmail token and Google's restricted-scope review.

## 2. Architecture

```
Gmail ──► Apps Script (owner's Google account, time trigger every 10 min)
            │  1. finds alerts from allow-listed bank senders
            │  2. checks DKIM / sender domain → OK or BLOCKED
            │  3. appends plain text of the email as a row
            ▼
          "Inbox" Google Sheet ── tabs: Inbox, Senders, Prices, Log
            │
            │  Sheets API (drive.file)
            ▼
Phone / Mac PWA (GitHub Pages)
   │  parses rows (src/core/parsers) → VERIFIED or NOT PARSED
   │  stores everything in the encrypted vault (IndexedDB)
   │
   ├──► Google Drive appDataFolder: encrypted change logs and snapshots (backup + sync)
   └──► Gemini (owner's key): parse fallback, AI Outlook
```

The app shell is cached for offline start-up. The vault works offline. Email import, prices, sync and AI need a connection.

## 3. Email pipeline

### 3.1 Setup (once)

1. The owner opens a link to a template Google Sheet and makes a copy. The copy includes the bound Apps Script.
2. The owner opens Extensions › Apps Script › Run `setup` once and approves the permissions (Gmail read and label, the sheet, external fetch for AMFI). This installs the 10-minute trigger.
3. In the app, the owner picks that sheet with the Google Picker. This gives the app `drive.file` access to that one file only.

### 3.2 Script run (every 10 minutes)

1. Build a Gmail query from the **Senders** tab: `from:(alerts@hdfcbank.net OR …) -label:ft-done newer_than:3d`.
2. For each message, read the raw message (`getRawContent`) and check the `Authentication-Results` header added by Google:
   - `dkim=pass` with `header.d` equal to the sender's expected domain from the Senders tab, and
   - the `From` address domain matches that same domain.
   - Otherwise the row is written with status `BLOCKED` and reason (for example "sender failed bank signature check").
3. Write one row: `messageId, receivedAt, from, subject, bankKey, status (OK|BLOCKED), reason, bodyText, imported`. `bodyText` is the HTML converted to plain text, trimmed to 20,000 characters.
4. Skip any `messageId` already in the sheet. Apply the Gmail label `ft-done`.
5. Use `LockService` so overlapping runs cannot write twice.
6. Purge rows marked `imported` that are older than one day.
7. Once a day: refresh mutual fund NAVs from AMFI `NAVAll.txt` into Prices for the ISINs listed there.
8. Errors go to the **Log** tab, which the app shows on the Devices & Security screen.

### 3.3 App import (when the app opens, and on pull-to-refresh)

1. Read Inbox rows where `imported` is empty.
2. `BLOCKED` rows are shown in Needs review with the reason. They never touch balances. The owner can only discard them.
3. `OK` rows go through the parser for their `bankKey`. A match gives a transaction with status `VERIFIED` (owner can still edit the category). No match gives `NOT PARSED`, shown with the subject, with **Enter manually**, **Parse with Gemini** (result shown for confirmation, never saved without it) and **Ignore**.
4. Write the transactions to the vault, then mark the rows `imported`.

### 3.4 Parsers (`src/core/parsers`)

- One module per bank. Each has a list of templates (card spend, UPI debit, UPI credit, NEFT/IMPS, ATM, EMI debit, salary credit, card statement summary). Each template is a set of regular expressions that extract amount, debit or credit, account or card last 4, merchant or counterparty, date and time, and reference number.
- Every template has fixture emails under `src/core/parsers/fixtures/<bank>/` (with personal details replaced), and a test that checks the exact fields.
- A parse is only accepted if amount, direction, account and date are all found.
- Email text is untrusted data. It is never used as instructions, including when sent to Gemini.

### 3.5 Duplicates, transfers and categories

- **Duplicates:** the same `messageId` is never imported twice. Two different emails with the same account, amount, direction and reference number are flagged as a likely duplicate for review.
- **Transfers:** a debit from one of the owner's accounts and a credit to another (including a credit card bill payment) with the same amount within 3 days are paired and marked `transfer`. Transfers are left out of spending and income.
- **Categories:** a seed list of merchant rules (Swiggy → Food, BESCOM → Utilities). When the owner changes a category, they can choose to apply it to that merchant from now on.

## 4. Vault and security

- **Data key:** a random 256-bit AES-GCM key encrypts every record. Each record is stored as `{id, iv, ciphertext}`. Record type and timestamps are inside the ciphertext.
- **Unlocking:** the data key is stored wrapped (AES-KW) three ways:
  - by the **passphrase**: PBKDF2-SHA256, 600,000 iterations, random salt;
  - by a **passkey**, through the WebAuthn PRF extension, where supported (iOS/Safari 18+, recent Chrome). Optional;
  - by a **recovery key**: 24 random words shown once, for the owner to keep offline.
- **Two steps to open** (Unlock screen): Google sign-in (needed for sync and the sheet), then unlock on this device. The vault can also be unlocked offline.
- **Auto-lock** after an idle time the owner chooses (default 5 minutes), and on **Lock now**. Locking drops the data key from memory.
- **Secrets:** the Gemini key is stored inside the vault. The only public values in the build are the Google OAuth client ID and API key for the Picker, both restricted to the Pages origin.
- **Changing the passphrase** re-wraps the data key only; records are not re-encrypted.
- **Lost everything:** without the passphrase, a passkey or the recovery key, the data cannot be recovered. The app says this plainly at setup.

## 5. Sync between devices (Drive `appDataFolder`)

- Each device has a random `deviceId` and name ("Chrome on Mac").
- Every change is a record version stamped with a **hybrid logical clock** (time + counter + deviceId).
- Each device uploads its changes as encrypted batch files `log/<deviceId>/<seq>.enc`, and reads new batches from other devices when the app opens or comes to the foreground.
- **Merge rule:** for each record, the version with the highest clock wins. Deletes are tombstones.
- **Compaction:** when there are more than 200 batch files, a device writes `snapshot.enc` holding the full state and the last sequence seen per device, then deletes the batches it covers.
- **Devices list** comes from the batch files and each device's last-seen time. **Remove** stops listing a device; it does not wipe it remotely.
- **Safari in the browser (not installed):**
  - Safari deletes a site's stored data after 7 days of using Safari without opening that site. Opening Jhapi every few days keeps it; if it is deleted, the app restores from Drive after unlocking. **Drive is the copy to trust; the device is a cache.**
  - The app calls `navigator.storage.persist()` and shows a short tip that adding Jhapi to the Home Screen stops Safari deleting its data. It never blocks use in the browser.
  - iPhone and iPad each count as a separate device with their own data on this device. Safari's private browsing keeps nothing, so the app warns there.
- **Unlock on iPhone and iPad:** passkeys come from iCloud Keychain with Face ID or Touch ID. The PRF extension needed to unlock the vault with a passkey works in Safari on iOS and iPadOS 18 and later. Earlier versions fall back to the passphrase.
- **Google sign-in in Safari** opens as a pop-up, so it is only started from a tap, never automatically.

## 6. Data model (records inside the vault)

Money is **integer paise**. Dates are `YYYY-MM-DD`.

```
account(id, kind: bank|card|wallet, institution, name, last4, active)
transaction(id, accountId, amountPaise (+ credit / − debit), date, time,
            merchant, description, category, status: verified|manual|not_parsed|blocked|ignored,
            source: email|manual|gemini|cas, gmailMessageId, reference,
            transferPairId, duplicateOf, note)
merchantRule(id, pattern, category)
holding(id, side: asset|liability, type, name, institution,
        ids {isin, ticker, uan, folio, accountNo},
        valuation: auto|cas|calc|manual,
        units, investedPaise, manualValuePaise, manualValueDate,
        params {ratePct, startDate, maturityDate, compounding, tenureMonths, ...},
        goalTags [{goalId, pct}], closed)
holdingEvent(id, holdingId, date, kind: contribution|withdrawal|interest|rate_change|
             prepayment|emi|valuation|units, amountPaise, units, ratePct, note)
declaredRate(scheme: epf|ppf|ssy|nsc|scss|kvp|po_mis, fy, ratePct)
price(key: isin|ticker, date, pricePaise)
netWorthSnapshot(date, totalPaise, byClass {retirement, market, deposits, gold_other, liabilities})
goal(id, name, targetTodayPaise, targetYear, inflationPct, plannedSipPaise,
     returnOverrides, glidePath)
outlook(id, generatedAt, horizon, portfolio {medianPaise, p10Paise, p90Paise},
        assets [{class, medianPaise, p10Paise, p90Paise, baseline, adjusted, drivers[]}],
        checkedAt, landedInRange)
device(id, name, lastSeen)
settings(autoLockMinutes, inboxSheetId, geminiKey, geminiModel, baselineReturns, ...)
```

The asset and liability `type` values are the ones in the Add Entry picker: EPF/VPF, PPF, NPS I/II, gratuity, superannuation, mutual fund, stock, ETF, REIT/InvIT, SGB, government bond, corporate bond, unlisted shares, ESOP/RSU, US stocks, PMS/AIF, FD, RD, corporate FD, NSC, KVP, SCSS, PO MIS, Sukanya Samriddhi, physical gold/silver, digital gold, bank account, cash/wallet, property, ULIP, endowment, crypto, P2P, chit fund, money lent, and loans (home, car, personal, education, gold, against property, against securities), credit card, BNPL, money borrowed.

## 7. Core logic (`src/core`)

Pure functions with no UI or network code, covered by unit and randomized tests, as in Bhag.

1. **Money:** paise arithmetic, Indian grouping, lakh/crore short forms (₹44.8L, ₹6.4 Cr), financial year of a date.
2. **EPF:** interest on the monthly running balance at the declared rate for the year, credited on 31 March. Employee, employer and VPF shares tracked separately. EPS is shown but not counted in net worth. "Reconcile with passbook" records the true balance and the difference.
3. **PPF, SSY, NSC, SCSS, KVP, PO MIS:** each scheme's own compounding and payout rules, using the owner's declared rates by year.
4. **FD and RD:** simple or compound interest (monthly, quarterly, yearly), value today and at maturity.
5. **Loans:** reducing-balance schedule. Rate changes and prepayments either cut the tenure or the EMI (owner chooses). Each EMI is split into principal and interest.
6. **Market holdings:** units × latest price, with the price date shown.
7. **Net worth:** sum by class, liabilities negative. A snapshot is saved once a day when the app opens, and the Dashboard time ranges (1D … All, YTD, FY) read from snapshots.
8. **Goals:** future cost = today's cost × (1 + inflation)^years. SIP needed solves for the gap using the expected return of the tagged holdings. A holding can be split across goals by percentage; the parts must add up to 100% or less.
9. **Forecast:** 1,000 runs of monthly returns per asset class (normal distribution from expected return and volatility), run in a Web Worker. Shows the median and the 10th to 90th percentile in today's rupees, and the chance of reaching the target. Fixed-rate assets and loans are calculated, not simulated.
10. **Transactions:** transfer pairing, duplicate flagging, category rules, monthly spending totals.

## 8. AI Outlook

- Runs when the app is opened and the last outlook is more than a day old, or on **Refresh now**. A web app cannot wake itself at a set time.
- Gemini, with Google Search grounding, is asked for recent rate, inflation and market news, and to suggest changes to the owner's **baseline** expected return and volatility for each market asset class.
- Suggestions are clamped: return within ±2 percentage points of baseline, volatility between 0.8× and 1.5× of baseline. The forecast itself is computed locally (section 7.9).
- Only asset classes and rounded totals are sent to Gemini, never account numbers, transactions or names.
- **Track record:** when an outlook's horizon passes, the app checks whether the real value landed inside the 10th to 90th range and shows the hit rate. About 80% is the target.
- Every screen says it is model output, not investment advice.

## 9. Screens

Built for **iPhone and iPad in Safari**. Phone layout uses the 390px design width from the design canvas.

- **iPhone** (under 700px wide): one column, bottom tab bar, safe-area padding for the home indicator.
- **iPad** (700px and wider, portrait and landscape, including Split View): a side bar instead of the bottom tabs, and two columns where it helps: list and detail side by side for Transactions and Portfolio, and Dashboard cards in a grid. The iPad layout is built in M5 alongside the screens, not left for later.
- Touch first: 44px targets, no hover-only controls, inputs at 16px or larger so Safari does not zoom in, and the right keyboards (`inputmode="decimal"` for amounts).
- Works with the iPad keyboard and trackpad, and with Dynamic Type sizes.

| Screen | What it shows |
|---|---|
| Unlock | Google sign-in, then passkey or passphrase, recovery key link |
| Dashboard | Net worth, change and chart for the chosen range, needs-review banner, allocation, this month's spending, recent transactions |
| Transactions | All / Needs review tabs. Verified, not parsed and blocked items with their actions. Add manual transaction |
| Portfolio | Net worth and liquid amount, holdings grouped by class with source badge (AUTO, CAS, CALC, MANUAL) and value date, + Add entry |
| Add entry | Search and type picker, CAS import |
| EPF, Loan, other holding detail | Balance, breakdown, rates by year, events, the matching actions |
| Goals | On track / behind counts, SIP gap, a card per goal |
| Goal detail | Cost today and at target year, funded %, SIP needed, forecast band, tagged holdings |
| AI Outlook and asset detail | Portfolio and per-class ranges, assumption changes, drivers, track record |
| Devices & Security | Sync status, devices, passkey, auto-lock, recovery key, passphrase, Inbox sheet status and script log, Gemini key, Lock now |

## 10. Build plan

| # | Scope | Done when |
|---|---|---|
| M0 | Repo scaffold copied from Bhag: Vite, React, PWA, oxlint, vitest, `deploy.yml` (no Supabase variables), new `base` path, design tokens from the canvas | Empty app is live on Pages and CI is green |
| M1 | `src/core`: money, FY, all calculators in section 7 (1–6, 8), with tests | Tests match hand-checked figures |
| M4a | **Pulled forward:** Apps Script, template sheet, parsers for the owner's banks with fixtures | A month of the owner's real alerts parses with nothing missed |
| M2 | Vault: encryption, IndexedDB, Unlock screen, passkey, passphrase, recovery key, auto-lock | Survives reload, locks on time, wrong passphrase is refused |
| M3 | Google sign-in, Picker, Drive backup and sync, devices list | An edit on the phone shows up on the Mac and the other way round |
| M4b | App import, Transactions and review screens, transfers, duplicates, categories, Gemini fallback | Needs-review flow works end to end on real mail |
| M5 | Portfolio, Add entry, holding detail screens, prices, net worth snapshots, Dashboard | Dashboard matches the sum of the owner's accounts |
| M6 | Goals, goal tagging, forecast worker | Goal detail matches the design |
| M7 | AI Outlook and track record | Outlook screens work with a real key |
| M8 | CAS PDF import (password-protected, read in the browser with pdf.js), CSV export, user guide in `docs/` synced to GitBook, install polish | Installed on the owner's phone and in daily use |

M4a comes straight after M1 because email parsing is the riskiest part.

## 11. Risks

| Risk | Handling |
|---|---|
| Some banks send UPI alerts by SMS only | Check each bank in M4a. Manual entry covers the gap |
| A bank changes its email layout | Fixtures and tests catch it. The email lands in Not parsed, never lost |
| Phishing email that looks like a bank | DKIM and sender-domain check; BLOCKED items never touch balances |
| Safari deletes website data after 7 days without a visit | Drive is the copy to trust and the app restores from it after unlock. Adding to the Home Screen is suggested, not required |
| Lost passphrase and recovery key | Data cannot be recovered. Said clearly at setup |
| Apps Script quotas | One person's bank mail is far below Gmail read limits |
| Inbox sheet holds email text in plain form | It is the owner's own Google account, which already holds the same emails. Rows are deleted a day after import |
| Prices tab shows which tickers the owner holds | Same account as above. Holdings amounts are never written there |

## 12. Open questions

1. Banks and cards to support first, with one sample alert of each kind. (Being collected into the git-ignored `samples/` folder.)
