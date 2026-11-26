# Jhapi: design

A personal finance tracker for Indian money: bank and card transactions read automatically from bank alert emails, plus every kind of asset and loan (EPF, PPF, NPS, mutual funds, stocks, FDs, gold, property, home loan), goals with forecasts, a chat to ask about your money, and an AI outlook. Amounts are in rupees (₹). See [Requirements](REQUIREMENTS.md) for what it must do and how each item will be checked.

**Status:** M0, M1, M4a–d, M5a–b, M6, M8a (passkey lock) and M8b (CAS import) are built and tested; the app is live at https://dasabhijit.github.io/jhapi/. M5c, M7 and the rest of M8 (CSV export, guide) are next. See section 10.

Jhapi (ঝাঁপি) is short for *Lokkhir Jhapi*, the small pot of savings kept in many Bengali homes.

Screen mockups are on the [design canvas](https://claude.ai/artifact/UNS95CTG4QsjUPiycrECjM) (private to the owner). Its top rows are the first concepts (some, like Drive backup and devices, belong to the earlier encrypted-vault plan); the **As built** row shows the screens as they are in the live app.

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| App hosting | GitHub Pages at `https://dasabhijit.github.io/jhapi/`, deployed by GitHub Actions on every push to `main`. Same setup as Bhag | Free, static, sits with the code |
| Repo | `dasAbhijit/jhapi`, public | GitHub Pages on a free account needs a public repo. No data, secrets or real emails ever live in the repo |
| Client | React, TypeScript, Vite, installable PWA. Tooling copied from Bhag (oxlint, vitest, `vite-plugin-pwa`) | One codebase for iPhone, iPad and desktop |
| Main devices | **iPhone and iPad, in Safari** (mostly in the browser, not installed). Mac Chrome now and then. iOS Safari is the browser every feature is built and tested against first | The owner said so. Shapes storage, layout and unlock (sections 5 and 9) |
| **Where data lives** | **Jhapi's own Google Sheet**, in the owner's Google account and shared with nobody. The app keeps a copy on the device so it opens instantly and works offline | The owner's choice (17 Nov 2026), like the Pahadi Soul app. The owner can read, sort and edit the data in the sheet directly |
| **Separation** | Jhapi has **its own sheet and its own Apps Script**. Nothing is shared with Pahadi Soul or any other app: not the sheet, script, web app URL, secret code or triggers | The owner's rule: "absolutely no overlap" |
| Reading email | Jhapi's script runs **every 10 minutes** in the owner's Google account. It reads only allow-listed bank senders (Gmail read-only), checks each email's DKIM signature, parses it, and writes rows into the sheet | Works while the app is closed. Gmail access stays inside the owner's own account |
| One parser, two places | The parsers are written once in TypeScript (`src/core/parsers`), tested in CI, and **bundled into the script** (`cloud/Code.gs`, built by `npm run build:cloud`). CI fails if the committed `Code.gs` is out of date | The script and the app can never disagree about what an email means |
| Sync | The script is also a **web app**. The app calls it with a secret code: `pull` returns everything, `push` sends changed rows. Merge is **row by row, newer edit wins** (the `Updated` column). Edits typed into the sheet are stamped by an `onEdit` trigger, so they flow back to the app | Two-way: email → sheet → app, app → sheet, and sheet edits → app |
| When the app syncs | On every open, when it comes back to the foreground after a minute, when it goes back online, after every edit, and on **Sync now**. **Read bank emails now** asks the script to run at once | The owner asked for a fetch on every open |
| Encryption | **On the device, with a passkey only** (M8a, 19 Nov 2026), switched on per device in Settings. The sheet is not encrypted: it is protected by the owner's Google account and the secret code | The owner chose passkey only, no passphrase, and to build it on `dasabhijit.github.io` now, knowing a move to another address means new passkeys |
| AI | Google Gemini with the owner's own API key, kept only in the browser and called straight from it, for **Ask** (chat about the owner's money), unparsed emails (owner confirms) and the AI Outlook. Planned for M7. See section 8 | The same pattern as the owner's other apps' chat, with a key made only for Jhapi |
| Currency | INR only, integer paise in the app, rupees in the sheet. Financial year April to March | |
| Accessibility | Real buttons, links and labels, 44px touch targets, 4.5:1 contrast | |

### Rejected

- **Supabase, as in Bhag:** the finance data would sit in a database the owner does not control as directly, and pulling Gmail from a server needs a stored Gmail token.
- **Encrypted vault with Drive sync (the first plan):** postponed by the owner. Encryption on the device returns in M8.

## 2. Architecture

