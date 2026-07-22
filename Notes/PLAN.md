# Hacker News Sort Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit `index.js` so it navigates to `news.ycombinator.com/newest`, collects
exactly the first 100 articles (paginating past HN's 30-per-page limit), and validates
they are sorted newest → oldest — while correctly handling the fact that `/newest` is a
live list that can shift under us mid-scrape.

**Architecture:** Single-file script (`index.js`), same shape as the starter file.
Small, single-purpose functions: extract → paginate/collect (dedupe by HN item id) →
validate (compare exact timestamps) → report (console) → orchestrate with retry +
proper exit codes. No new dependencies — Playwright is already installed; unit tests
for the one pure function use Node's built-in `assert`, no test framework added.

**Tech Stack:** Node.js, Playwright (`chromium`), Node built-in `assert`.

## Global Constraints

- Must use Playwright for the browser automation (per assignment).
- Must validate **exactly** the first 100 articles from `/newest`.
- Must be runnable via `node index.js` (not the `@playwright/test` runner).
- No new npm dependencies — use what's already in `package.json`.
- Exit code must be 0 on pass, non-zero on fail/error (so it behaves like a real check).

---

### Task 1: Extract article data from a loaded page

**Files:**
- Modify: `index.js`

**Interfaces:**
- Produces: `async function extractArticlesFromPage(page)` → `Promise<Array<{ id: number, title: string, timestampIso: string, timestampUnix: number, ageText: string }>>`

- [ ] **Step 1: Add `extractArticlesFromPage` to `index.js`**

```js
async function extractArticlesFromPage(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.athing"));
    const ageSpans = Array.from(document.querySelectorAll(".age"));

    return rows.map((row, index) => {
      const id = Number(row.id);
      const titleLink = row.querySelector(".titleline > a");
      const title = titleLink ? titleLink.textContent.trim() : "";

      const ageSpan = ageSpans[index];
      const titleAttr = ageSpan ? ageSpan.getAttribute("title") || "" : "";
      const [timestampIso, unixStr] = titleAttr.split(" ");
      const ageText = ageSpan ? ageSpan.textContent.trim() : "";

      return {
        id,
        title,
        timestampIso: timestampIso || "",
        timestampUnix: Number(unixStr) || 0,
        ageText,
      };
    });
  });
}
```

- [ ] **Step 2: Verify manually against the live page**

Create a scratch file `verify-step1.js` in the project root:

```js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" });

  const { extractArticlesFromPage } = require("./index.js");
  const articles = await extractArticlesFromPage(page);

  console.log(`Extracted ${articles.length} articles`);
  console.log(articles.slice(0, 3));

  await browser.close();
})();
```

For this to work, temporarily add to the bottom of `index.js`:
```js
module.exports = { extractArticlesFromPage };
```

Run: `node verify-step1.js`

Expected: logs `Extracted 30 articles`, and the first 3 entries each have a real
numeric `id`, a non-empty `title`, a `timestampIso` like `2026-07-22T10:15:00`, and a
non-zero `timestampUnix`.

Delete `verify-step1.js` once confirmed (keep the `module.exports` line for now — later
steps extend it).

---

### Task 2: Paginate to the next page

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `async function goToNextPage(page)` → `Promise<void>` (resolves once the next page has loaded)

- [ ] **Step 1: Add `goToNextPage` to `index.js`**

```js
async function goToNextPage(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("a.morelink").click(),
  ]);
}
```

- [ ] **Step 2: Verify manually**

Update `module.exports` at the bottom of `index.js` to:
```js
module.exports = { extractArticlesFromPage, goToNextPage };
```

Create `verify-step2.js`:

```js
const { chromium } = require("playwright");
const { extractArticlesFromPage, goToNextPage } = require("./index.js");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" });

  const page1 = await extractArticlesFromPage(page);
  await goToNextPage(page);
  const page2 = await extractArticlesFromPage(page);

  const page1Ids = new Set(page1.map((a) => a.id));
  const overlap = page2.filter((a) => page1Ids.has(a.id)).length;

  console.log(`Page 1: ${page1.length} articles, Page 2: ${page2.length} articles`);
  console.log(`Overlap between pages: ${overlap} (expected 0, occasionally 1-2 if the list shifted)`);

  await browser.close();
})();
```

Run: `node verify-step2.js`

Expected: `Page 1: 30 articles, Page 2: 30 articles`, overlap is `0` in the common case
(a small nonzero overlap is fine too — it's the exact scenario Task 3 is built to
handle, not a bug).

Delete `verify-step2.js` once confirmed.

---

### Task 3: Collect exactly 100 unique articles, deduped across pages

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `extractArticlesFromPage(page)`, `goToNextPage(page)` from Tasks 1-2
- Produces: `async function collectArticles(page, targetCount = 100)` →
  `Promise<{ articles: Array<Article & { rank: number }>, pagesVisited: number, overlapsDetected: number }>`

- [ ] **Step 1: Add `collectArticles` to `index.js`**

```js
async function collectArticles(page, targetCount = 100) {
  const seen = new Map();
  let pagesVisited = 0;
  let overlapsDetected = 0;
  const MAX_PAGES = 10;

  while (seen.size < targetCount && pagesVisited < MAX_PAGES) {
    const pageArticles = await extractArticlesFromPage(page);
    if (pageArticles.length === 0) {
      throw new Error(`No articles found on page ${pagesVisited + 1} — HN markup may have changed.`);
    }

    for (const article of pageArticles) {
      if (seen.has(article.id)) {
        overlapsDetected++;
      } else {
        seen.set(article.id, article);
      }
    }
    pagesVisited++;

    if (seen.size < targetCount) {
      const moreLinkCount = await page.locator("a.morelink").count();
      if (moreLinkCount === 0) {
        throw new Error(`Ran out of pages after collecting only ${seen.size} unique articles.`);
      }
      await goToNextPage(page);
    }
  }

  if (seen.size < targetCount) {
    throw new Error(`Could not collect ${targetCount} unique articles after ${MAX_PAGES} pages.`);
  }

  const articles = Array.from(seen.values())
    .slice(0, targetCount)
    .map((article, index) => ({ ...article, rank: index + 1 }));

  return { articles, pagesVisited, overlapsDetected };
}
```

- [ ] **Step 2: Verify manually**

Update exports:
```js
module.exports = { extractArticlesFromPage, goToNextPage, collectArticles };
```

Create `verify-step3.js`:

```js
const { chromium } = require("playwright");
const { collectArticles } = require("./index.js");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" });

  const { articles, pagesVisited, overlapsDetected } = await collectArticles(page, 100);

  console.log(`Collected ${articles.length} articles across ${pagesVisited} pages, ${overlapsDetected} overlaps`);
  console.log("Ranks are sequential:", articles.every((a, i) => a.rank === i + 1));
  console.log("All ids unique:", new Set(articles.map((a) => a.id)).size === articles.length);

  await browser.close();
})();
```

Run: `node verify-step3.js`

Expected: `Collected 100 articles across 4 pages, N overlaps` (N usually 0-2),
`Ranks are sequential: true`, `All ids unique: true`.

Delete `verify-step3.js` once confirmed.

---

### Task 4: Validate sort order (pure logic, real unit tests)

**Files:**
- Modify: `index.js`
- Test: `test-validate-sort-order.js` (temporary, deleted at end of this task)

**Interfaces:**
- Consumes: nothing (pure function, takes plain article objects)
- Produces: `function validateSortOrder(articles)` →
  `{ passed: boolean, violations: Array<{ index: number, curr: Article, next: Article }> }`

- [ ] **Step 1: Write the failing test**

Create `test-validate-sort-order.js`:

```js
const assert = require("assert");
const { validateSortOrder } = require("./index.js");

function makeArticle(id, timestampUnix) {
  return { id, title: `story-${id}`, timestampIso: "", timestampUnix, ageText: "" };
}

// Sorted newest -> oldest: should pass
const sorted = [makeArticle(3, 300), makeArticle(2, 200), makeArticle(1, 100)];
const sortedResult = validateSortOrder(sorted);
assert.strictEqual(sortedResult.passed, true, "expected sorted articles to pass");
assert.strictEqual(sortedResult.violations.length, 0);

// Equal timestamps (same-second ties): should pass
const tied = [makeArticle(2, 200), makeArticle(1, 200)];
assert.strictEqual(validateSortOrder(tied).passed, true, "expected tied timestamps to pass");

// Out of order: should fail with one violation
const outOfOrder = [makeArticle(3, 300), makeArticle(2, 100), makeArticle(1, 200)];
const badResult = validateSortOrder(outOfOrder);
assert.strictEqual(badResult.passed, false, "expected out-of-order articles to fail");
assert.strictEqual(badResult.violations.length, 1);
assert.strictEqual(badResult.violations[0].index, 1);

console.log("All validateSortOrder tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-validate-sort-order.js`

Expected: `TypeError: validateSortOrder is not a function` (it doesn't exist yet).

- [ ] **Step 3: Implement `validateSortOrder` in `index.js`**

```js
function validateSortOrder(articles) {
  const violations = [];
  for (let i = 0; i < articles.length - 1; i++) {
    const curr = articles[i];
    const next = articles[i + 1];
    if (curr.timestampUnix < next.timestampUnix) {
      violations.push({ index: i, curr, next });
    }
  }
  return { passed: violations.length === 0, violations };
}
```

Update exports:
```js
module.exports = { extractArticlesFromPage, goToNextPage, collectArticles, validateSortOrder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-validate-sort-order.js`

Expected: `All validateSortOrder tests passed`

- [ ] **Step 5: Delete the temporary test file**

Delete `test-validate-sort-order.js` (its job — proving `validateSortOrder` is
correct — is done; it's not part of the assignment deliverable).

---

### Task 5: Console reporting

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: the `{ articles, pagesVisited, overlapsDetected }` shape from Task 3, the
  `{ passed, violations }` shape from Task 4
- Produces: `function report(collection, validation)` → `void` (prints to console)

- [ ] **Step 1: Add `report` to `index.js`**

```js
function report({ articles, pagesVisited, overlapsDetected }, validation) {
  console.log(
    `Collected ${articles.length} unique articles (${pagesVisited} pages visited, ${overlapsDetected} overlap(s) detected and backfilled)`
  );

  if (validation.passed) {
    console.log(`PASS - all ${articles.length} articles sorted newest -> oldest`);
    return;
  }

  console.log(`FAIL - found ${validation.violations.length} ordering violation(s):`);
  for (const { curr, next } of validation.violations) {
    console.log(
      `  Position ${curr.rank} -> ${next.rank}: "${curr.title}" (id ${curr.id}, ${curr.timestampIso}) ` +
        `is older than "${next.title}" (id ${next.id}, ${next.timestampIso})`
    );
  }
}
```

- [ ] **Step 2: Verify manually**

Since `report` just formats data it's already been checked with in Task 4, verify by
reading the code against these two cases: passing collection (should print one PASS
line) and a collection with one violation (should print FAIL plus one detail line
naming both articles' titles, ids, and timestamps). No separate script needed — Task 6
exercises this against real data.

---

### Task 6: Wire up `main()` with retry and proper exit codes

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `collectArticles`, `validateSortOrder`, `report` from Tasks 3-5
- Produces: the script's actual entry point behavior (`process.exitCode` 0 on pass, 1 on fail/error)

- [ ] **Step 1: Add a small retry helper to `index.js`**

```js
async function withRetry(fn, { retries = 2, delayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(`Attempt ${attempt + 1} failed (${error.message}), retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 2: Replace `sortHackerNewsArticles` with the full pipeline**

Replace the existing `sortHackerNewsArticles` function body in `index.js` with:

```js
async function sortHackerNewsArticles() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await withRetry(() =>
      page.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" })
    );

    const collection = await collectArticles(page, 100);
    const validation = validateSortOrder(collection.articles);
    report(collection, validation);

    process.exitCode = validation.passed ? 0 : 1;
  } catch (error) {
    console.error(`ERROR - validation could not complete: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
```

Remove the temporary `module.exports` line added in Tasks 1-4 (no longer needed — the
verification scripts that used it have all been deleted).

- [ ] **Step 3: Run the full script end-to-end**

Run: `node index.js`

Expected: browser opens, navigates through ~4 pages, closes, and console shows:
```
Collected 100 unique articles (4 pages visited, N overlap(s) detected and backfilled)
PASS - all 100 articles sorted newest -> oldest
```
Exit code 0 (check with `echo $?` on bash or `$LASTEXITCODE` in PowerShell immediately
after the run).

---

### Task 7: Confirm the failure-reporting path is readable

**Files:**
- Modify: `index.js` (temporarily, then revert)

**Interfaces:**
- Consumes: nothing new — this is a manual sanity check of Task 5's output formatting

- [ ] **Step 1: Temporarily force a violation**

In `collectArticles`'s return, temporarily swap two adjacent articles' timestamps right
before returning (add one line right before `return { articles, ... }`):
```js
if (articles.length >= 2) {
  const tmp = articles[0].timestampUnix;
  articles[0].timestampUnix = articles[1].timestampUnix;
  articles[1].timestampUnix = tmp;
}
```

- [ ] **Step 2: Run and inspect the FAIL output**

Run: `node index.js`

Expected: exit code 1, and console shows a `FAIL` line followed by one violation line
naming both articles' titles, ids, and ISO timestamps, formatted exactly like the
Task 5 spec. Confirm it's actually readable/debuggable, not just present.

- [ ] **Step 3: Revert the temporary swap**

Remove the 4-line swap block added in Step 1 so `index.js` matches Task 6's Step 2
output exactly. Re-run `node index.js` once more to confirm it's back to `PASS` with
exit code 0.

---

## Post-plan (not part of task execution)

- Re-read `index.js` top to bottom for readability/comment cleanup before recording
  the Loom walkthrough (per `CLAUDE.md`'s implementation plan step 9).
