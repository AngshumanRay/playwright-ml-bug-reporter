# Automated Bug Reporting and Severity Classification Using Machine Learning and Playwright Test Automation

An end-to-end system that runs automated browser tests with **Playwright**. It does the following on its own:

* captures every failure as a bug report
* predicts the bug's **severity (Critical / Major / Minor)** with a **Machine Learning** model
* stores everything in **SQLite**
* detects **flaky tests**
* checks every link on every page of a website and reports **broken links**
* emails an alert with screenshots whenever a **Critical** bug is detected
* shows a **web dashboard** with analytics
* includes a **Test Runner** web page, so a manual tester can choose a suite (Smoke, Sanity, Regression, Broken links), enter email IDs, press **Run**, and see the report in the same page, without VS Code or any commands

```
 Playwright tests ──► Failure detected ──► ML severity prediction ──► SQLite ──► Web dashboard
  (tests/*.spec.ts)    (custom reporter)     (Naive Bayes model)       (bugs.db)   (Express + EJS)     
                                                    │
                                                    └──► Critical? ──► Email alert
```

> For a step-by-step explanation of how everything works and a demo script, see **[WALKTHROUGH.md](WALKTHROUGH.md)**.

> **Demo video (2.5 min, with subtitles):** [demo-video/Test_Runner_Demo.mp4](demo-video/Test_Runner_Demo.mp4). Subtitles are shown in the video and also included as [Test_Runner_Demo.srt](demo-video/Test_Runner_Demo.srt). To download it from GitHub, open the file and click the download button (↓).

### Quick start for manual testers (no VS Code needed)

1. Install **Node.js** (LTS) once from https://nodejs.org.
2. Double-click **`Start Test Runner.command`** (Mac) or **`Start Test Runner.bat`** (Windows) in the project folder. The first start installs everything automatically, which takes a few minutes, only once.
3. The browser opens the **Test Runner** at http://localhost:3000. Nothing runs until you choose a suite and press **Run tests**. A browser window then opens (headed mode), and you can watch the tests while the results arrive. The full report opens in the same page.

Notes:
* **Keep the small black window open** while you use the Test Runner; closing it stops it. Next time, just double-click the same file again.
* `http://localhost:3000` only opens **after** the launcher has been started on that computer.
* **First start blocked?**
  * **Mac:** if the file is blocked, right-click it → **Open**. If you get "you don't have the right access privileges", run `chmod +x "Start Test Runner.command"` in Terminal once.
  * **Windows:** if "Windows protected your PC" appears, click **More info → Run anyway**.

### Testing the website manually

The website under test is **ShopEase**, a demo shop included in this project, at **http://localhost:4000** (login `student` / `Password@123`). It is not a public website: it runs on your computer.

**To open it:** start the Test Runner (double-click the launcher). ShopEase starts together with it. Then click **ShopEase ↗** in the top bar of the Test Runner, or open http://localhost:4000. It stays available as long as the black window is open. Section 7 lists every page and the bugs to look for.

If http://localhost:4000 does not open, the Test Runner is not running on that computer: double-click the launcher first. Developers can also start only the website with `npm run demo-app`.

`localhost` only works on the computer where it runs. Colleagues on the same network can use that computer's address instead, e.g. `http://192.168.1.20:4000` (website) or `http://192.168.1.20:3000` (Test Runner).

---

## 1. Project objectives and where each is implemented