```
Gmail (owner's account)
   │ read-only, allow-listed bank senders only
   ▼
Jhapi Apps Script (bound to Jhapi's own sheet)
   │ every 10 min: DKIM check → JhapiCore.parseEmail → new rows
   │ web app: doPost {token, action: ping | pull | push | readInbox}
   │ onEdit: stamps ID + Updated on rows typed by hand
   ▼
Jhapi Google Sheet ── tabs: Transactions, Statements, Review, Log
   ▲
   │ HTTPS POST (text/plain, no CORS preflight), secret code in the body
   ▼
Jhapi PWA (GitHub Pages) on iPhone / iPad / Mac
   localStorage: connection, last copy of the sheet, unsent changes
```

## 3. Email pipeline

### 3.1 Script run (every 10 minutes, `readInbox`)

1. Search Gmail: `from:(<every allow-listed address>) after:<last run − 1 day>` (first run: the last 60 days, set by the `JHAPI_BACKFILL_DAYS` script property).
2. Read **every message in every thread**: Gmail groups alerts with the same subject into one thread.
3. Skip any Gmail message id already in the sheet.
4. **Sender check** (`src/core/dkim.ts`): the `From` address must be at the bank's domain, and Gmail's own `Authentication-Results: mx.google.com` header must show `dkim=pass` for that domain or a subdomain. Results headers written by anyone else are ignored. A failure goes to **Review** as **Blocked**, with the subject only (the text of a possible phishing email is not stored), and never touches the books.
5. **Parse** with `JhapiCore.parseEmail`:
   - a transaction becomes a row in **Transactions**, status **Verified**, or **Receipt** for copies such as PhonePe and YONO;
   - a card statement becomes a row in **Statements** (one per card and due date);
   - an email the parsers do not recognise goes to **Review** as **Not parsed**, with its text so it can be entered by hand;
   - notices and offers are ignored.
6. A second alert for the same money (same account, amount, direction and reference) is skipped as a duplicate.
7. At most 200 emails per run; the next run carries on from where this one stopped.
8. A summary line goes to the **Log** tab. The script never labels, moves or changes any email.

### 3.2 Parsers (`src/core/parsers`)

- One module per bank: `axis.ts`, `icici.ts`, and `others.ts` (SBI, DBS, PhonePe, Amazon Pay, CRED). The allow-list and each sender's DKIM domain live in `index.ts`.
- The email text is flattened first (link targets, table pipes and extra spaces removed), so the two layouts Axis uses read the same.
- Each email gives one result: a transaction, a statement, ignore (with a reason), or not parsed (with a reason).
- Templates covered: see `samples/senders.md` (local only) and the tests. Banks that only send SMS for some kinds of transaction (ICICI and SBI savings UPI, DBS credits) are entered by hand.
- **Tests:**
  - `parsers.test.ts` uses synthetic emails that copy each real layout with made-up values.
  - `samples.local.test.ts` runs the owner's real emails from the git-ignored `samples/` folder, on the owner's machine only, and prints no values.

### 3.3 Duplicates, transfers and categories

- **Receipts:** PhonePe, YONO, the second DBS email and ICICI standing-instruction notes repeat a bank alert. They are kept as **Receipt** rows (hidden unless "Show receipts" is on) and never counted. When a receipt and the bank's row share the bank reference and amount, the bank's row takes the receipt's payee (if it had none) and its category (if it only had Other or Income), e.g. a PhonePe BSNL bill turns the Axis UPI row into **Bills** (`enrichFromReceipts`).
- **Transfers between the owner's own accounts** (`pairTransfers`): after each email run, the script looks back 45 days for a debit and a credit of the same amount in two different accounts, at most a day apart (three for card bills), where
  - the debit went to a UPI handle at the credited account's bank (`asha@axisbank` → Axis), or
  - both sides name the same person (SBI "Transferred to X" / "Deposit by transfer from X"), or
  - the credit is a card bill payment and the debit looks like one (CRED, BillDesk, "credit card").

  Both get the category **Transfer** and a note ("To Axis Bank ••1111"). Each row pairs at most once. Card payments, iMobile card payments and transfers the bank labels as such are Transfer from the start. Transfer, Investments and Refund are left out of the month's spending.
- **Categories:** the owner's own **rules** come first (the `Rules` tab: "payee contains X → category"). The app's "Always use <category> for <payee>" adds one and recategorises earlier rows from that payee. Then seed rules in `src/core/records.ts` (Swiggy → Food, BESCOM → Bills, and so on). Any category can be changed in the app or the sheet.
- **Changing many at once:** on a transaction, "Also use <category> for the N other transactions from <sender>" changes every row from that sender once, without a rule. On Transactions, **Pick** mode (with **Pick all shown** after a search) sets the category of, stops counting, or counts again a picked set. Each is one push, so a long list costs one round trip.
- **Display names** (`src/core/aliases.ts`, the `Names` tab): the app shows the owner's name for a payee ("Swiggy") with the bank's spelling in small type underneath ("BUNDL TECHNOLOGIES PRIVATE LIMITED"). Only the display changes; the `Counterparty` column, rules, transfer pairing and duplicate checks keep using the bank's name. Matching ignores case and extra spaces; tidying only the capitals ("SWIGGY" → "Swiggy") counts as a display name. Bank names that share a display name are one **sender** for "all from this sender" and "See all". Search finds either name.

