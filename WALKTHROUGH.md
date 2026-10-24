# Project Walkthrough

**Automated Bug Reporting and Severity Classification Using Machine Learning and Playwright Test Automation**

This document explains, in simple steps, how the project works, how to demonstrate it live, and how to answer the questions an examiner is likely to ask. Installation and command reference are in [README.md](README.md).

---

## Part A: The problem and the idea

**Problem.** In manual testing, when a test fails, a tester has to:

1. read the error,
2. take a screenshot,
3. write a bug report (what failed, where, when),
4. decide how serious it is,
5. enter it in a bug tracker,
6. tell the team if it is urgent.

This is slow and repetitive. Severity is decided by personal judgement, so it is often inconsistent. Unstable ("flaky") tests waste time because nobody knows whether a failure is real.

**Idea.** Let the test framework do all of this automatically:

```
 ┌──────────────┐   ┌───────────────────┐   ┌────────────────────┐   ┌──────────────┐   ┌─────────────────┐
 │  Playwright  │──►│ Custom Reporter   │──►│ ML Severity Model  │──►│   SQLite DB   │──►│  Web Dashboard  │
 │  test runs   │   │ captures failure: │   │ Naive Bayes reads  │   │ runs, results,│   │ view, filter,   │
 │ (5 modules)  │   │ error, screenshot,│   │ the error message, │   │ bugs, history │   │ search, update, │
 │              │   │ timestamp, module │   │ predicts Critical/ │   │               │   │ charts, flaky   │
 └──────────────┘   └───────────────────┘   │ Major/Minor + conf.│   └──────┬───────┘   └─────────────────┘
                                            └─────────┬──────────┘          │
                                                      │ Critical            │ results of many runs
                                                      ▼                     ▼
                                               ┌─────────────┐      ┌─────────────────┐
                                               │ Email alert │      │ Flaky detector  │
                                               └─────────────┘      └─────────────────┘
```

---

## Part B: Following one bug through the system

This is the clearest way to explain the project. Below is the life of one real failure from the demo: the **payment crash on checkout**.

### Step 1: The application has a defect

In `demo-app/server.ts` the checkout API always fails:

```ts
app.post('/api/checkout', (_req, res) => {
  res.status(500).json({ error: '500 Internal Server Error: Payment gateway crashed while processing the transaction' });
});
```

### Step 2: A Playwright test finds it

`tests/checkout.spec.ts` behaves like a real user. It fills the form, clicks **Place Order**, and expects a confirmation:

```ts
test.describe('Checkout', { tag: '@Checkout' }, () => {        // ← the tag gives the MODULE
  test('placing an order shows the confirmation', async ({ page }) => {
    await page.getByLabel('Full Name').fill('Shruti');
    ...
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByRole('status'),
      'Placing an order should complete the payment and show the order confirmation',
    ).toHaveText('Order confirmed! Thank you for shopping.');
  });
});
```

The page shows the 500 error instead of the confirmation, so the assertion fails. In `playwright.config.ts`, `screenshot: 'only-on-failure'` makes Playwright take a screenshot at that moment.

### Step 3: The custom reporter captures the failure (Objective 1)

Playwright lets us plug in our own **reporter**: a class whose methods Playwright calls during the run. Ours is `src/reporter/bugReporter.ts`, registered in `playwright.config.ts`:

```ts
reporter: [['list'], ['./src/reporter/bugReporter.ts']],
```

| Playwright hook | What our reporter does |
|---|---|
| `onBegin()` | Creates a new row in `test_runs` |
| `onTestEnd(test, result)` | Saves the result in `test_results`; if the test failed, it builds a bug: **error message** (`result.errors`, cleaned of colour codes and the long "Call log"), **screenshot** (copied from `result.attachments` into `reports/screenshots/`), **timestamp** (start time + duration), **module** (from the `@Checkout` tag), plus test name, file, browser and stack trace |
| `onEnd()` | Saves the run summary (total, passed, failed, duration, new bugs); if any Critical bug was detected in the run, sends one email with all Critical bugs and their screenshots |

### Step 4: The ML model predicts the severity (Objective 2)

The reporter passes the error message to `predictSeverity()`:

```
Error: Placing an order should complete the payment and show the order confirmation
expect(locator).toHaveText(expected) failed
Expected: "Order confirmed! Thank you for shopping."
Received: "500 Internal Server Error: Payment gateway crashed while processing the transaction"
```

1. **Pre-processing** (`textPreprocessor.ts`):
   * remove the `Locator:` and `Timeout:` lines
   * lower-case the text
   * `500` → `http500`, other numbers → `num`
   * split into words and remove stop-words
   * add word pairs (bigrams)

   The result is tokens like `placing, order, payment, confirmation, http500, internal, server, gateway, crashed, payment_gateway, gateway_crashed, internal_server, ...`