| # | Objective | Implementation |
|---|-----------|----------------|
| 1 | Automate bug logging: capture error message, screenshot, timestamp and module from Playwright runs | [src/reporter/bugReporter.ts](src/reporter/bugReporter.ts) (custom Playwright reporter) |
| 2 | Classify severity (Critical / Major / Minor) with an ML model trained on labelled error messages | [src/ml/](src/ml/): [training-data.csv](src/ml/training-data.csv), [naiveBayes.ts](src/ml/naiveBayes.ts), [train.ts](src/ml/train.ts) |
| 3 | Store defects and test-run summaries in a central SQLite database | [src/db/database.ts](src/db/database.ts) → `data/bugs.db` |
| 4 | Web dashboard to view, filter, search and update bug status (Open → In Progress → Resolved) | [src/dashboard/](src/dashboard/) → `/bugs`, `/bugs/:id` |
| 5 | Charts: bugs per module, severity distribution, 14-day trend | [src/dashboard/views/analytics.ejs](src/dashboard/views/analytics.ejs) → `/analytics` |
| 6 | Detect flaky tests that pass and fail inconsistently across runs | [src/flaky/flakyDetector.ts](src/flaky/flakyDetector.ts) → `/flaky` |
| 7 | Automatic email alert whenever a Critical bug is detected (with screenshots) | [src/alerts/criticalAlertEmail.ts](src/alerts/criticalAlertEmail.ts), [src/alerts/emailNotifier.ts](src/alerts/emailNotifier.ts) |
| 8 | Complete end-to-end pipeline | [scripts/run-pipeline.ts](scripts/run-pipeline.ts) → `npm run pipeline` |
| + | Additional: Test Runner UI: run Smoke / Sanity / Regression / Broken links from the browser, enter email IDs, see the report in the same UI, keep a date-named run history | [src/runner/](src/runner/), [src/dashboard/views/runner.ejs](src/dashboard/views/runner.ejs) → `npm start` |
| + | Additional: crawl a website and report broken links | [src/links/linkCrawler.ts](src/links/linkCrawler.ts), [tests/links.spec.ts](tests/links.spec.ts) → `npm run test:links` |

---

## 2. Technology stack

| Purpose | Technology | Version |
|---|---|---|
| Language | TypeScript (run with `tsx`) | TypeScript 7.0, tsx 4.23 |
| Runtime | Node.js | 22 or newer |
| Test automation | Playwright Test (`@playwright/test`) | **1.64.1 (latest)** |
| Machine learning | Multinomial Naive Bayes, implemented from scratch in TypeScript | — |
| Database | SQLite via `better-sqlite3` | better-sqlite3 13 (SQLite 3.53) |
| Web dashboard | Express + EJS templates, charts drawn in plain HTML/CSS | Express 5.3, EJS 7 |
| Email | Nodemailer (SMTP) | 10.1 |
| Configuration | dotenv (`.env` file) | 18 |

---

## 3. Project structure

```
playwright-ml-bug-reporter/
├── demo-app/                    Application under test ("ShopEase" web shop with seeded defects)
│   ├── server.ts                Express server + REST APIs (login, products, cart, checkout, profile, orders)
│   └── public/                  HTML pages, CSS and JavaScript of the shop
├── tests/                       Playwright test suites, one per module (tagged @Login, @Search, ...)
│   ├── login.spec.ts
│   ├── search.spec.ts
│   ├── cart.spec.ts
│   ├── checkout.spec.ts
│   ├── profile.spec.ts
│   └── links.spec.ts            Crawls the website and reports every broken link
├── src/
│   ├── config.ts                All settings (paths, ports, email, flaky thresholds)
│   ├── reporter/bugReporter.ts  Custom Playwright reporter: capture → classify → store → alert
│   ├── ml/
│   │   ├── training-data.csv    179 labelled error messages (severity, error_message)
│   │   ├── textPreprocessor.ts  Cleaning + tokenisation + bigrams
│   │   ├── naiveBayes.ts        Multinomial Naive Bayes classifier
│   │   ├── train.ts             Training + evaluation (accuracy, precision, recall, F1, confusion matrix, 5-fold CV)
│   │   ├── classifier.ts        Loads the saved model and predicts severity
│   │   └── model/severity-model.json   Trained model
│   ├── db/database.ts           SQLite schema and all queries
│   ├── flaky/flakyDetector.ts   Flaky test analysis across runs
│   ├── links/linkCrawler.ts     Website crawler + HTTP status check of every link
│   ├── alerts/criticalAlertEmail.ts  Critical bug email: details + screenshot of every Critical bug
│   ├── alerts/emailNotifier.ts  Sends the email via SMTP, or saves an HTML preview
│   ├── alerts/runReportEmail.ts Run report email for the addresses entered in the Test Runner
│   ├── runner/
│   │   ├── suites.ts            Smoke / Sanity / Regression / Broken links (Playwright tags)
│   │   ├── runManager.ts        Starts / stops Playwright from the UI, live log, report + email at the end
│   │   └── runReport.ts         Run report data, date-prefixed names, self-contained HTML report
│   └── dashboard/               Express web dashboard + Test Runner (server.ts, views/*.ejs, public/*)
├── Start Test Runner.command    Double-click launcher (Mac)
├── Start Test Runner.bat        Double-click launcher (Windows)
├── scripts/
│   ├── start.ts                 npm start: trains the model if needed, starts the UI, opens the browser
│   ├── run-pipeline.ts          Full end-to-end pipeline
│   ├── generate-report.ts       Self-contained HTML results report
│   ├── seed-history.ts          OPTIONAL simulated 13-day history (for the trend chart demo)
│   └── reset-db.ts              Clears database, screenshots and alert previews
├── data/bugs.db                 SQLite database (created automatically)
├── reports/screenshots/         Screenshot of every failure
├── reports/alerts/              Email alert previews (when SMTP is not configured)
├── reports/bug-report.html      Results report: runs, bugs, charts, flaky analysis, ML metrics, screenshots
├── reports/playwright-html/     Playwright's built-in HTML test report (last run)
├── reports/runs/                One self-contained HTML report per Test Runner run, named with its date first
├── playwright.config.ts         Playwright configuration (registers the custom reporter)
├── .env.example                 Template for email / port settings
├── demo-video/                 Demo video of the Test Runner (MP4 with subtitles + .srt file)
├── presentation/              Project presentation (PowerPoint)
├── README.md
└── WALKTHROUGH.md
```

