# Jhapi: requirements

What the app must do, and how each item will be checked. For how it is built, see the [design](DESIGN.md).

## 1. Purpose and user

One person (the owner) tracks their whole financial picture in rupees: day-to-day spending read automatically from bank alert emails, every asset and loan, net worth over time, goals, and a forecast. The owner uses it mostly on a phone, sometimes on a Mac.

There is one user and one role. There is no sharing.

## 2. Verification key

| Mark | Meaning |
|---|---|
| **Planned** | Not built yet |
| **Auto** | Covered by automated tests that run in CI before every deploy |
| **Fixture** | Checked against saved real emails or sample data |
| **Live** | Checked by hand on the deployed site with real data |

Every requirement starts as **Planned**. The milestone column refers to the build plan in [DESIGN.md](DESIGN.md#10-build-plan).

## 3. Functional requirements

### A. Sheet, sync and security

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| A1 | All data lives in Jhapi's own Google Sheet, in the owner's account. Jhapi shares no sheet, script, URL or code with any other app | M4b | Built so: `cloud/` and the setup guide make a new sheet and script just for Jhapi |
| A2 | The script's web app answers only calls with the secret code (64 random characters, made by Set up, kept in Script properties) | M4b | Auto (wrong, missing and not-set-up cases) |
| A3 | The app sends the code only to a `script.google.com/macros/s/…/exec` address | M4b | Auto (round-trip test uses the check); unit check in `validateUrl` |
| A4 | The app pulls the whole sheet every time it opens, when it returns to the foreground after a minute, when it comes back online, and on Sync now | M4b | Auto (round trip: connect, sync now) |
| A5 | Edits in the app show at once, are queued on the device, and are pushed to the sheet; offline edits wait for the next sync | M4b | Auto (round trip: added transaction lands in the sheet, queue empties) |
| A6 | Rows typed into the sheet by hand, in any common date style, appear in the app with an ID added | M4b | Auto (script test and round trip) |
| A7 | When a row was edited in the sheet after the app's edit, the sheet wins and the app says so | M4b | Auto (script test) |
| A8 | A push with any bad record is refused whole and changes nothing | M4b | Auto |
| A9 | Disconnect this device removes the URL, code, copy of the sheet and unsent changes from the device | M4b | Built; Open for a hand check |
| A10 | Data on the device is encrypted, unlocked by passphrase or passkey | M8 | Planned |

### B. Setup

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| B1 | The owner sets up Jhapi's sheet in about 10 minutes on a laptop: new sheet, paste `Code.gs`, run Set up, deploy the web app, paste URL and code into the app | M4b | Steps written in `docs/admin/setup.md`; Open until the owner does it |
| B2 | Set up makes the tabs, the secret code and one 10-minute trigger, and is safe to run again | M4b | Auto |
| B3 | The script asks only for read-only Gmail, this sheet, triggers and the sheet's menu | M4b | Set in `cloud/appsscript.json`; Open until approved for real |

### C. Email import

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| C1 | New bank emails become sheet rows within about 10 minutes, with the app closed | M4b | Auto (script on fake Gmail); Open for real mail |
| C2 | Only emails from allow-listed sender addresses are read, on old and new (`.bank.in`) domains | M4a | Auto |
| C3 | An email whose sender fails Gmail's DKIM check for the bank's domain, or whose From is not at that domain, goes to Review as Blocked, without its text, and never changes any total | M4b | Auto (fail, wrong domain, look-alike domain, forged results header, folded header) |
| C4 | Each supported email type gives the right amount, direction, account, date, time, payee and reference | M4a | Auto (27 synthetic layouts) and Fixture (all 57 of the owner's real samples, local) |
| C5 | An email from a trusted sender that cannot be read goes to Review with its text; the owner can add it by hand and mark it done | M4b | Auto (script and screens) |
| C6 | The same email is never added twice, and a second alert for the same money is skipped | M4b | Auto |
| C7 | Every message in a Gmail thread is read (Gmail groups alerts with the same subject) | M4b | Auto |
| C8 | The script never labels, moves or changes an email | M4b | Built so (read-only scope); Open until approved for real |
| C9 | Email text is never treated as instructions | M4a | Built so: parsers only match patterns; no AI reads email yet |
| C10 | Gemini can read emails the rules miss, with the owner confirming the result | M7 | Planned |

### D. Transactions

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| D1 | The owner sees all transactions newest first, grouped by day, with search, and a Needs review list with a count | M4b | Auto (round trip); Open for a hand check on iPhone and iPad |
| D2 | The owner can add, edit, recategorise, mark as not counted, or delete a transaction | M4b | Auto (add); Open for edit and delete by hand |
| D3 | Receipts (PhonePe, YONO and similar copies) are kept but never counted, and hidden unless asked for | M4b | Auto |
| D4 | Card bill payments and transfers between own accounts are left out of spending | M4c | Auto (pairing by UPI handle, same person, card bill; no false pairs for strangers, other amounts, far dates) |
| D5 | Home shows this month's spending and money received, spending by category, card bills due, accounts with the latest known balance, and recent transactions | M4b | Auto (spending total in the round trip); Open for a hand check |
| D6 | The owner can set their own category rules, applied to new emails, and recategorise past rows from the same payee | M4c | Auto (script applies rules; round trip saves a rule and recategorises) |
| D7 | A receipt that repeats a bank alert improves the bank's row (payee, category) | M4c | Auto |

### E. Portfolio

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| E1 | The owner can add every asset and liability type in the Add entry picker, from the app or the sheet | M5a | Auto (round trip adds a PPF; script reads hand-typed rows and reports unknown types). Search in the picker: planned |
| E2 | Each holding shows its value, how the value was found (calculated, price, EMI schedule, manual) and what is missing | M5a | Auto (valuation tests); Open for a hand check |
| E3 | EPF shows employee, employer and VPF shares, interest by declared rate per year credited on 31 March, EPS kept out of net worth, and reconciliation with the passbook | M5 | Planned |
| E4 | PPF, NSC, SCSS, KVP, PO MIS, Sukanya Samriddhi, FD and RD values are calculated from their rates and dates | M1, M5 | Auto (calculations, 11 tests). Screens planned |
| E5 | Loans show outstanding principal, EMI, rate, EMIs left, interest paid, and handle rate changes and prepayments | M1, M5 | Auto (calculations, 6 tests). Screens planned |
| E6 | Stocks, ETFs and SGBs are valued from daily prices; mutual funds from daily NAVs | M5b | Units × price built (M5a); automatic prices planned |
| E7 | EMI and contribution emails update the matching loan or holding | M5 | Planned |
| E8 | The owner can import a CAS statement PDF for mutual funds and demat holdings | M8 | Planned |

### F. Net worth

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| F1 | Net worth is assets minus liabilities, shown by class | M5a | Auto (summary test); Home adds bank balances reported by emails |
| F2 | The Dashboard shows the change and a chart for 1D, 1W, 1M, 3M, 6M, 1Y, YTD, FY (April to March), 5Y and All | M5 | Planned |
| F3 | A net worth snapshot is saved once a day the app is opened | M5 | Planned |

### G. Goals

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| G1 | The owner can create goals with a cost in today's rupees, a target year and an inflation rate | M6 | Planned |
| G2 | Each goal shows cost at the target year, amount funded, gap, SIP planned and SIP needed | M6 | Planned |
| G3 | Holdings can be tagged to goals by percentage, never more than 100% in total per holding | M6 | Planned |
| G4 | Each goal shows a forecast band (10th to 90th percentile and median, in today's rupees) and the chance of reaching it | M6 | Planned |
| G5 | Goals under 3 years away with equity tagged show a suggestion to move part to debt | M6 | Planned |

### H. AI Outlook

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| H1 | The owner can enter a Gemini key, kept only on the device | M7 | Planned |
| H2 | The outlook refreshes when the app opens if it is more than a day old, and on Refresh now | M7 | Planned |
| H3 | Gemini can only adjust expected return and volatility within the allowed limits. The screen shows each change and the news behind it | M7 | Planned |
| H4 | Only asset classes and rounded totals are sent to Gemini | M7 | Planned |
| H5 | Fixed-rate assets and loans are calculated, not predicted | M7 | Planned |
| H6 | The track record shows how often past ranges were right | M7 | Planned |
| H7 | Every outlook screen says it is model output and not investment advice | M7 | Planned |

### I. App

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| I1 | Works fully in Safari on iPhone and iPad without being installed. Can also be added to the Home Screen, and installed from desktop Chrome | M0, M8 | Planned |
| I2 | Opens and shows the last copy of the sheet with no connection | M4b | Built; Open for a hand check in airplane mode |
| I5 | On iPad, uses the wider screen: a side bar, and list and detail side by side, in portrait, landscape and Split View | M5 | Planned |
| I6 | If Safari has deleted the data on a device, everything comes back from the sheet after reconnecting | M4b | Built (the sheet is the copy to trust) |
| I3 | The owner can export transactions and holdings as CSV, with formula-looking cells made safe | M8 | Planned |
| I4 | A user guide lives in `docs/` and syncs to GitBook | M8 | Planned |

## 4. Non-functional requirements

| ID | Requirement | Verified |
|---|---|---|
| N1 | Money is stored as integer paise and every total adds up to the paisa | Auto for the calculators (loan principal sums exactly, market values use exact arithmetic) |
| N2 | No secret is in the repo or the build: not the sheet's code, URL, or any real email | Built so (`samples/` git-ignored, code entered at runtime) |
| N3 | Built and tested first on Safari for iOS and iPadOS 18 and later. Also works on desktop Chrome | Planned |
| N4 | Unlock to Dashboard in under 2 seconds with 5 years of data on a recent iPhone | Planned |
| N5 | Accessible: real controls with labels, 44px touch targets, 4.5:1 text contrast | Planned |
| N6 | Lint, all tests and a fresh-`Code.gs` check pass in CI before every deploy | Live (GitHub Actions) |