2. **Naive Bayes** (`naiveBayes.ts`) computes a score for each class:

   `log P(class) + Σ log P(token | class)`

   Words like *http500, server, crashed, gateway, payment* appeared mostly in **Critical** training examples, so Critical wins.
3. **Softmax** turns the scores into probabilities, giving **Critical with 100% confidence**.

### Step 5: The bug is stored (Objective 3)

A row is inserted into `bugs` with status **Open**, and a row in `bug_history` records "Created as Open".

If the same failure happens in the next run, the reporter finds the existing bug by its **fingerprint**. The fingerprint is the test name plus the error text with numbers removed. The reporter only increases `occurrences`, so it does not create duplicates.

### Step 6: Critical, so an email alert is sent (Objective 7)

In `onEnd()`, the reporter calls `sendCriticalAlert()` (`src/alerts/criticalAlertEmail.ts`). If **any** Critical bug was detected in this run, new or already known, **one email** goes to everyone in `ALERT_TO`. For each Critical bug it contains the module, test, time, ML confidence, the full error message and a **clear screenshot** of the page at the moment of failure. A run without Critical bugs sends no email.

* If SMTP is configured in `.env`, Nodemailer sends the email. The screenshots are embedded so they appear inside the email.
* If not, the same email is written to `reports/alerts/critical-alert-run-<run>.html`, so it can be opened in a browser during the demo.
* `npm run pipeline` runs the suite several times, so it sends one email at the end covering all runs, with the HTML report attached.

### Step 7: The bug appears on the dashboard (Objectives 4 and 5)

`npm start` → http://localhost:3000 → **Bugs** → bug "placing an order shows the confirmation".

The bug page shows:
* the error
* the screenshot of the page with the red error text
* "Predicted Critical with 100% confidence"
* the status history

The tester clicks **→ In Progress** and later **→ Resolved**. Each change is saved in `bug_history`. The overview charts now count it under the *Checkout* module and the *Critical* severity.

---

## Part C: Flaky test detection (Objective 6)

Two tests in the demo are **flaky on purpose**. The cart and profile APIs wait a random 0.3–3 seconds, and the test waits only 2 seconds. Sometimes they pass, sometimes they fail, and the code never changes.

`src/flaky/flakyDetector.ts` reads `test_results` for the last 10 runs and builds a pass/fail history per test, e.g. `FFPFP`:

| Verdict | Rule |
|---|---|
| Flaky | at least one pass **and** at least one fail (and at least 3 runs) |
| Consistently failing | failed in every run, so it is a real bug |
| Stable | passed in every run |

* **Failure rate** = fails / runs (`FFPFP` → 3/5 = 60%)
* **Flip rate** = result changes / (runs − 1) (`FFPFP` → F→F no, F→P yes, P→F yes, F→P yes → 3/4 = 75%)

**Why Playwright's retries are turned off:** with retries, Playwright would hide flakiness by re-running the test until it passes. We want to *measure* flakiness across independent runs.

**Why it matters:** a flaky test's bug is marked with a **Flaky** tag in the dashboard. The team then knows it may be a timing or test problem rather than a product defect.

---

## Part C2: Broken link checker (additional feature)

A website can look fine while some of its links lead to "404 Not Found" or crash with an error. Clicking every link by hand on every page is not practical, so `tests/links.spec.ts` does it automatically. It uses `src/links/linkCrawler.ts`.

1. **Crawl.** It starts at the home page, opens it in a real browser, and collects every `<a href>` link. Every link to another page of the **same website** is added to a queue and opened the same way, until no new pages are found (or `LINK_CHECK_MAX_PAGES` is reached). A real browser is used because many sites add links with JavaScript; ShopEase builds its menu and footer that way.
2. **Check.** Every unique link is requested and its HTTP status recorded: HEAD first, then GET, because some servers refuse HEAD. Links to other websites are checked but not crawled.
3. **Report.** A link is broken if it answers 4xx/5xx or does not answer at all. For each broken link the test makes a separate *soft assertion*, which records the failure and continues. Because of this, the reporter logs every broken link as its **own bug**, with the URL and the pages where it appears:

```
Error: Broken link: http://localhost:4000/terms.html
Found on: http://localhost:4000/ (link text "Terms and Conditions"), ... and 6 more page(s)
Expected: "HTTP 200 OK"
Received: "HTTP 404 Not Found"
```

The ML model then gives each one a severity. The two "404" links come out **Major** and the "500" Help Center link comes out **Critical**, so it also triggers an email alert.

