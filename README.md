# Automated Bug Reporting and Severity Classification Using Machine Learning and Playwright Test Automation

An end-to-end system that runs automated browser tests with **Playwright**. It does the following on its own:

* captures every failure as a bug report
* predicts the bug's **severity (Critical / Major / Minor)** with a **Machine Learning** model
* stores everything in **SQLite**
* detects **flaky tests**
* checks every link on every page of a website and reports **broken links**
* emails an alert with screenshots whenever a **Critical** bug is detected
* shows a **web dashboard** with analytics

```
 Playwright tests ──► Failure detected ──► ML severity prediction ──► SQLite ──► Web dashboard
  (tests/*.spec.ts)    (custom reporter)     (Naive Bayes model)       (bugs.db)   (Express + Chart.js)
                                                    │
                                                    └──► Critical? ──► Email alert
```

> For a step-by-step explanation of how everything works and a demo script, see **[WALKTHROUGH.md](WALKTHROUGH.md)**.

---

## 1. Project objectives and where each is implemented

| # | Objective | Implementation |
|---|-----------|----------------|
| 1 | Automate bug logging: capture error message, screenshot, timestamp and module from Playwright runs | [src/reporter/bugReporter.ts](src/reporter/bugReporter.ts) (custom Playwright reporter) |
| 2 | Classify severity (Critical / Major / Minor) with an ML model trained on labelled error messages | [src/ml/](src/ml/): [training-data.csv](src/ml/training-data.csv), [naiveBayes.ts](src/ml/naiveBayes.ts), [train.ts](src/ml/train.ts) |
| 3 | Store defects and test-run summaries in a central SQLite database | [src/db/database.ts](src/db/database.ts) → `data/bugs.db` |
| 4 | Web dashboard to view, filter, search and update bug status (Open → In Progress → Resolved) | [src/dashboard/](src/dashboard/) → `/bugs`, `/bugs/:id` |
| 5 | Charts: bugs per module, severity distribution, 14-day trend | [src/dashboard/public/charts.js](src/dashboard/public/charts.js) → `/` |
| 6 | Detect flaky tests that pass and fail inconsistently across runs | [src/flaky/flakyDetector.ts](src/flaky/flakyDetector.ts) → `/flaky` |
| 7 | Automatic email alert whenever a Critical bug is detected (with screenshots) | [src/alerts/criticalAlertEmail.ts](src/alerts/criticalAlertEmail.ts), [src/alerts/emailNotifier.ts](src/alerts/emailNotifier.ts) |
| 8 | Complete end-to-end pipeline | [scripts/run-pipeline.ts](scripts/run-pipeline.ts) → `npm run pipeline` |
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
| Web dashboard | Express + EJS templates + Chart.js | Express 5.3, EJS 7, Chart.js 4.5.1 |
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
│   └── dashboard/               Express web dashboard (server.ts, views/*.ejs, public/*)
├── scripts/
│   ├── run-pipeline.ts          Full end-to-end pipeline
│   ├── generate-report.ts       Self-contained HTML results report
│   ├── seed-history.ts          OPTIONAL simulated 13-day history (for the trend chart demo)
│   └── reset-db.ts              Clears database, screenshots and alert previews
├── data/bugs.db                 SQLite database (created automatically)
├── reports/screenshots/         Screenshot of every failure
├── reports/alerts/              Email alert previews (when SMTP is not configured)
├── reports/bug-report.html      Results report: runs, bugs, charts, flaky analysis, ML metrics, screenshots
├── reports/playwright-html/     Playwright's built-in HTML test report (last run)
├── playwright.config.ts         Playwright configuration (registers the custom reporter)
├── .env.example                 Template for email / port settings
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

### One command: complete pipeline (recommended for the demo)

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
| `npm run dashboard` | Starts the web dashboard at http://localhost:3000 |
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

By default (`ALERTS_ENABLED=false`) nothing is emailed. The email is saved as `reports/alerts/critical-alert-run-<run>.html` instead, so the feature can be shown without an email account.

To send real emails, edit `.env`:

```ini
ALERTS_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_16_character_app_password
ALERT_FROM=your_email@gmail.com
ALERT_TO=guide@example.com,team@example.com
```

For Gmail, turn on 2-Step Verification and create an **App Password** (Google Account → Security → App passwords). Your normal Gmail password will not work.

If sending fails (wrong password, no internet), the test run still completes, and the terminal shows the error, e.g. `Critical bug email (4 Critical bug(s)) FAILED: Invalid login`.

---

## 7. The application under test (ShopEase) and its seeded defects

`demo-app/` is a small web shop built for this project. Defects were **deliberately seeded** into it, so the pipeline has realistic failures to detect.

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
| `test_runs` | One row per Playwright execution (run summary) | started_at, finished_at, status, total, passed, failed, skipped, duration_ms, new_bugs |
| `test_results` | One row per test per run (history for flaky detection) | run_id, test_key, title, module, status, duration_ms, error_message, executed_at |
| `bugs` | One row per unique defect | test_key, module, error_message, error_stack, screenshot_path, severity, confidence, status, occurrences, alert_sent, created_at, last_seen_at |
| `bug_history` | Every status change (audit trail / traceability) | bug_id, old_status, new_status, changed_at |
| `bug_occurrences` | Every run in which a bug was seen (used by the Critical bug email) | bug_id, run_id, seen_at |

**De-duplication:** each bug has a fingerprint, calculated as SHA-1 of the test name plus the error text with digits removed. If the same failure happens again while the bug is still Open or In Progress, the bug's `occurrences` counter goes up and no duplicate is created. If a **Resolved** bug fails again, a new bug is opened, because that is a regression.

---

## 10. Dashboard pages (http://localhost:3000)

| Page | Contents |
|---|---|
| **Overview** `/` | KPI cards (total, open, unresolved Critical, flaky tests, runs), bar chart of bugs per module, severity distribution chart, 14-day stacked trend chart, latest runs. Each chart has a "View data table" option |
| **Bugs** `/bugs` | All bugs with filters (severity, status, module), text search (bug ID, test name or error text) and one-click status buttons (→ In Progress, → Resolved) |
| **Bug details** `/bugs/:id` | Full error message, stack trace, failure screenshot, ML prediction with confidence, test stability history, status update, status history |
| **Flaky Tests** `/flaky` | Flaky tests with failure rate, flip rate and pass/fail history; stability verdict for every test |
| **Test Runs** `/runs` | Summary of every run (passed, failed, pass rate, new bugs, duration) |

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

## 13. Troubleshooting

| Problem | Solution |
|---|---|
| `Severity model not found` | Run `npm run train` |
| `Executable doesn't exist` (browser) | Run `npx playwright install chromium` |
| Port 3000 or 4000 already in use | Change `DASHBOARD_PORT` / `DEMO_APP_PORT` in `.env` |
| No flaky tests shown | Flaky detection needs at least 3 runs: `npm run pipeline` |
| 14-day trend shows only today | Expected on a fresh install. Run tests on different days, or use `npm run seed:history` for a demo |
| Email not received | Check `ALERTS_ENABLED=true`, use a Gmail **App Password**, check the terminal message after the run |
| `better-sqlite3` build error after a Node upgrade | `npm rebuild better-sqlite3` |
| Want a clean start | `npm run db:reset` |
| Link checker reports external links as broken | Some sites block automated requests; set `LINK_CHECK_EXTERNAL=false` to check only your own site's links |