## 4. Security and privacy

- **The sheet** is private to the owner's Google account. The script runs as the owner and reads Gmail read-only (`cloud/appsscript.json` limits it to `gmail.readonly`, `spreadsheets.currentonly`, triggers and the sheet's menu).
- **The web app** is deployed "execute as me, anyone can call", because the app on GitHub Pages cannot carry a Google login. Every call must include the **secret code**: 64 random hex characters made by **Jhapi > Set up**, kept in Script properties (never in a sheet cell), checked in constant time. Without it the web app answers nothing except "wrong secret code".
- **The app** accepts only a `https://script.google.com/macros/s/…/exec` address, so the code is never sent anywhere else.
- **On the device:** the connection (URL and code), the last copy of the sheet and unsent changes are in `localStorage`. **Disconnect this device** removes all of it.
- **Passkey lock (M8a, `src/data/vault.ts`, `passkey.ts`, `lock.tsx`):** off until turned on in Settings, per device.
  - **Key:** the passkey's WebAuthn **PRF** output (32 secret bytes, given only after Face ID / Touch ID) → HKDF-SHA-256 → AES-GCM-256, not extractable and never stored. Needs iOS 18 or later with the passkey in Passwords (iCloud Keychain); a passkey without PRF is refused and nothing changes.
  - **Storage:** each value is encrypted on its own with a fresh IV under `jhapi.vault.<name>`; the plain copies are removed only after the encrypted ones are written. `jhapi.lock` holds the passkey ID, PRF salt, the passkey's name ("Jhapi on iPhone") and a check value, so a wrong passkey is caught. No secrets in it.
  - **While unlocked** the values are decrypted in memory (LocalStore stays synchronous) and every change is written back encrypted, in order. A sync still in flight when the lock is turned on or off cannot write plain data.
  - **Locks** on every open or reload, after 5 minutes in the background, and on **Lock now**. The lock screen shows nothing from the data.
  - **Each device has its own passkey** (a random user ID, named after the device). The passkey belongs to `dasabhijit.github.io`; moving Jhapi to another address means turning the lock on again there.
  - **Lost passkey:** the lock screen's "Can't use your passkey?" forgets this device's copy (unsynced changes are lost) and the owner reconnects. The sheet keeps everything.
  - **Limits:** it protects the copy on the device, not the sheet. While Jhapi shares its origin with Bhag (A11), Bhag's pages could ask for the same passkey; the lock is only as strong as Bhag's code.
- **Gemini key** (M7): in `localStorage` on each device only, sent only to `generativelanguage.googleapis.com` in the `x-goog-api-key` header (never in a URL), never in the sheet, a push or a backup. Disconnect and **Remove** clear it. What Gemini is sent is set out in section 8.1.
- **Never in the repo:** real emails (`samples/` is git-ignored), the secret code, the web app URL.
- **Pushes are checked first:** a request with any bad record (amount, date, type, timestamps, field lengths) is refused whole, so a bad request changes nothing.

## 5. Sync between the app and the sheet

- **Pull** (every open, foreground after a minute, back online, Sync now): the script reads every synced tab (Transactions, Statements, Review, Rules, Names, Holdings, Net worth, Goals). Rows typed by hand get an ID and an `Updated` time and are rewritten in the standard layout. Rows it cannot read (no usable date or amount) are listed as problems in Settings and left alone.
- **Push** (after every edit in the app): the app sends only changed rows, each with a new `Updated` time. For each row:
  - not in the sheet: added;
  - in the sheet with an older `Updated`: replaced;
  - in the sheet with a **newer** `Updated` (edited in the sheet since): **the sheet wins**, and the app says so.
- **Offline:** edits wait in a queue on the device and go with the next successful sync. The screens show the sheet's copy with the queued edits on top.
- **Deleting** marks the row `Deleted = TRUE`, so the deletion syncs too. The owner can clear deleted rows from the sheet whenever they like.
- **Hand edits in the sheet:** the `onEdit` trigger stamps `Updated` (and an `ID` for new rows) on every edited row, so the next pull carries them to the app.
- **Safari storage:** Safari may clear a site's storage after 7 days without a visit. The sheet is the copy to trust, so the next open just pulls everything again (only the connection needs re-entering).

## 6. The sheet (data model)

Amounts are **rupees** in the sheet and integer **paise** in the app. Dates are `YYYY-MM-DD`; hand-typed dates such as `16/11/2026` are understood. ID, date, time, account, reference and timestamp columns are formatted as plain text so Sheets does not change them.