**ShopEase's seeded broken links:** footer *Help Center* (HTTP 500), footer *Terms and Conditions* (404), and the *Spec sheet (PDF)* link on Laptop Pro 14 (404). The checker crawls 11 pages, checks 11 unique links and finds exactly these 3.

**Any real website** can be checked with one setting:

```bash
LINK_CHECK_START_URL=https://your-website.com npm run test:links
```

---

## Part C3: Test Runner, the UI for manual testers (additional feature)

**Why.** A manual tester shouldn't need VS Code, a terminal or Playwright commands to run the automation and read the result.

**How it is used**
1. Double-click `Start Test Runner.command` (Mac) or `Start Test Runner.bat` (Windows). The browser opens the Test Runner. Nothing runs until the tester presses **Run tests**.
2. Choose a suite in the dropdown (**Smoke** 5 tests, **Sanity** 11, **Regression** 17, **Broken links** 1) and enter one or more email IDs. The email is sent *only if a Critical bug is found* (the default) or *after every run*. Press **Run tests**.
3. **Headed mode** (on by default): a browser window opens and the tests run one at a time, so you can watch them. A live panel shows a progress bar, passed/failed counters and each test as it finishes.
4. At the end the **report** opens in the same UI, and the people entered receive it by email.
5. Every run is kept in **Run History**, named with its date first, e.g. `2026-10-22 14:29 · Smoke · Run #10`.
6. **Re-run failed tests (N)** runs only the tests that failed in that run, and each failed test in a report has its own **Re-run** button for just that test. Each result stores the test's file and line, so the re-run uses Playwright's exact filter `tests/checkout.spec.ts:16`.
7. Emails are sent from one sending account set once in `.env` (Gmail address + App Password). Testers only type the recipients. Without that account no email can be sent, and the Test Runner says so in red.

**How it works**

```
 Browser (Test Runner page)                Dashboard server (Express)                     Playwright
 ─────────────────────────                 ──────────────────────────                     ──────────
 Run (suite, emails) ── POST /api/runs ──► creates the run row (suite, emails)
                                           starts: npx playwright test --grep @smoke ───► tests run; BugReporter
                                                    RUN_ID=12 (env)                        writes results + bugs
 every 1 s ◄── GET /api/runs/12/live ───── reads results from SQLite + live log            into SQLite (run #12)
                                           Playwright ends ─► saves reports/runs/<date>_..html
                                                           ─► emails the report to the entered IDs
 "Open full report" ─► /runs/12            renders the report from SQLite
```

* **Suites are Playwright tags.** `test('user can log in…', { tag: ['@smoke', '@sanity'] }, …)` puts a test in Smoke and Sanity. The runner passes `--grep @smoke`, and Regression runs everything.
* **The run is created before Playwright starts**, so the page can follow it immediately. Its ID is passed to the reporter through the `RUN_ID` environment variable.
* **Live progress needs no extra machinery.** The reporter already saves each test result in SQLite as soon as the test ends; the page simply asks for them every second.
* **The report** is one EJS template used in two ways: as a page in the dashboard, and as a self-contained HTML file with styles and screenshots embedded, for download, email attachment and the `reports/runs/` archive.

---

## Part D: Live demo script (about 10 minutes)

Before the demo, run these once so the browser is installed and the data starts clean:

```bash
npm install
npx playwright install chromium
npm run db:reset
```

