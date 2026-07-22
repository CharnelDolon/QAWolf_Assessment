// Exercises the FAIL path of index.js's report() without needing HN to
// actually be out of order (it almost never is). Builds a synthetic article
// list shaped exactly like collectArticles' real output, with two entries'
// timestamps swapped to simulate a live-list shift, then runs the same
// validateSortOrder + report code the real script uses — so this proves the
// failure output is correct, not just a reimplementation of it.
//
// Run with: node simulate-failure.js

const { validateSortOrder, report } = require("./index");

const baseUnix = Math.floor(Date.now() / 1000);

const rawArticles = [
  { id: 40000001, title: "Show HN: A tool for visualizing git history", timestampUnix: baseUnix },
  { id: 40000002, title: "The economics of open source maintenance", timestampUnix: baseUnix - 60 },
  { id: 40000003, title: "Ask HN: How do you review large PRs?", timestampUnix: baseUnix - 90 },
  { id: 40000004, title: "Rust's borrow checker, five years later", timestampUnix: baseUnix - 120 },
  { id: 40000005, title: "A brief history of the HTTP status code 418", timestampUnix: baseUnix - 180 },
  { id: 40000006, title: "Why databases still get transactions wrong", timestampUnix: baseUnix - 240 },
];

// Swap ranks 3 and 4's timestamps (titles/ids stay put) so rank 3 ends up
// older than rank 4 — exactly the kind of violation a live-list shift causes.
[rawArticles[2].timestampUnix, rawArticles[3].timestampUnix] = [
  rawArticles[3].timestampUnix,
  rawArticles[2].timestampUnix,
];

const articles = rawArticles.map((article, index) => ({
  ...article,
  timestampIso: new Date(article.timestampUnix * 1000).toISOString(),
  ageText: "",
  rank: index + 1,
}));

const validation = validateSortOrder(articles);
report({ articles, pagesVisited: 1, overlapsDetected: 0 }, validation);

if (validation.passed) {
  console.error("\nSimulation did not produce a violation — check the synthetic data above.");
  process.exitCode = 1;
}