**Transactions:** `ID`, `Date`, `Time`, `Account`, `Type` (Debit/Credit), `Amount`, `Counterparty`, `Category`, `Channel`, `Reference`, `Balance`, `Status` (Verified, Manual, Receipt, Review, Ignored), `Source` (Email, App, Sheet), `Note`, `Email ID`, `Template`, `Updated`, `Deleted`.

- `Account` is a key such as `axis-bank-1111`, `icici-credit_card-4444` or `amazonpay-wallet`; the app shows it as "Axis Bank ••1111". Hand-added rows can use any name, such as `Cash`.
- Only **Verified** and **Manual** rows count towards spending and balances.

**Statements:** `ID`, `Account`, `Total due`, `Minimum due`, `Due date`, `Email ID`, `Updated`.

**Review:** `ID`, `Received`, `From`, `Subject`, `Status` (Not parsed, Blocked), `Reason`, `Text`, `Email ID`, `Updated`, `Resolved`.

**Rules:** `ID`, `Contains`, `Category`, `Updated`, `Deleted`. Synced both ways like transactions; rows typed by hand get an ID.

**Names:** `ID`, `Name in email`, `Show as`, `Updated`, `Deleted`. Display names: the app shows `Show as` in place of the bank's name, with the bank's name in small type underneath. Matching ignores case and extra spaces. The Transactions tab keeps the bank's name; several bank names may share one display name and then count as one sender. Synced both ways like Rules.

**Log:** `Time`, `Event` (the last 500 lines).

**Holdings:** `ID`, `Name`, `Type`, `Institution`, `Code`, `Units`, `Price`, `Price date`, `Invested`, `Value`, `Value date`, `Rate %`, `Start`, `Maturity`, `Compounding`, `Payout`, `Monthly`, `Months`, `Notes`, `Updated`, `Deleted`.

- `Type` is a label such as `PPF`, `Mutual fund`, `Home loan` (the full list is `HOLDING_TYPES` in `src/core/holdings.ts`); a row with an unknown type is reported, not guessed.
- The value is worked out in the app (`valueHolding`), not stored:
  - **CALC**: EPF, PPF and SSY from the balance on the start date, the rate and the monthly contribution; FD, NSC, KVP, SCSS, PO MIS and RD from their rate and dates.
  - **PRICE**: mutual funds, stocks, ETFs, SGBs and NPS from units × price.
  - **EMI**: loans from the amount, rate, months and first EMI date.
  - **MANUAL**: gold, property, cash, money lent and anything else, from `Value`.
  - Typing a `Value` overrides the calculation for loans and market holdings, e.g. the outstanding amount from the lender's statement.
- Liabilities count as negative.

**Net worth:** `Date`, `Net worth`, `Holdings`, `Bank balances`, `Loans`, `Retirement`, `Market`, `Deposits`, `Gold & other`. One row per day, written by the script at 7 AM (and by **Update prices now**), replacing that day's row if it runs again. The Home chart reads it.

**Prices (auto):** a helper tab of `GOOGLEFINANCE` formulas the script rewrites each morning; not synced.

**Goals:** `ID`, `Name`, `Cost today`, `Target year`, `Inflation %`, `Return %`, `Monthly SIP`, `Holdings`, `Notes`, `Updated`, `Deleted`. `Holdings` lists the holdings set aside for the goal as `holdingID:percent; …` (the app writes it; by hand, copy IDs from the Holdings tab). `Return %` empty means "use the usual return of the tagged holdings' classes".

- **Worked out in the app** (`src/core/goalPlan.ts`):
  - Set aside today = each tagged holding's value × its share.
  - Future cost = cost today × (1 + inflation)^years.
  - SIP needed comes from M1's `planGoal`.
  - The **forecast** (`src/core/forecast.ts`) runs 1,000 simulated futures. Each month's return is drawn from the expected return and volatility. The volatility is weighted by the tagged holdings' classes: equity 15%, retirement 6%, deposits 1%, gold and property 12%. The results are shown in today's rupees, with the 10th–90th percentile band, the median, and the chance of reaching the cost.
  - A fixed random seed makes the picture the same on every device.
- A holding set aside more than 100% across goals is flagged.

Outlooks (M7) will get their own tab in the same style.

## 7. Core logic (`src/core`)

Pure functions with no UI or network code, covered by unit and randomized tests, as in Bhag.