| Step | Do this | Show / say |
|---|---|---|
| 0 | Double-click **Start Test Runner**, choose **Smoke**, enter your guide's email, press **Run tests** | "A manual tester never opens VS Code." The headed browser shows the tests running and the live progress fills in. Then **Open full report**: pass rate, results by module, the Critical callout. Click a failed test to see its screenshot, press its **Re-run** button to run just that test again, and show **Download report** and **Run History**. |
| 1 | `npm run demo-app`, open http://localhost:4000 (login `student` / `Password@123`) | "This is ShopEase, the application under test. It has 5 modules (Login, Search, Cart, Checkout, Profile) and footer links on every page." Log in with `student / Password@123`, try checkout to show the 500 error. Stop it with Ctrl+C. |
| 2 | `npm run train` | "The model is trained on 179 labelled error messages." Point at the **86.1% hold-out accuracy**, the **87.2% cross-validation accuracy**, the per-class precision/recall/F1 and the **confusion matrix**. |
| 3 | `npx tsx src/ml/classifier.ts "Typo in the button label"` then `npx tsx src/ml/classifier.ts "Server crashed with 500 error during payment"` | The model predicts Minor for the first message and Critical for the second, each with a confidence value. |
| 4 | `npm run pipeline` | The demo app starts automatically and the 17 tests run 5 times. Point at the terminal lines like `New bug #N logged - Critical (100% confidence)` and, in later runs, `Known bug #N seen again` (no duplicates). At the end the pipeline prints the **flaky tests** found. |
| 5 | Open `reports/alerts/critical-alert-run-<run>.html` | "Whenever a run detects a Critical bug, this email goes to everyone in `.env`: every Critical bug with its details and a screenshot of the failure. With SMTP settings in `.env` it goes to a real inbox." |
| 6 | Open http://localhost:3000/analytics | **Analytics:** four key numbers, bugs per module, bugs by severity, and the 14-day trend. Click a bar to open those bugs. |
| 7 | **Bugs** page | Filter Severity = Critical; search "payment"; search a bug ID such as "#4". Click **→ In Progress** on one bug. |
| 8 | Click a bug | Show the error, the **screenshot**, the ML confidence, the stability history, and the status history. Change the status to Resolved and show the new history row. |
| 9 | **Flaky Tests** page | The 2 flaky tests with failure rate, flip rate and P/F history, compared with tests that are consistently failing or stable. |
| 10 | **Run History** page | Every run named with its date first, grouped by day. "Everything is traceable in one SQLite database." |
| 10b | `npm run test:headed -- --grep @Links` | Watch the browser visit every page of ShopEase, then show the three `Broken link` bugs on the **Bugs** page (filter Module = Links). Optionally run `LINK_CHECK_START_URL=https://example.com npm run test:links` to show it works on any website. |
| 11 | Open `reports/bug-report.html` | The generated results report: one file with run summaries, the bug register, charts, flaky analysis, ML evaluation and every failure with its screenshot. It can be printed or saved as PDF from the browser. Playwright's own report is at `reports/playwright-html/index.html` (`npx playwright show-report reports/playwright-html`). |
| (optional) | `npm run seed:history`, refresh the overview | Fills the previous 13 days with **simulated** bugs so the 14-day trend chart has a full shape. Say clearly that this is simulated data; these bugs carry a "Simulated" tag. |

---

## Part E: Design decisions (and why)

| Decision | Reason |
|---|---|
| **TypeScript everywhere** | One language for the tests, ML, database, alerts and dashboard. Type checking catches mistakes early (`npm run typecheck`). |
| **Custom Playwright reporter** instead of parsing log files afterwards | The reporter gets structured data directly from Playwright (status, errors, attachments, timing, tags) while tests run. No fragile text parsing is needed. |
| **Module from test tags** (`@Login`) | This is Playwright's own tagging feature. It is explicit, and it also allows running one module: `npx playwright test --grep @Cart`. |
| **Naive Bayes** | Works well on small text datasets and trains in milliseconds. It is easy to explain mathematically and gives probabilities (confidence). It is written from scratch, so there is no "black box". |
| **Bigrams** | Phrases carry meaning that single words do not: "server error" vs "error message", "payment gateway". |
| **Boilerplate removal** | Lines like `Locator: getByRole('alert')` and `Timeout: 3000ms` appear in almost every Playwright failure and say nothing about the defect. Removing them stopped them from pushing predictions toward the wrong class. |
| **SQLite** | Serverless, a single file, zero setup, and SQL queries for analytics. It is enough for a team-level bug store. |
| **Fingerprint de-duplication** | Running the suite 5 times must not create 5 copies of the same bug. A recurring failure increases the occurrence count instead. |
| **Bug history table** | Every status change is recorded with a timestamp, which gives full traceability. |
| **Email preview fallback** | The alert feature can be demonstrated without real SMTP credentials. |
| **Retries = 0** | Flakiness is measured across independent runs, not hidden by retries. |

---

## Part F: Expected viva questions

**Q1. Why did you choose Naive Bayes and not deep learning?**
The dataset is small (179 samples). Deep models need thousands of samples and would overfit. Naive Bayes is a standard, strong baseline for text classification: fast, interpretable, and gives probabilities. With 87.2% cross-validated accuracy it is sufficient for this purpose.

**Q2. What is the "naive" assumption?**
That words are conditionally independent given the class. This is not strictly true in language, but the classifier still ranks classes well in practice.

**Q3. What is Laplace smoothing?**
Adding 1 to every word count. Without it, a word never seen in the Minor class would give P = 0, and the whole Minor probability would become 0 because of one word.

**Q4. Why use logarithms?**
Multiplying many small probabilities underflows to 0 in floating point. Summing logs gives the same ranking safely.

