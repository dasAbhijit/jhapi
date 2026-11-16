# Jhapi: owner setup

The one-time steps only the owner can do, because they need the owner's own Google account. Everything else is built and deployed automatically.

| # | Step | Needed for | Status |
|---|---|---|---|
| 1 | Hosting on GitHub Pages | The app being live | Done: https://dasabhijit.github.io/jhapi/ |
| 2 | Google Cloud project, OAuth client ID and Picker API key | Google sign-in, Drive backup and sync, reading the Inbox sheet (M3, M4b) | **To do** |
| 3 | Gemini API key | Parsing emails the rules miss, AI Outlook (M4b, M7) | To do later, inside the app |
| 4 | Inbox sheet and Apps Script | Bank emails arriving in the app (M4a, M4b) | To do once the template is published |
| 5 | iPhone and iPad on iOS / iPadOS 18 or later | Unlocking with Face ID / Touch ID (passkey) | Check in Settings › General › About |

## 1. Hosting (done)

- Repo: https://github.com/dasAbhijit/jhapi (public, because free GitHub Pages needs that; no data or keys are in it).
- Every push to `main` runs lint, tests and the build, then deploys. Settings › Pages uses **GitHub Actions** as the source.
- Settings › Environments › `github-pages` must allow the `main` branch. This was already set.

## 2. Google Cloud: OAuth client ID and Picker API key

About 10 minutes, on a laptop. Sign in to https://console.cloud.google.com with **your personal Google account** (the Gmail that receives bank alerts).

1. **Create a project:** project menu (top left) › New project › name it `Jhapi` › Create, then select it.
2. **Turn on three APIs:** APIs & Services › Library. Search for each one and click Enable:
   - Google Drive API
   - Google Sheets API
   - Google Picker API
3. **Set up the consent screen** (APIs & Services › OAuth consent screen, also called Google Auth Platform › Branding/Audience/Data access):
   - App name `Jhapi`, support email and developer email: your Gmail.
   - Audience: **External**. Add your Gmail as a **test user**.
   - Data access › Add scopes: `.../auth/drive.appdata` and `.../auth/drive.file`. Both are non-sensitive, so Google does not need to review the app.
4. **Create the OAuth client:** Credentials › Create credentials › OAuth client ID:
   - Type: **Web application**, name `Jhapi web`.
   - Authorized JavaScript origins: `https://dasabhijit.github.io` and `http://localhost:5173`.
   - No redirect URIs.
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`).
5. **Create the API key for the Picker:** Credentials › Create credentials › API key, then Edit it:
   - Application restrictions: **Websites**: `https://dasabhijit.github.io/jhapi/*` and `http://localhost:5173/*`.
   - API restrictions: **Google Picker API** only.
   - Copy the key.
6. **Give the two values to Jhapi.** They are public by design (they ship inside the web page, and are locked to the site's address), so they are not secrets:
   - Either send them to Claude, which will set them, or
   - GitHub repo › Settings › Secrets and variables › Actions › **Variables** › add `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`, and put the same lines in `.env.local` for local development.

Never create or share a **client secret** or a service-account key. Jhapi does not use either.

## 3. Gemini API key (later)

Use the same kind of key as Bhag: https://aistudio.google.com/apikey › Create API key. Paste it into Jhapi › Settings when that screen exists. It is stored only inside the encrypted vault on your device.

## 4. Inbox sheet and Apps Script (later)

When M4 is ready, the app's Settings screen will link to a template Google Sheet. You will:

1. Open the link and click **Make a copy** (signed in with the Gmail that receives bank alerts).
2. In the copy: Extensions › Apps Script › choose `setup` › Run. Approve the permissions. Google warns "Google hasn't verified this app" because it is your own script: click Advanced › Go to Jhapi Inbox.
3. In Jhapi: Settings › Inbox sheet › Pick sheet, and choose the copy.

The script runs every 10 minutes under your account. It only reads emails from the bank senders listed in the sheet's Senders tab, and labels them `jhapi-done`.
