# QA Wolf Take-Home — Design & Plan

## Assignment (Question 1)

Edit `index.js` to go to `https://news.ycombinator.com/newest` and validate that **exactly
the first 100 articles** are sorted newest → oldest. Must use Playwright. Run with
`node index.js`.

HN's `/newest` shows 30 items per page, so reaching 100 requires paginating (the "More"
link) and validating order across the full combined set, not just within each page.

## Context: what QA Wolf actually values (research summary)

QA Wolf pairs AI + human QA engineers to generate and maintain Playwright/Appium tests
from recorded user flows, run them in parallel across containers, and guarantee
**zero flaky tests** via 24/7 human-monitored retries. Tests live in the customer's own
repo on vanilla open-source Playwright — no vendor lock-in.

Their own engineering blog repeatedly emphasizes:
- **Arrange-Act-Assert** test structure
- Writing tests for **full parallelization** (isolated, deterministic)
- **Flaky test handling** — automatic retries + failure pattern tracking
- **"How to Write a Great Bug Report"** — clear, actionable failure output
- Metrics that gauge the *real* impact of test coverage

Takeaway: the differentiator that matters most here isn't visual polish, it's
demonstrating the same judgment QA Wolf sells — anticipating flakiness, writing
precise assertions, and reporting failures in a way a human can immediately act on.

## Key insight driving the design

`/newest` is a **live, constantly-updating list**. While paginating across 4 page loads
to collect 100 items, a new HN submission can shift every item down one slot between
page loads — causing an item to appear on two consecutive pages (or, more subtly, get
skipped). A naive scraper can produce a **false failure** that isn't actually a bug in
the validation logic. Handling this correctly (rather than ignoring it) is the core
"QA thinking" signal of this assignment.

## Chosen approach (Approach C)

UI-driven pagination (click "More", like a real user) + an ID-based dedupe safety net,
validated against exact timestamps rather than fuzzy display text ("3 minutes ago").

### Data model

Each collected article:
```js
{ id, rank, title, timestampUnix, timestampIso, ageText }
```
- `id`: HN's numeric item ID, read from each row's `id` attribute. Globally monotonic
  (assigned at submission time) — used for de-duplication across page loads.
- `timestampUnix` / `timestampIso`: parsed from the `.age` span's `title` attribute,
  which holds the *exact* time, not the relative text shown on the page.
- `ageText`: the raw "x minutes ago" text, kept only for human-readable reporting.

### Components

- `extractArticlesFromPage(page)` — evaluates the DOM of whatever page is currently
  loaded, returns the ~30 article objects on it.
- `goToNextPage(page)` — clicks "More", waits for navigation.
- `collectArticles(page, targetCount = 100)` — orchestrates the loop: extract → merge
  into a master list deduped by `id` → if still short of `targetCount`, click "More"
  and repeat. Capped at a safety limit (e.g. 10 page loads) so a broken selector fails
  loudly instead of looping forever. Logs a note whenever an overlap/duplicate is
  detected (i.e. the live list shifted under us).
- `validateSortOrder(articles)` — walks consecutive pairs, checks
  `timestampUnix[i] >= timestampUnix[i+1]` (`>=` tolerates same-second ties). Returns
  `{ passed, violations: [{ index, prev, curr }] }`.
- `report(articles, validation, meta)` — prints a clear pass/fail summary; on failure,
  prints each violation with both titles/ids/timestamps so it's immediately actionable.
- `main()` — launches browser → runs the pipeline → sets `process.exitCode` (0 pass /
  1 fail) → closes the browser in a `finally` so it never orphans on error.

### Data flow

`goto /newest` → extract first 30 → **while** unique count < 100: click "More" →
extract → merge/dedupe by id → repeat (capped) → slice to exactly the first 100 in
encountered order → validate → report → exit.

### Error handling

- Entire pipeline wrapped in try/catch/finally: browser always closes, real errors are
  printed instead of a silent hang or orphaned Chromium process.
- Navigation/extraction steps get a small retry wrapper (1–2 retries on transient
  failure) — directly mirroring QA Wolf's own emphasis on taming flakiness rather than
  ignoring it.
- If expected selectors aren't found (HN markup changed, "More" link missing), fail
  with a descriptive error, not a generic Playwright timeout.

### Reporting format (console)

```
Collected 100 unique articles (4 pages visited, 1 overlap detected and backfilled)
✅ PASS — all 100 articles sorted newest → oldest
```
or, on failure, each violation printed with both titles, ids, and exact timestamps.

## Scope decision: no UI

The README explicitly invites going further — e.g. "building a simple user interface."
Deliberately skipped: this take-home is reviewed by QA engineers, and for an IC QA
Engineer role, a UI reads as visual polish disconnected from QA judgment, while the
actual signal they can evaluate is whether the validation logic itself is correct and
handles the parts of the problem the instructions don't spell out (the live-list race
condition above). Effort went there instead — a UI over a script that got the hard
part wrong would be optimizing for the wrong thing.

## Implementation plan

1. Write `extractArticlesFromPage` — DOM evaluation pulling id/title/timestamp per row.
2. Write `goToNextPage` — click "More", wait for navigation.
3. Write `collectArticles` — pagination loop with dedupe-by-id + overlap logging + safety cap.
4. Write `validateSortOrder` — pairwise timestamp comparison, collects violations.
5. Write `report` — console output for pass/fail + violation details.
6. Wire up `main()` with try/catch/finally, retry wrapper, exit codes.
7. Run against the live site (`node index.js`), confirm PASS on a normal run.
8. Sanity-check failure reporting path (e.g. temporarily corrupt one timestamp) to
   confirm violation output is readable, then revert.
9. Clean up comments/structure for readability before recording the Loom walkthrough.