1. **Money** (`money.ts`): integer paise; `formatINR` (₹12,34,567.89), `formatRupees` (₹38,420), `formatShort` (₹44.8L, ₹6.4 Cr, with 99.96 lakh shown as ₹1 Cr). **Dates** (`dates.ts`): `YYYY-MM-DD` strings, adding months clamps to month end (31 Jan + 1 month = 28/29 Feb), financial year (FY 2026–27 is 1 Apr 2026 to 31 Mar 2027).
2. **EPF, PPF, SSY** (`savings.ts`): one engine for schemes that credit interest once a year. Each month's interest is balance × declared rate / 12. The year's total is rounded to the rupee and credited on 31 March, with no compounding within the year. For EPF a contribution counts from the month it is credited. For PPF and SSY a deposit after the 5th counts from the next month. Before 31 March the result shows the interest so far as "accrued". A year with no declared rate uses the latest rate and is marked as an estimate. Employee, employer and VPF shares are separate holdings using the same engine. EPS is shown but not counted in net worth. "Reconcile with passbook" records the true balance (M5).
3. **FD, RD, NSC, KVP, SCSS, PO MIS** (`deposits.ts`): compound interest with part periods, A = P(1 + r/n)^(n·days/365). Schemes that pay interest out stay at their principal, and `payoutPerPeriod` gives the payout. Each RD installment grows from its own date. These are estimates between statements, because banks count days slightly differently.
4. **Loans** (`loans.ts`): reducing balance. EMI and each month's interest are rounded to the rupee, and the last EMI clears the balance exactly. Rate changes and prepayments apply from the next EMI. For each, the owner picks **keep EMI, change the number of EMIs** (the usual bank default) or **keep the end date, change the EMI**. If a rate rise means the EMI no longer covers the interest, the EMI is raised. `loanStatus` gives the outstanding amount, EMIs paid and left, interest paid and the next EMI date.
5. **Market holdings** (`market.ts`): units are a decimal string (MF units have 3 decimals), and value = units × price is worked out exactly with BigInt and rounded to the paisa. Gain and gain %. A fund's `Code` is its AMFI scheme code or its ISIN; the morning AMFI file is matched on either (`prices.ts`).
10. **CAS import** (`cas.ts`, PDF text in `src/data/pdfText.ts`):
   - **On the device only:** pdf.js (loaded only on the import screen) opens the password-protected PDF (usually the PAN) and turns it into lines. The PDF and the password are never sent anywhere; only the holdings the owner imports go to the sheet.
   - **CAMS + KFintech detailed CAS:** one block per folio, read from `ISIN:`, `Closing Unit Balance`, `NAV on <date>`, `Total Cost Value` and `Market Value on <date>`. A name the PDF wrapped onto two lines is joined.
   - **Row statements (CAMS summary, NSDL/CDSL):** a line with one ISIN and numbers is taken only if three of its numbers, in order, agree as units × price ≈ value (within 0.5% or ₹1), so a row read the wrong way is dropped, not imported wrong. Rows that cannot be read are listed by name.
   - **Funds** (ISIN `INF…`): folios of the same scheme are added into one holding. A fund updates the mutual fund with the same ISIN, else the one with the same name; the owner can change each choice, add it as new or skip it. Units, cost and ISIN come from the statement; the owner's name and notes are kept, and so is a newer price. Sold-out funds are skipped unless they match a holding (which then goes to 0 units).
   - **Shares and bonds** (other ISINs) are imported as stocks when the owner types the NSE symbol, since GOOGLEFINANCE does not take ISINs.
   - **After the import:** values follow AMFI's NAV every morning. Units change only with a newer CAS (or by hand), so new SIP instalments show up at the next import.
6. **Net worth:** sum by class, liabilities negative. A snapshot is saved once a day when the app opens, and the Dashboard time ranges (1D … All, YTD, FY) read from snapshots.
7. **Goals** (`goals.ts`): future cost = today's cost × (1 + inflation)^years. Money already set aside grows at the expected return. SIP needed assumes the SIP is invested at the start of each month, at the monthly rate equal to the yearly return ((1+R)^(1/12) − 1), and is rounded up to the next ₹100. A holding can be split across goals by percentage; the parts must add up to 100% or less.
8. **Forecast:** 1,000 runs of monthly returns per asset class (normal distribution from expected return and volatility), run in a Web Worker. Shows the median and the 10th to 90th percentile in today's rupees, and the chance of reaching the target. Fixed-rate assets and loans are calculated, not simulated.
9. **Transactions:** transfer pairing, duplicate flagging, category rules, monthly spending totals.

## 8. AI with the owner's Gemini key (M7)

Shared by Ask and the Outlook:

