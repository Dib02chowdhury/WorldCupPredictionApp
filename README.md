# World Cup Prediction League

A mobile-first, premium football prediction experience designed for GitHub Pages hosting.

## Features
- Mobile-first responsive UI with sticky bottom navigation
- Home, upcoming matches, my predictions, leaderboard views
- PWA support with splash screen, app icon, and offline caching
- Demo authentication and prediction flows
- Admin dashboard for matches and results

## Structure
- index.html: main app shell
- css/styles.css: premium mobile UI styling
- js/app.js: app logic, sample data, and interactions
- manifest.json: PWA manifest
- sw.js: service worker for offline caching
- assets/icons: icons for installability

## Run locally
Open index.html in a browser, or serve the folder with a simple static server.

Example with Python:
```bash
python -m http.server 8000
```
Then open http://localhost:8000.

## GitHub Pages deployment
1. Push this folder to a GitHub repository.
2. In GitHub, open Settings > Pages.
3. Select Deploy from a branch.
4. Choose the main branch and /root folder.
5. Save and wait for the site to publish.

## Connect to Google Sheets
1. Create a new Google Sheet and copy its spreadsheet ID from the URL.
2. Open [backend/Code.gs](backend/Code.gs) and replace `PASTE_YOUR_SHEET_ID_HERE` with your spreadsheet ID.
3. In Google Apps Script, create a new project and paste the contents of [backend/Code.gs](backend/Code.gs).
4. Deploy the script as a Web App and copy the web app URL.
5. Create a file named [config.js](config.js) and set `window.GOOGLE_APPS_SCRIPT_URL = 'YOUR_WEB_APP_URL';`.
6. Reload the app and it will start loading from the sheet.

## Next steps
- Replace demo data with your real Google Apps Script backend.
- Add more write actions for users and results if you want full admin control from the sheet.
- Add real authentication, admin protections, and persistence.
