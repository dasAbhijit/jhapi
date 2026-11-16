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

### A. Unlock and security

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| A1 | All financial data is encrypted on the device. Nothing readable leaves the device except what the owner sends to Gemini | M2 | Planned |
| A2 | The owner sets a passphrase at first use and can unlock with it | M2 | Planned |
| A3 | The owner can add a passkey and unlock with it, where the browser supports it | M2 | Planned |
| A4 | A recovery key is shown once at setup and can unlock the data if the passphrase is lost. It can be regenerated | M2 | Planned |
| A5 | The app locks after a chosen idle time and on Lock now | M2 | Planned |
| A6 | The owner can change the passphrase without losing data | M2 | Planned |
| A7 | A wrong passphrase is refused, with no hint about the data | M2 | Planned |
| A8 | The setup screen says plainly that losing the passphrase, passkeys and recovery key means losing the data | M2 | Planned |

### B. Google, backup and devices

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| B1 | The owner signs in with Google. The app asks only for the hidden app folder in Drive and the one sheet the owner picks | M3 | Planned |
| B2 | Every change is backed up, encrypted, to Drive. The screen shows pending changes | M3 | Planned |
| B3 | A change on one device appears on the other devices the next time they open or come to the foreground | M3 | Planned |
| B4 | When two devices change the same item, the later change wins and nothing else is lost | M3 | Planned |
| B5 | A new device can restore everything from Drive after unlocking | M3 | Planned |
| B6 | The owner sees each device with its last-seen time and can remove one from the list | M3 | Planned |

### C. Email import

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| C1 | The owner can set up email import once by copying a template sheet, approving the script and picking the sheet in the app | M4a | Planned |
| C2 | Bank alerts arrive in the app within about 10 minutes of reaching Gmail, without the app being open | M4a | Planned |
| C3 | Only emails from senders on the allow-list are read | M4a | Planned |
| C4 | An email whose sender fails the bank signature (DKIM) or domain check is marked Blocked, shown with the reason, and never changes any balance | M4a | Planned |
| C5 | Each supported email type gives the right amount, direction, account, date, merchant and reference | M4a | Planned |
| C6 | An email from a trusted sender that cannot be parsed appears in Needs review with its subject, and can be entered manually, parsed with Gemini (confirmed by the owner), or ignored | M4b | Planned |
| C7 | The same email is never imported twice | M4a | Planned |
| C8 | Two different emails that look like the same transaction are flagged as a likely duplicate | M4b | Planned |
| C9 | Script errors are visible in the app | M4b | Planned |
| C10 | Email text is never treated as instructions, including when sent to Gemini | M4b | Planned |

### D. Transactions

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| D1 | The owner sees all transactions newest first, and a Needs review list with a count | M4b | Planned |
| D2 | The owner can confirm, edit, recategorise, ignore or delete a transaction, and add one by hand | M4b | Planned |
| D3 | Transfers between the owner's own accounts, including credit card bill payments, are paired and left out of spending | M4b | Planned |
| D4 | A category change can be applied to the same merchant from then on | M4b | Planned |
| D5 | The Dashboard shows this month's spending and the latest transactions | M5 | Planned |

### E. Portfolio

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| E1 | The owner can add every asset and liability type in the Add entry picker, and search the list | M5 | Planned |
| E2 | Each holding shows its value, how the value was found (price feed, statement, calculated, manual) and the date of that value | M5 | Planned |
| E3 | EPF shows employee, employer and VPF shares, interest by declared rate per year credited on 31 March, EPS kept out of net worth, and reconciliation with the passbook | M5 | Planned |
| E4 | PPF, NSC, SCSS, KVP, PO MIS, Sukanya Samriddhi, FD and RD values are calculated from their rates and dates | M1, M5 | Planned |
| E5 | Loans show outstanding principal, EMI, rate, EMIs left, interest paid, and handle rate changes and prepayments | M1, M5 | Planned |
| E6 | Stocks, ETFs and SGBs are valued from daily prices; mutual funds from daily NAVs | M5 | Planned |
| E7 | EMI and contribution emails update the matching loan or holding | M5 | Planned |
| E8 | The owner can import a CAS statement PDF for mutual funds and demat holdings | M8 | Planned |

### F. Net worth

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| F1 | Net worth is assets minus liabilities, shown by class | M5 | Planned |
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
| H1 | The owner can enter a Gemini key, stored only inside the encrypted data | M4b | Planned |
| H2 | The outlook refreshes when the app opens if it is more than a day old, and on Refresh now | M7 | Planned |
| H3 | Gemini can only adjust expected return and volatility within the allowed limits. The screen shows each change and the news behind it | M7 | Planned |
| H4 | Only asset classes and rounded totals are sent to Gemini | M7 | Planned |
| H5 | Fixed-rate assets and loans are calculated, not predicted | M7 | Planned |
| H6 | The track record shows how often past ranges were right | M7 | Planned |
| H7 | Every outlook screen says it is model output and not investment advice | M7 | Planned |

### I. App

| ID | Requirement | Milestone | Verified |
|---|---|---|---|
| I1 | Installs to the home screen on iPhone and Android, and as an app on desktop Chrome | M0, M8 | Planned |
| I2 | Opens and shows stored data with no connection | M2 | Planned |
| I3 | The owner can export transactions and holdings as CSV, with formula-looking cells made safe | M8 | Planned |
| I4 | A user guide lives in `docs/` and syncs to GitBook | M8 | Planned |

## 4. Non-functional requirements

| ID | Requirement | Verified |
|---|---|---|
| N1 | Money is stored as integer paise and every total adds up to the paisa | Planned |
| N2 | No secret key is in the repo or the build. Only the restricted Google client ID and Picker key are public | Planned |
| N3 | Works on the latest iOS Safari, Android Chrome and desktop Chrome | Planned |
| N4 | Unlock to Dashboard in under 2 seconds with 5 years of data on a recent phone | Planned |
| N5 | Accessible: real controls with labels, 44px touch targets, 4.5:1 text contrast | Planned |
| N6 | Lint and all tests pass in CI before every deploy | Planned |
