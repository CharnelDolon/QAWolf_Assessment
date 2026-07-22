# QA Wolf Take Home — Hacker News "Newest" Sort Validation

## The Assignment

Write a Playwright script that goes to [Hacker News/newest](https://news.ycombinator.com/newest) and validates that exactly the first 100 articles are sorted from newest to oldest.

## Implementation

`index.js` launches Chromium with Playwright and:

1. **Collects articles** — scrapes each article's exact timestamp (from the `.age` span's `title` attribute, not the fuzzy "3 minutes ago" text) rather than relying on display order, and pages through "More" until 100 unique articles are gathered. Articles are deduped by HN item id, since the live list can shift entries between page loads and cause repeats across pages.
2. **Validates order** — checks that every consecutive pair of articles has a non-increasing timestamp, and collects *all* violations rather than stopping at the first one.
3. **Reports results** — prints a PASS/FAIL summary. On failure it prints a table of just the offending articles; on success it prints the full ranked table.
4. **Handles flakiness** — retries transient navigation failures, paces pagination with a short delay, and detects HN's "Sorry." rate-limit page so a throttle isn't misreported as a markup change.

Run it with:

```
npm i
node index.js
```

`simulate-failure.js` exercises the FAIL reporting path with synthetic data (two swapped timestamps) since HN is almost never actually out of order — run it with `node simulate-failure.js` to see the failure output without waiting on a real violation.