---

## 4. Installation

Prerequisites: **Node.js 22+** (check with `node --version`).

```bash
git clone https://github.com/AngshumanRay/playwright-ml-bug-reporter.git
cd playwright-ml-bug-reporter
npm install                        # installs all dependencies
npx playwright install chromium    # downloads the browser used by Playwright
cp .env.example .env               # optional: only needed for real email alerts / custom ports
```

---

## 5. How to run

### From the browser: Test Runner (recommended for manual testers)

```bash
npm start               # or double-click "Start Test Runner" - opens http://localhost:3000
```

See section 13 for how the Test Runner works.

### One command: complete pipeline

```bash
npm run pipeline        # trains the model if needed, runs the test suite 5 times, detects flaky tests,
                        # and writes the report to reports/bug-report.html
npm run dashboard       # open http://localhost:3000
```

### Individual commands

| Command | What it does |
|---|---|
| `npm run train` | Trains the ML model and prints accuracy, precision, recall, F1, confusion matrix and 5-fold cross-validation |
| `npm test` | Runs the Playwright suite once (the demo app starts automatically); failures are logged as bugs |
| `npm run test:headed` | Same, with a visible browser (add `SLOW_MO=500` to slow it down) |
| `npm run test:links` | Only the broken link checker (see section 12) |
| `npm run pipeline` | Full pipeline. Options: `-- --runs=10`, `-- --retrain`, `-- --dashboard` |
| `npm run flaky` | Prints the flaky-test report in the terminal |
| `npm start` | Starts the Test Runner + dashboard (http://localhost:3000) **and the ShopEase website** (http://localhost:4000), and opens the Test Runner in the browser |
| `npm run dashboard` | Same server, without opening the browser |
| `npm run report` | Writes the results report `reports/bug-report.html` (also generated automatically at the end of `npm run pipeline`) |
| `npm run demo-app` | Starts only the ShopEase demo app at http://localhost:4000 (to explore it manually) |
| `npm run seed:history` | OPTIONAL: adds **simulated** bugs for the previous 13 days so the 14-day trend chart has data |
| `npm run db:reset` | Deletes all runs, bugs, screenshots and alert previews (fresh start) |
| `npx tsx src/ml/classifier.ts "500 error on payment"` | Predicts the severity of any error text |
| `npm run typecheck` | TypeScript type check of the whole project |

---

## 6. Email alert for Critical bugs (configuration)

**Rule:** when a test run ends and **any Critical bug was detected** in it, **one email** is sent to every address in `ALERT_TO`. It doesn't matter whether the bug is new or was already known. A run with no Critical bug sends no email.

The email contains:
* the number of Critical bugs and the modules they are in, with the tests executed and failed for context
* a table of the Critical bugs (ID, module, test, new or known, in how many runs it failed)
* for each Critical bug: test, file, time detected, browser, ML confidence, dashboard link, the full error message, and a **clear screenshot of the page at the moment of failure**, shown inside the email
* one line counting the Major and Minor bugs in the same run

`npm test` sends this email when the run ends. `npm run pipeline` runs the suite several times, so it sends **one** email at the end covering all its runs, with the full HTML report attached.

By default nothing is emailed: until an email account is set up, every email is saved as a file in `reports/alerts/` instead (e.g. `critical-alert-run-<run>.html`). The Test Runner warns about this in red as soon as you enter an email address.

### Setting up the sending account (one time)

Testers only type the **recipient** addresses in the Test Runner. Every email is sent **from** one email account, which is set once in the `.env` file by whoever installs the project. Gmail and other providers only accept email from a logged-in account, so this step is required.

1. Create a Gmail **App Password**: Google Account → Security → turn on 2-Step Verification → https://myaccount.google.com/apppasswords → Create → copy the 16 letters.
2. Copy `.env.example` to `.env` (in the project folder) and fill in:

```ini
ALERTS_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_16_character_app_password
ALERT_FROM=your_email@gmail.com
ALERT_TO=guide@example.com,team@example.com
```

3. Save the file. That's all: it is read again before every email, so no restart is needed. From now on, the addresses typed in the Test Runner receive the reports. `ALERT_TO` is optional; it lists people who always get the Critical bug alerts.

Your normal Gmail password will not work; it must be an App Password. `.env` stays on this computer and is never uploaded to GitHub.

If sending fails (wrong password, no internet), the test run still completes, and the terminal shows the error, e.g. `Critical bug email (4 Critical bug(s)) FAILED: Invalid login`.

---

## 7. The application under test (ShopEase) and its seeded defects

`demo-app/` is a small web shop built for this project, at **http://localhost:4000** (login `student` / `Password@123`). It starts together with the Test Runner (`npm start` / the launcher), or on its own with `npm run demo-app`. Defects were **deliberately seeded** into it, so the pipeline has realistic failures to detect.

**Manual check of every seeded defect:**

| Page | URL | What to do | What you will see |
|---|---|---|---|
| Login | /login.html | Username `O'Brien`, any password | Database error (Critical) |
| Products / Search | /products.html | Search `laptop` vs `LAPTOP`; read the heading | Uppercase finds nothing (Major); "Avaliable Products" (Minor) |
| Cart | /cart.html | Add Wireless Mouse, set quantity 2 | Total $58.00 instead of $59.98 (Major) |
| Checkout | /checkout.html | Fill all fields, Place Order | "500 Internal Server Error: Payment gateway crashed" (Critical) |
| Profile | /profile.html | Look at the form | Label "Adress", grey Save button (Minor) |
| Order history | /orders.html | Open the page | Empty table: the page crashed (Critical) |
| Footer (every page) | Help Center · Terms and Conditions · Spec sheet (PDF) on Laptop Pro 14 | Click them | 500 error (Critical) · Not Found (Major) · Not Found (Major) |

**Automated tests and the defect each one finds:**

| Module | Test | Seeded defect | Expected ML severity |
|---|---|---|---|
| Login | username with special characters is handled safely | Apostrophe breaks the SQL query → database error shown | **Critical** |
| Search | search is case-insensitive | Search is case-sensitive ("LAPTOP" finds nothing) | **Major** |
| Search | products page heading is spelled correctly | Heading says "Avaliable Products" | **Minor** |
| Cart | cart total equals price multiplied by quantity | `parseInt` drops the cents ($58.00 instead of $59.98) | **Major** |
| Cart | adding a product updates the cart badge | API responds in a random 0.3–3 s → **flaky** | Major |
| Checkout | placing an order shows the confirmation | Payment gateway returns HTTP 500 | **Critical** |
| Profile | saving the profile shows a success message | API responds in a random 0.3–3 s → **flaky** | Major |
| Profile | address label is spelled correctly | Label says "Adress" | **Minor** |
| Profile | save button uses the brand primary colour | Grey button instead of brand blue | **Minor** |
| Profile | order history loads without JavaScript errors | Uncaught `TypeError` crashes the page | **Critical** |
| Links | all links on the website are reachable | Footer "Help Center" link returns HTTP 500 | **Critical** |
| Links | all links on the website are reachable | Footer "Terms and Conditions" page does not exist (404) | **Major** |
| Links | all links on the website are reachable | "Spec sheet (PDF)" link on Laptop Pro 14 does not exist (404) | **Major** |

There are 17 tests in total: 11 tests that find seeded defects (including the 2 flaky tests and the link checker) and 6 tests that always pass (valid login, invalid password message, search for "Laptop", remove from cart, zip-code validation, profile username). The link checker is one test, but it logs **each broken link as a separate bug**, so one run produces 13 bugs.

---

## 8. Machine learning model

* **Algorithm:** Multinomial Naive Bayes with Laplace smoothing, written from scratch in TypeScript ([naiveBayes.ts](src/ml/naiveBayes.ts)), so every step can be explained.
* **Features:** words and word pairs (bigrams) from the error message. The text is lower-cased, numbers are replaced by `num`, HTTP status codes are kept as tokens (`http500`), and stop-words and Playwright boilerplate lines (`Locator:`, `Timeout:`) are removed ([textPreprocessor.ts](src/ml/textPreprocessor.ts)).
* **Dataset:** 179 labelled error messages ([training-data.csv](src/ml/training-data.csv)): 65 Critical, 60 Major, 54 Minor.
  * Critical = crashes, HTTP 5xx, data loss, security, payment failures.
  * Major = broken functionality, wrong calculations, timeouts, wrong navigation.
  * Minor = typos, labels, colours, alignment, cosmetic issues.
* **Evaluation** (`npm run train`):

| Metric | Result |
|---|---|
| Hold-out accuracy (stratified 80/20 split, 36 test samples) | **86.1%** |
| 5-fold stratified cross-validation, mean accuracy | **87.2%** |
| Critical: precision / recall / F1 | 100% / 84.6% / 91.7% |
| Major: precision / recall / F1 | 70.6% / 100% / 82.8% |
| Minor: precision / recall / F1 | 100% / 72.7% / 84.2% |

Confusion matrix on the hold-out set (rows = actual, columns = predicted):

|  | Critical | Major | Minor |
|---|---|---|---|
| **Critical** | 11 | 2 | 0 |
| **Major** | 0 | 12 | 0 |
| **Minor** | 0 | 3 | 8 |

On the real Playwright failures from the demo app, the model classifies **all 13 seeded defects as expected** (10 functional defects and 3 broken links) (see the table in section 7). The confidence of each prediction is stored with the bug and shown in the dashboard.

---

## 9. Database design (SQLite, `data/bugs.db`)

| Table | Purpose | Main columns |
|---|---|---|
| `test_runs` | One row per Playwright execution (run summary) | started_at, finished_at, status, total, passed, failed, skipped, duration_ms, new_bugs, suite, trigger_source, recipients, email_mode, email_status, planned_total, report_file |
| `test_results` | One row per test per run (history for flaky detection) | run_id, test_key, title, module, status, duration_ms, error_message, screenshot_path, executed_at |
| `bugs` | One row per unique defect | test_key, module, error_message, error_stack, screenshot_path, severity, confidence, status, occurrences, alert_sent, created_at, last_seen_at |
| `bug_history` | Every status change (audit trail / traceability) | bug_id, old_status, new_status, changed_at |
| `bug_occurrences` | Every run in which a bug was seen (used by the Critical bug email) | bug_id, run_id, seen_at |

**De-duplication:** each bug has a fingerprint, calculated as SHA-1 of the test name plus the error text with digits removed. If the same failure happens again while the bug is still Open or In Progress, the bug's `occurrences` counter goes up and no duplicate is created. If a **Resolved** bug fails again, a new bug is opened, because that is a regression.

---

## 10. Dashboard pages (http://localhost:3000)

| Page | Contents |
|---|---|
| **Test Runner** `/` | Suite dropdown, email ID(s) box, **Run** button, live progress with each test's result, Stop button, recent runs (see section 13) |
| **Run History** `/runs` | Every run grouped by day, named with its date first (`2026-10-22 14:29 · Smoke · Run #10`), filter by suite |
| **Run report** `/runs/:id` | Pass rate, results by module, bugs by severity, every test with its error and screenshot, bugs found, email status, **Download report** and **Run again** |
| **Analytics** `/analytics` | Four key numbers (open bugs, unresolved Critical bugs, pass rate of the last run, flaky tests), bugs per module, bugs by severity, and new bugs per day for the last 14 days by severity. Every number and bar opens the matching bug list |
| **Bugs** `/bugs` | All bugs with filters (severity, status, module), text search (bug ID, test name or error text) and one-click status buttons (→ In Progress, → Resolved) |
| **Bug details** `/bugs/:id` | Full error message, stack trace, failure screenshot, ML prediction with confidence, test stability history, status update, status history |
| **Flaky Tests** `/flaky` | Flaky tests with failure rate, flip rate and pass/fail history; stability verdict for every test |

The dashboard supports light and dark mode (it follows the operating-system setting) and works on mobile screens.

---

## 11. Flaky test detection

Over the last **10 runs** (minimum 3), each test gets one of these verdicts:

* **Flaky:** it passed at least once **and** failed at least once.
* **Consistently failing:** it failed every time. This is a real defect, not flakiness.
* **Stable:** it passed every time.

Two measures are shown:

* **failure rate** = failed runs / runs
* **flip rate** = number of pass↔fail changes / (runs − 1)

Playwright retries are disabled on purpose (`retries: 0`), so flakiness is measured honestly across independent runs.

---

## 12. Broken link checker

[tests/links.spec.ts](tests/links.spec.ts) (module **Links**) uses [src/links/linkCrawler.ts](src/links/linkCrawler.ts):

1. **Crawl:** it starts at one page and opens every page of the same website in a real browser, up to `LINK_CHECK_MAX_PAGES`. Because it uses a real browser, links added by JavaScript are found too. It collects every `<a href>` link. `mailto:`, `tel:`, `javascript:` and `#` links are skipped.
2. **Check:** every unique link is requested and its HTTP status recorded. HEAD is tried first, then GET, because some servers don't answer HEAD. Links to other websites are checked but not crawled.
3. **Report:** a link is **broken** if it answers HTTP 4xx/5xx or cannot be reached. Each broken link is a separate soft assertion, so the reporter logs it as its own bug, titled `Broken link: <url>`. The bug lists the pages where the link was found, and its severity comes from the ML model like any other bug. Repeat runs increase the bug's occurrence count instead of creating duplicates.

The full list of every link and its status is attached to the Playwright HTML report as `link-check-report.json`.

**Checking any website.** Set the start URL in `.env`, or on the command line:

```bash
LINK_CHECK_START_URL=https://your-website.com npm run test:links
```

| Setting (`.env`) | Default | Meaning |
|---|---|---|
| `LINK_CHECK_START_URL` | `/` | A path on the app under test, or the full URL of any website |
| `LINK_CHECK_MAX_PAGES` | `50` | Maximum number of pages to crawl |
| `LINK_CHECK_EXTERNAL` | `true` | Also check links that point to other websites |
| `LINK_CHECK_TIMEOUT_MS` | `10000` | Time limit for each page or link |

---

## 13. Test Runner (UI for manual testers)

The Test Runner lets anyone run the automated tests from the browser, with no VS Code and no commands.

**Using it**

1. Start it: double-click `Start Test Runner.command` (Mac) or `Start Test Runner.bat` (Windows), or run `npm start`. The browser opens http://localhost:3000.
2. **Test suite** dropdown: choose the suite (the number of tests is shown next to each).
3. **Email ID(s)**: type an address and press Enter; add as many as needed. Invalid addresses turn red. The last addresses are remembered.
4. **Send the report email**: *Only if a Critical bug is found* (the default: the email goes out automatically as soon as a run finds a Critical bug) or *After every run*.
5. **Show the browser while testing** (on by default): the tests run in **headed mode**. A browser window opens and the tests run one at a time, so you can watch them. Switch it off for a faster run in the background.
6. Press **Run tests**. A progress bar, passed/failed counters, the elapsed time and each test's result appear live; the Playwright log is one click away. **Stop** ends the run early.
7. When the run finishes: **Open full report**, **Re-run failed tests**, **Download**, and the email status are shown. If the email could not be sent, the status says **NOT SENT** in red, with the reason.
8. **Re-run failed tests (N)** on the finished panel or on any report runs **only the tests that failed** in that run. On a report, each failed test also has its own **Re-run** button that runs just that one test, with the same suite and email addresses. The re-run is named e.g. `2026-10-24 12:06 · Smoke (re-run of #16) · Run #17`. The run appears under **Recent runs** and in **Run History**.

**Suites** (defined in [src/runner/suites.ts](src/runner/suites.ts); a test joins a suite with a Playwright tag, e.g. `test('...', { tag: ['@smoke', '@sanity'] }, ...)`)

| Suite | Tests | What it covers |
|---|---|---|
| Smoke | 5 | Quick health check of the most important user journeys (`@smoke`) |
| Sanity | 11 | Core functionality of every module (`@sanity`) |
| Regression | 17 | Every test, including the broken link check |
| Broken links | 1 | Crawl the whole website and report every broken link (`@Links`) |

**The report** opens in the same UI at `/runs/<id>`:
* a header with the date-prefixed run name, status, suite, duration and email status
* a pass-rate ring and the totals
* results by module and bugs by severity, with a Critical callout
* every test grouped by module; click a failed test to see its error and screenshot, and click a screenshot to enlarge it
* bug cards with screenshots

**Download report** saves the same report as one self-contained HTML file. A copy of every run's report is also kept in `reports/runs/`, named with the date first, e.g. `2026-10-22_1429_smoke_run-10.html`.

**Emails.** When the run ends, the addresses entered in the UI receive the **run report email**:
* the result and the numbers
* the Critical bugs
* every failed test with its ML severity and a screenshot inside the email
* an **Open the full report** button
* the full report attached

The Critical bug alert (section 6) still goes to `ALERT_TO` from `.env`, except to addresses that already receive the run report. Set `DASHBOARD_URL` in `.env` to this computer's network address (e.g. `http://192.168.1.20:3000`) so the email button works for colleagues.

Only one run can run at a time; starting a second one shows a message instead.

**Emails not arriving?** If the Test Runner shows a red warning or **NOT SENT**, the sending account in `.env` is missing or wrong (section 6). The report page and the black terminal window show the exact reason.

---

## 14. Troubleshooting

| Problem | Solution |
|---|---|
| ShopEase (http://localhost:4000) or the Test Runner does not open | The black window must be open and show `✓ ShopEase is up`. If it shows a red message, follow it: *Port … already in use* → close the other black window (or set `DASHBOARD_PORT` / `DEMO_APP_PORT` in `.env`); *Installation FAILED* → check the internet connection and double-click again; *Node.js … too old / not installed* → install the LTS from nodejs.org. Use the address on the **same computer** where the black window runs |
| `Severity model not found` | Run `npm run train` |
| `Executable doesn't exist` (browser) | Run `npx playwright install chromium` |
| Port 3000 or 4000 already in use | Change `DASHBOARD_PORT` / `DEMO_APP_PORT` in `.env` |
| No flaky tests shown | Flaky detection needs at least 3 runs: `npm run pipeline` |
| 14-day trend shows only today | Expected on a fresh install. Run tests on different days, or use `npm run seed:history` for a demo |
| Email not received | Add the sending Gmail address and its **App Password** to `.env` (section 6). The run's email status on its report shows the exact reason. Also check the spam folder |
| `better-sqlite3` build error after a Node upgrade | `npm rebuild better-sqlite3` |
| Want a clean start | `npm run db:reset` |
| "Start Test Runner" does nothing on Mac | Right-click it → **Open** (first time only), or run `npm start` in a terminal |
| Run History / report links in emails don't open for colleagues | Set `DASHBOARD_URL` in `.env` to this computer's network address and keep the Test Runner running |
| Link checker reports external links as broken | Some sites block automated requests; set `LINK_CHECK_EXTERNAL=false` to check only your own site's links |