**Q5. How did you evaluate the model?**
Two ways. First, a stratified 80/20 hold-out split, reporting accuracy, precision, recall, F1 and a confusion matrix. Second, stratified 5-fold cross-validation for a more stable estimate. The final model is trained on all data. Results: 86.1% hold-out and 87.2% CV.

**Q6. Which mistakes does the model make?**
From the confusion matrix, the most common error is predicting Major for a Minor or Critical bug. Major sits "in the middle", and some messages contain words from both sides (e.g. "button" appears in functional and cosmetic bugs). More training data would reduce this.

**Q7. How is the module of a bug decided?**
From the Playwright tag on the `describe` block (`@Login`, `@Cart`, …), which the reporter reads from `test.tags`.

**Q8. How do you avoid duplicate bugs?**
Each failure gets a fingerprint: SHA-1 of the test name plus the error text with digits removed. If an unresolved bug with that fingerprint exists, its occurrence count is increased instead of creating a new bug. If a Resolved bug fails again, a new bug is opened because it is a regression.

**Q9. What is a flaky test and how do you detect it?**
A test that passes and fails on the same code. We store every test result for every run. If a test has both passes and failures within the last 10 runs (minimum 3), it is flaky. We also report failure rate and flip rate.

**Q10. Why not use Playwright's built-in "flaky" status?**
Playwright only marks a test as flaky when it fails and then passes on a retry *within one run*. Our method works across runs, needs no retries, and keeps the full history for analysis.

**Q11. How would this work on a real project?**
* Replace `demo-app` with the real application's URL (`baseURL` in `playwright.config.ts`).
* Write tests with module tags.
* Run `npx playwright test` in CI (e.g. GitHub Actions) on every commit.
* Keep the database on a shared machine or move to PostgreSQL.
* Retrain the model with the team's own labelled historical bugs.

**Q11b. Who gets emails, and when?**
Everyone listed in `ALERT_TO` in `.env`. Whenever a test run detects at least one Critical bug, new or already known, they get **one email** with every Critical bug's details and screenshot. Runs without Critical bugs send nothing, so the email always means there is something urgent. The pipeline sends one email for all its runs.

**Q12. What happens if the model is wrong?**
The prediction and its confidence are visible on the bug page. Low-confidence predictions can be reviewed by a person. Corrected labels can be added to `training-data.csv` and the model retrained with `npm run train`.

**Q12b. How does the broken link checker work, and why is each broken link a separate bug?**
It crawls every page of the same website in a real browser, collects every `<a href>`, and requests each unique link (HEAD, then GET). Any 4xx/5xx or unreachable link is broken. Each broken link has a different cause and a different fix, so each one is a separate soft assertion and therefore a separate bug with its own status, severity and history.

**Q13. What are the limitations?**
* The dataset is small and partly hand-written.
* Severity is predicted only from the error text, not from business context.
* SQLite is single-machine.
* Email alerts need SMTP credentials.
* Flaky detection needs several runs before it can judge.

**Q13b. How does a manual tester run the automation without any tools?**
Through the Test Runner web page. It has a suite dropdown, an email box and a Run button. The server starts Playwright with the chosen suite's tag (`--grep @smoke`), the page shows live progress by reading the results the reporter writes to SQLite, and the finished report is shown in the same UI and emailed to the addresses entered. A double-click launcher starts everything, so nobody needs VS Code or a terminal.

**Q14. Future scope?**
* Larger real-world dataset and comparison with other models (Logistic Regression, SVM, transformer embeddings).
* Automatic ticket creation in Jira/GitHub Issues.
* Slack/Teams alerts.
* Root-cause clustering of similar failures.
* CI/CD integration with trend reports per release.
* Role-based login on the dashboard.

---

## Part G: Glossary

| Term | Meaning |
|---|---|
| Playwright | Microsoft's open-source framework that controls real browsers (Chromium, Firefox, WebKit) to test web applications |
| Reporter | A Playwright plug-in that receives events (test started, test finished, run finished) |
| Assertion | A check in a test, e.g. `expect(total).toHaveText('$59.98')`; if it fails, the test fails |
| Severity | How serious a bug is: **Critical** (crash, data loss, security, payments), **Major** (feature broken or wrong result), **Minor** (cosmetic) |
| Token / bigram | A single word / a pair of neighbouring words used as ML features |
| Precision | Of the bugs predicted as class X, how many really were X |
| Recall | Of the real class-X bugs, how many were found |
| F1-score | Harmonic mean of precision and recall |
| Confusion matrix | Table of actual vs predicted classes |
| Cross-validation | Training/testing k times on different splits and averaging the results |
| Flaky test | A test with non-deterministic results on unchanged code |
| Fingerprint | A hash that identifies "the same" failure across runs |
