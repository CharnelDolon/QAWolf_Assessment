const { chromium } = require("playwright");

// Reads the articles on the currently loaded page, pulling each one's exact
// timestamp (not the fuzzy "3 minutes ago" text) so sort order can be checked precisely.
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

// Clicks HN's "More" link and waits for the next page of articles to load.
// A short pause before clicking paces requests like a real user, which avoids
// tripping HN's anti-scraping throttle when paginating multiple times in a row.
async function goToNextPage(page) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("a.morelink").click(),
  ]);
}

// Paginates through /newest until `targetCount` unique articles are collected.
// Dedupes by HN item id, since the live list can shift articles between page loads
// and cause the same article to appear on two consecutive pages.
async function collectArticles(page, targetCount = 100) {
  const seen = new Map();
  let pagesVisited = 0;
  let overlapsDetected = 0;
  const MAX_PAGES = 10;

  while (seen.size < targetCount && pagesVisited < MAX_PAGES) {
    const pageArticles = await extractArticlesFromPage(page);
    if (pageArticles.length === 0) {
      // HN throttles clients that request pages too rapidly by serving a bare
      // "Sorry." page instead of a 429 — detect it so the error is accurate
      // instead of misreporting it as a markup change.
      const bodyText = (await page.locator("body").innerText()).trim();
      if (bodyText.toLowerCase().startsWith("sorry")) {
        throw new Error(
          `HN rate-limited this session after ${pagesVisited} page(s) (received a "Sorry." throttling response). Wait a minute or two before retrying.`
        );
      }
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

// Pure check: are consecutive articles' timestamps non-increasing (newest -> oldest)?
// Collects every violation, not just the first, so a failure report is complete.
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

const TITLE_DISPLAY_WIDTH = 80;

function truncateTitle(title) {
  return title.length > TITLE_DISPLAY_WIDTH ? `${title.slice(0, TITLE_DISPLAY_WIDTH - 1)}…` : title;
}

// Prints a pass/fail summary plus a table of every article's rank, exact
// timestamp, and title so the result is actionable without re-running anything.
function report({ articles, pagesVisited, overlapsDetected }, validation) {
  console.log(
    `Collected ${articles.length} unique articles (${pagesVisited} pages visited, ${overlapsDetected} overlap(s) detected and backfilled)`
  );

  if (validation.passed) {
    console.log(`PASS - all ${articles.length} articles sorted newest -> oldest\n`);
    console.table(
      articles.map((article) => ({
        Rank: article.rank,
        Timestamp: article.timestampIso,
        Title: truncateTitle(article.title),
      }))
    );
    return;
  }

  console.log(`FAIL - found ${validation.violations.length} ordering violation(s):\n`);

  // Flatten violation pairs into a deduped, rank-ordered list of just the
  // offending articles, tagged with which violation they belong to.
  const violatingArticles = [];
  const seenIds = new Set();
  validation.violations.forEach(({ curr, next }, violationIndex) => {
    for (const article of [curr, next]) {
      if (!seenIds.has(article.id)) {
        seenIds.add(article.id);
        violatingArticles.push({ ...article, violation: violationIndex + 1 });
      }
    }
  });
  violatingArticles.sort((a, b) => a.rank - b.rank);

  console.table(
    violatingArticles.map((article) => ({
      Violation: article.violation,
      Rank: article.rank,
      Timestamp: article.timestampIso,
      Title: truncateTitle(article.title),
    }))
  );
}

// Retries a transient failure (e.g. a flaky navigation) a couple of times before
// giving up, so a brief network hiccup doesn't produce a false failure.
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

// Entry point: collect the first 100 articles from HN's newest page, validate
// their sort order, report the result, and exit with a code reflecting pass/fail.
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

if (require.main === module) {
  sortHackerNewsArticles();
}

module.exports = {
  extractArticlesFromPage,
  goToNextPage,
  collectArticles,
  validateSortOrder,
  report,
};
