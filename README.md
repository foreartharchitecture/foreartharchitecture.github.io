# Forearth Studio

Founders' dashboard for Forearth Architecture as a standalone, installable web app.

- **Sign-in:** username and password, then a 6-digit code sent by email. A device can be remembered for 30 days.
- **Access levels:**
  - **Founder:** everything, including editing Notion.
  - **Staff:** read-only Studio pages (projects, tasks, calendar, project files).
  - Permissions are checked on the server, not just hidden in the page.
- **Data:** two-way sync with Notion, and read-only access to Google Drive (nothing is ever written to Drive).
- **Runs on:** Cloudflare Workers, free plan, at `https://forearth-studio.<your-subdomain>.workers.dev`. Works in any desktop browser and installs as an app on Android (Chrome) and iPhone (Safari → Add to Home Screen).

## How it fits together

| Part | Where |
|---|---|
| Worker: routing, security headers, API | `src/index.js` |
| Accounts, codes, sessions, access management | `src/auth.js`, `src/store.js` (SQLite Durable Object) |
| Notion adapter (views → API queries, two-way writes) | `src/notion.js`, `src/config.js` |
| Google Drive adapter (service account, read-only; staff limited to the Studio tree) | `src/drive.js` |
| Optional AI answers for founders (Anthropic API) | `src/ai.js` |
| Email sending via the firm's Gmail (Apps Script relay) | `src/mail.js`, `apps-script/Code.gs` |
| Sign-in pages | `public/login.html`, `public/login.js` |
| Dashboard (generated) | `public/app/index.html` ← `dashboard/dashboard.html` + `build/build.mjs` |
| Browser bridge (API calls, on-device cache, Word/Excel text) | `public/app/bridge.js` |
| Account menu, access panel, install prompts | `public/app/account.js` |
| Installable app | `public/manifest.webmanifest`, `public/sw.js` (generated), `public/icons/` |

`dashboard/dashboard.html` is the same dashboard that runs on claude.ai. `npm run build` applies checked patches to it (access levels, read-only staff mode, wording, scripts and app tags) and regenerates `public/app/index.html` and `public/sw.js`. The build fails loudly if the source changes in a way a patch no longer matches.

## Secrets (Cloudflare → Workers & Pages → forearth-studio → Settings → Variables and Secrets)

| Name | What |
|---|---|
| `SESSION_SECRET` | Long random value (use `/keygen` on the site). Changing it signs everyone out. |
| `FOUNDER_EMAILS` | Comma-separated founder emails allowed to self-register at `/setup`. |
| `MAIL_URL` | Apps Script web-app URL (see `apps-script/Code.gs`). |
| `MAIL_KEY` | Shared key; same value as `MAIL_KEY` in the Apps Script. |
| `NOTION_TOKEN` | Internal integration secret. Share each database with the integration. |
| `GOOGLE_SA_KEY` | Full JSON key of a Google service account with Viewer access to the Studio, Finance, Sales and Human Resources folders. |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI briefs and AI search answers for founders (billed per use). `AI_MODEL_QUICK`, `AI_MODEL_DEFAULT`, `AI_MODEL_COMPLEX` override the models. |

All are added as **Secret** type so deployments never overwrite them.

## Deploying

Connected to Cloudflare Workers Builds: every push to `main` deploys automatically. The generated files are committed, so no build command is needed (deploy command: `npx wrangler deploy`). After changing `dashboard/dashboard.html`, `public/app/*.js` or `build/`, run `npm run build` and commit the output.

## Local development and tests

```bash
npm install
python3 dev/make_fixtures.py        # invented test files
node dev/mock.mjs &                 # stand-ins for Notion, Drive, mail and AI on :8790
cp dev/dev.vars.example .dev.vars   # then add a test RSA key to GOOGLE_SA_KEY
npx wrangler dev --port 8787
node dev/api.test.mjs               # API, auth and permission tests (fresh local state)
node dev/seed.mjs && python3 dev/ui_test.py   # browser tests (Playwright)
```

## Limits worth knowing

- **Cloudflare Workers Free:** 100,000 requests a day and 10 ms CPU per request. The Worker only proxies; parsing happens in the browser.
- **Durable Objects (SQLite):** included in the free plan.
- **Apps Script mail:** consumer Gmail sends to about 100 recipients a day.
- **Notion:** writes made from the app show in Notion as made by the integration.