- **Key:** the owner's own Gemini API key, entered in Settings on each device, kept in that browser only (section 4). Settings has Save, **Test key** (a cheap authenticated call), Remove, and a link to Google AI Studio. The owner should make a key just for Jhapi, in its own Google Cloud project, so its use can be seen and switched off on its own.
- **Calls:** straight from the browser to the Gemini REST API (`streamGenerateContent`, streamed), with `credentials: 'omit'`. No server of ours sits in between, and the Apps Script never sees the key.
- **Model:** a setting, `gemini-flash-latest` by default. If it is busy, slow to start (40 s) or retired, the app tries `gemini-flash-lite-latest`, but only before any reply text has shown.
- **Free tier:** on Gemini's free tier Google may use what is sent to improve its products, and people may read it. Ask says so before the first question, and says that turning on billing for the key's project stops it.

### 8.1 Ask (chat about your money)

A chat tab, in the style of the owner's other apps' chat: a status line, suggestion chips, a growing text box with Send and Stop, streamed answers, **New chat**, and **Copy**.

**How an answer is made: lookups, not bulk data.** Gemini is never sent the transactions or holdings in bulk. It is given read-only lookup tools; it calls them, the app runs them on the device's copy of the data (`withPending(snapshot)`, so unsent edits count), and only the results go back. A question may take up to 5 lookups; then Gemini writes the answer.

| Lookup | Returns |
|---|---|
| `spending_by` (from, to, group by category / payee / month / account, money out or in) | Totals and counts per group, top 20 |
| `find_transactions` (from, to, text, category, min, max; at most 50) | Date, amount, direction, display name, category, bank name, counted or not |
| `recurring_payments` | Payees paid on a regular cycle (subscriptions, rent, SIPs) with amount and cycle |
| `holdings_summary` | Value per class and per holding (name and type), with how the value was found |
| `loans_summary` | Outstanding, EMI, rate, months left per loan |
| `goals_summary` | Each goal's status, funded %, SIP needed vs planned, chance |
| `today` | Today's date, the financial year, when data was last synced and last read from email |

- **Every number comes from a lookup.** The system prompt tells Gemini not to work out totals itself and to say when the data does not cover the question (for example, before the first email was read). Rupee amounts are sent as rupees, not paise.
- **Display names** are sent, not the bank's raw name, when one is set. Bank names are sent as "Axis Bank", never with the last digits.
- **Never sent:** account or card numbers, reference numbers, balances (unless the owner asks about a balance; then only that figure), notes, email text, the sheet's secret code or URL.
- **What Gemini saw:** every answer has a closed-by-default "What Gemini saw (N lookups)" list naming each lookup, its range and how many rows went out. The first time Ask opens, a card explains what is and is not sent; it stays until **Got it**.
- **Links back into the app:** an answer can carry buttons such as "See 34 October Food transactions", which open Transactions with the search filled in (`/transactions?q=`, as **See all N from …** does).
- **Suggested changes:** with the Settings switch on (default on), Gemini can suggest a change through two tools, `suggest_category` (payee or picked transactions → category, optionally also as a rule) and `suggest_display_name`. The app shows a card: what changes, how many rows, the total, with **Apply**, **Review in Transactions** (opens Pick mode with those rows picked) and **Dismiss**. Nothing changes until Apply, which goes through `saveTxns` / `setDisplayName` like any edit and syncs. Gemini is told afterwards whether it was applied or dismissed.
- **Chats** stay in memory on the device until **New chat** or a reload. They are not saved to the sheet. (Keeping recent chats on the device can come later.)
- **Errors** read plainly: no key (with a link to Settings), key refused, offline, model busy, Stopped.
- Answers carry a line: model output from the owner's data, not financial advice.
- **Tests:** each lookup against fixed data; the tool loop with a fake streamer (lookup → result → answer; 5-lookup cap; a tool name not offered is ignored); that a request body never contains an account number, reference or note from the fixture; Apply and Dismiss on a suggested change; the key only in the header.

### 8.2 AI Outlook

- Runs when the app is opened and the last outlook is more than a day old, or on **Refresh now**. A web app cannot wake itself at a set time.
- Gemini, with Google Search grounding, is asked for recent rate, inflation and market news, and to suggest changes to the owner's **baseline** expected return and volatility for each market asset class.
- Suggestions are clamped: return within ±2 percentage points of baseline, volatility between 0.8× and 1.5× of baseline. The forecast itself is computed locally (section 7.8).
- Only asset classes and rounded totals are sent to Gemini, never account numbers, transactions or names.
- **Track record:** when an outlook's horizon passes, the app checks whether the real value landed inside the 10th to 90th range and shows the hit rate. About 80% is the target.
- Every screen says it is model output, not investment advice.

## 9. Screens

Built for **iPhone and iPad in Safari**. Phone layout uses the 390px design width from the design canvas.

