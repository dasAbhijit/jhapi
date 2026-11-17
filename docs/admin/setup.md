# Jhapi: owner setup

The one-time steps only the owner can do, because they happen in the owner's own Google account. About 10 minutes, best done on a laptop. Everything else is built and deployed automatically.

Jhapi uses **its own Google Sheet and its own script**. Do not reuse the Pahadi Soul sheet, script, web app or secret code.

| # | Step | Status |
|---|---|---|
| 1 | Hosting on GitHub Pages | Done: https://dasabhijit.github.io/jhapi/ |
| 2 | Create Jhapi's sheet and script, deploy the web app | **To do** (below) |
| 3 | Connect the app on iPhone and iPad | **To do** (below) |
| 4 | Gemini API key | Later (M7) |

## 2. Create Jhapi's sheet and script

Sign in to Google with **your personal account, the Gmail that receives your bank alerts**.

1. **New sheet.** Go to https://sheets.new and name it `Jhapi`. This sheet is only for Jhapi.
2. **Open the script editor.** Extensions › Apps Script. A new project opens; rename it `Jhapi` (top left).
3. **Paste the script.**
   - Open https://github.com/dasAbhijit/jhapi/blob/main/cloud/Code.gs, click **Copy raw file** (the copy icon above the code).
   - In the editor, select everything in `Code.gs`, delete it, and paste. Click **Save** (the disk icon).
4. **Limit what the script may do (recommended).**
   - Project Settings (gear icon) › tick **Show "appsscript.json" manifest file in editor**.
   - Back in the Editor, open `appsscript.json`, replace its contents with https://github.com/dasAbhijit/jhapi/blob/main/cloud/appsscript.json, and Save.
   - This limits the script to **read-only Gmail**, this one sheet, its own timers, the sheet's menu, and fetching web pages (only AMFI's daily NAV file, for mutual fund prices).
5. **Run Set up once.**
   - In the editor's function list (next to Run), choose `setup` and click **Run**.
   - Google asks for permission. Choose your account. You will see "Google hasn't verified this app": this is your own script, so click **Advanced › Go to Jhapi (unsafe)**, then **Allow**.
   - The execution log shows the **secret code** (64 letters and digits). Copy it somewhere safe for the next steps. Set up also adds the tabs, turns on the 10-minute email check, and a 7 AM job that updates prices and saves the day's net worth.
   - Later, back in the sheet, the **Jhapi** menu has **Set up / show secret code** (shows the code again), **Read bank emails now** and **Update prices and net worth now**.
6. **Deploy the web app.**
   - Click **Deploy › New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - Description `Jhapi`. **Execute as: Me**. **Who has access: Anyone**. Click **Deploy** and allow again if asked.
   - Copy the **Web app URL** (it ends in `/exec`).
   - "Anyone" is needed because the app on GitHub Pages cannot sign in to Google for you. The web app refuses every call that does not carry the secret code.
7. **First email read.** In the editor choose `readInbox` and click **Run**. It reads the last 60 days of bank alerts (this can take a minute or two). The **Transactions**, **Statements** and **Review** tabs fill up, and the **Log** tab says what happened.

### When Jhapi's script changes

When the app gets a new version of the script, you will be told. Paste the new `Code.gs` as in step 3 (and `appsscript.json` as in step 4 if it changed), run `setup` once more (it only adds what is missing, such as a new trigger, and asks for any new permission), then **Deploy › Manage deployments › edit (pencil) › Version: New version › Deploy**. The URL and secret code stay the same, so the app needs no change.

## 3. Connect the app (each iPhone, iPad or browser)

1. Open https://dasabhijit.github.io/jhapi/ in Safari.
2. Settings › paste the **Web app URL** and the **secret code** › **Connect**.
3. Optional: Share › **Add to Home Screen**. Jhapi works fully in Safari without this; adding it stops Safari clearing its copy after a week without use.

Each device keeps its own copy of the URL and code. **Settings › Disconnect this device** removes them, along with the device's copy of the data. The sheet keeps everything.

## Using the sheet directly

- You can add a transaction by typing a new row in **Transactions**: at least **Date** (for example `16/11/2026`), **Amount** (in rupees) and **Type** (`Debit` or `Credit`). The ID and Updated columns fill in by themselves, and the app picks the row up on its next sync.
- In **Names** you can give a payee a display name: put the bank's spelling in **Name in email** and yours in **Show as**. The app shows yours, with the bank's in small type underneath.
- Editing any cell stamps the row's **Updated** time, so your change reaches the app. If the same row is edited in the app and in the sheet, the later edit wins.
- To delete, type `TRUE` in **Deleted** (the row stays, so the deletion syncs to the app). Rows marked deleted can be removed by hand later.
- **Goals** can be typed in too: at least `Name`, `Cost today` (rupees) and `Target year`. Setting holdings aside is easier in the app (Invest › Goals).
- Do not rename the tabs or the header row.

## Prices

- **Mutual funds:** put the fund's **AMFI scheme code** in the holding's Code (find it on amfiindia.com › NAV › the scheme, or in your CAS statement). The NAV is fetched every morning.
- **Stocks, ETFs and SGBs:** put the symbol in Code, e.g. `TCS` (taken as NSE) or `BOM:500325`. Prices come from Google Finance through the hidden helper tab **Prices (auto)**; do not edit that tab.
- A holding without a code keeps the price you type.

## Security notes

- The secret code is never written into the sheet or the repo. To change it: Apps Script › Project Settings › Script properties › edit `JHAPI_TOKEN` (any 64 hex characters), then reconnect each device.
- The script only reads emails from the bank addresses listed in `src/core/parsers/index.ts`, and only from your own Gmail. It never labels, moves, sends or deletes email.
- How far back the first run reads is the `JHAPI_BACKFILL_DAYS` script property (default 60).