- **iPhone** (under 700px wide): one column, bottom tab bar, safe-area padding for the home indicator.
- **iPad** (700px and wider, portrait and landscape, including Split View): a side bar instead of the bottom tabs, and two columns where it helps: list and detail side by side for Transactions and Portfolio, and Dashboard cards in a grid. Today the side bar and the two-column Home grid are built; list-and-detail side by side comes with M5.
- Touch first: 44px targets, no hover-only controls (hover highlights only on devices with a pointer, so a tapped row does not stay lit on iPhone), inputs at 16px or larger so Safari does not zoom in, and the right keyboards (`inputmode="decimal"` for amounts).
- Works with the iPad keyboard and trackpad, and with Dynamic Type sizes.

| Screen | What it shows |
|---|---|
| Home ✅ | This month's spending and money received, needs-review banner, card bills due, net worth with a 1M/3M/6M/1Y/FY/All chart, goals, spending by category, accounts with the latest balance a bank email gave, recent transactions (with display names) |
| Transactions ✅ | All / Needs review tabs, search (bank name or display name, category, amount), "show receipts", grouped by day. Each row shows the display name, the bank's name in small type under it when they differ, then account · category · time. **Pick** turns rows into checkboxes with a bar above the tab bar: **Pick all shown**, **Set category**, **Don't count**, **Count again**. Needs review lists Not parsed and Blocked emails with **Add by hand**, **Mark done** and **Read bank emails now** |
| Add / edit transaction ✅ | **See all N from <sender>**, money out/in, amount, date, payee, **Show as** (display name for every row with this payee), category, **Also use <category> for the N other transactions from <sender>**, **Always use <category> for <payee>, including future emails** (a rule), account, note, "do not count", delete |
| Settings ✅ | Connect the sheet (web app URL and secret code), last sync and last email run, rows the sheet could not read, Sync now, Read bank emails now, category rules, **display names** (each with Remove), Disconnect this device |
| Portfolio ✅ | Net worth from holdings, then each class (Retirement, Market, Deposits, Gold & other, Liabilities) with its total; each holding shows how its value was found (CALC, PRICE, EMI, MANUAL) and what is missing; Update prices now |
| Add / edit holding ✅ | Type picker grouped by class, then only the fields that type needs, with a live "value today" preview |
| Goals ✅ | On track / behind counts and monthly SIP gap; a card per goal with cost today and in the target year, funded %, SIP needed vs planned, chance of reaching it; a warning when a holding is set aside more than 100% |
| Goal detail ✅ | Name, cost, year, inflation, SIP, optional return; a share box for each holding; live cost in target year, set aside today, SIP needed, forecast band and chance |
| EPF, Loan, other holding detail (M5c) | Balance, breakdown, rates by year, events (prepayments, rate changes), the matching actions |
| CAS import ✅ | Choose the PDF and type its password; then each fund with units, NAV and cost, and a choice (add as new, update a holding, skip); shares with an NSE symbol box; what could not be read; Import |
| Ask (M7) | Chat about spending, payees, subscriptions, holdings, loans and goals, with a one-time "what Gemini sees" card, chips, streamed answers, "What Gemini saw" under each answer, links into Transactions, and suggested-change cards with Apply |
| Settings: Gemini (M7) | Key (Save, Test key, Remove), model name, "Let Ask suggest changes", what Gemini sees |
| AI Outlook and asset detail (M7) | Portfolio and per-class ranges, assumption changes, drivers, track record |
| Lock screen ✅ | "Jhapi is locked", **Unlock with passkey**, the passkey's name, and "Can't use your passkey?" → **Forget this device's copy**. Settings has a **Passkey lock** card: Turn on; when on, Lock now and Turn off |

## 10. Build plan

Re-planned on 17 Nov 2026 when the owner chose the Google Sheet as the store.

| # | Scope | Done when |
|---|---|---|
| M0 ✅ | Repo scaffold copied from Bhag: Vite, React, PWA, oxlint, vitest, `deploy.yml`, new `base` path, design tokens from the canvas | Empty app is live on Pages and CI is green |
| M1 ✅ | `src/core`: money, FY, all calculators in section 7 (1–5, 7), with tests | Tests match hand-checked figures: ₹43,391 EMI on ₹50L at 8.5% for 20 years, NSC ₹1,000 → ₹1,449, PPF 5th-of-month rule, EPF month-end rule, ₹25L at 6% for 10 years → ₹44.77L |
| M4a ✅ | Parsers for Axis, ICICI, SBI, DBS, PhonePe and Amazon Pay; allow-list; synthetic tests and local real-sample tests | All 57 real samples give the expected result |
| M4b ✅ | Jhapi's own Apps Script (email reader with DKIM check, web app, onEdit), sheet layout, app sync (pull on open, push on edit, offline queue), Home, Transactions, Needs review, Add/edit, Settings | Script tests on fake Google pass, the app ↔ script round-trip test passes, deployed |
| M4c | ✅ Owner's category rules (Rules tab, "Always use…"), transfer pairing between own accounts, receipts improving bank rows. Still to do: live on the owner's sheet, a week of real mail | A week of real mail reads with nothing missed |
| M4d ✅ | Display names (Names tab, "Show as" on a transaction, list in Settings); "Also use … for the N other transactions from …" on a transaction; Pick mode on Transactions to change the category of, or stop counting, many at once | Round trip: an alias lands in the Names tab and shows on both rows; a sender-wide change and a picked set change both rows in the sheet |
| M5a ✅ | Holdings tab synced both ways; Portfolio and add/edit screens; values from the M1 calculators; net worth on Home (holdings + bank balances from emails − loans) | Round trip: a PPF added in the app shows the right value and lands in the sheet |
| M5b ✅ | Prices every morning (AMFI NAVs by scheme code or ISIN; GOOGLEFINANCE by symbol, through a helper tab), daily net worth snapshots, Home chart with 1M/3M/6M/1Y/FY/All, Update prices now | Script tests on fake Google (AMFI file, GOOGLEFINANCE, AMFI down, same-day rerun) |
| M5c | EPF/PPF/SSY declared rates by year; loan rate changes and prepayments entered in the app | Owner's EPF and loan match their statements |
| M6 ✅ | Goals tab synced both ways; Goals and goal detail screens; holdings set aside by share; SIP needed; 1,000-run forecast band and chance; over-100% warning; goals on Home | Round trip: a goal with a 50% share of a fund lands in the sheet and shows BEHIND with its chance |
| M7 | Gemini key in Settings; **Ask** (chat with lookups, "What Gemini saw", suggested changes); AI Outlook; Gemini fallback for unparsed emails | Tests with a fake Gemini pass (section 8.1); Ask answers "food this month vs last" correctly with a real key on the owner's iPhone |
| M8a ✅ | Passkey lock: data on the device encrypted with a key from the passkey's PRF; lock screen; auto-lock; turn off; forget this device | Tests: nothing readable left in storage once on; lock, unlock, wrong passkey, 5-minute auto-lock, turn off, forget. Live check on the owner's iPhone and iPad |
| M8b ✅ | CAS PDF import on the device (CAMS/KFintech detailed, CAMS summary, NSDL/CDSL); funds priced every morning by ISIN; shares by NSE symbol | Tests: a real AES-256 encrypted PDF through pdf.js; both statement layouts; import into the app, rows in the sheet, morning prices by ISIN. Live check with the owner's own CAS |
| M8 | CSV export, user guide in `docs/` synced to GitBook | Installed on the owner's phone and in daily use |

## 11. Risks

| Risk | Handling |
|---|---|
| Some banks send UPI alerts by SMS only | Found: ICICI and SBI savings UPI/ATM/NEFT, DBS credits. Add by hand in the app or the sheet |
| A bank changes its email layout | Fixtures and tests catch it. The email lands in Not parsed, never lost |
| Phishing email that looks like a bank | DKIM and sender-domain check; BLOCKED items never touch balances |
| Safari deletes website data after 7 days without a visit | The sheet is the copy to trust; the next open pulls everything again. Only the connection needs re-entering |
| Apps Script quotas | One person's bank mail is far below Gmail read limits |
| The sheet holds transactions and unparsed email text in plain form | It is the owner's own Google account, which already holds the same emails. The sheet stays plain; only the copy on each device is encrypted (M8a) |
| The web app answers anyone who has the URL and code | 64-character random code, constant-time check, never in the repo or the sheet; Disconnect removes it from a device; a new code can be made in Script properties |
| **Jhapi and Bhag share the browser origin `dasabhijit.github.io`** (GitHub Pages serves both from one host). Their saved keys do not collide (`jhapi.*`), but the browser lets pages on one origin read each other's storage, so Bhag's code could read Jhapi's saved secret code. The passkey lock (M8a) encrypts that copy, but Bhag's pages could still ask for the same passkey | Open, owner to decide (19 Nov 2026: passkey lock built here anyway; a move means new passkeys). Options: a custom domain for Jhapi (e.g. `jhapi.<your-domain>`, still on GitHub Pages), or hosting Jhapi under a separate GitHub account or organisation. Both give Jhapi its own origin |
| A device clock far behind Google's | Its edits look older than the sheet's rows and lose. Phones set their clocks from the network, so this is rare; the app says when an edit was not saved |
| A CAS layout the reader does not know (no sample of the owner's own CAS yet) | Funds it cannot read are listed, not guessed; row statements need units × price = value. Fix the reader from the owner's statement |
| AMFI or Google Finance unavailable or changes format | The day's prices are skipped and the Log says why; holdings keep their last price and date |
| Script and app disagree about an email | The script runs the app's own bundled parsers; CI fails if `Code.gs` is stale |

## 12. Open questions

1. Samples still to collect: HDFC, Kotak, NPS, EPF, insurance, salary slips, CAS.
