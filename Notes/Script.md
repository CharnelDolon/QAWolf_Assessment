Walking through index.js top to bottom — the reasoning behind each piece:

1. extractArticlesFromPage — the "what data do I actually need" decision. HN shows relative time ("3 minutes ago") on the page, but that's a rounded, imprecise display value — two articles a few seconds apart can show identical text. Every .age span has a title attribute holding HN's exact internal timestamp (ISO + unix). You validate against that source-of-truth value, not the fuzzy label a human reads. This is the difference between testing what the page displays and testing what's actually true.

2. goToNextPage — HN's "More" link is a real server-rendered page navigation, not a SPA update. So the correct Playwright pattern is click + waitForNavigation, not a blind page.goto('?p=2'). This is a small choice, but it's the one that actually exercises Playwright's interaction APIs — the literal skill in the job description — rather than just hitting a URL pattern you reverse-engineered.

3. collectArticles — this is the real problem. /newest is a live list. Between loading page 1 and page 2, someone can submit a new story, which shifts every existing article down one slot — so an article that was rank 30 on page 1 can reappear as rank 1 of page 2. A naive "concatenate 4 pages of 30 = 120, slice to 100" script would silently either double-count an article or drop one, and it would only happen sometimes — which is worse than always, because it looks like a flaky, unexplainable failure. The fix: dedupe by HN's item id (assigned once, at submission — a stable identity independent of position), and keep paginating until you actually have 100 unique articles, logging how many overlaps got absorbed. A live-changing list stops being a liability and becomes a handled, explained case.

4. validateSortOrder — deliberately a pure function with zero Playwright/DOM dependency. That's not an accident, it means the actual sorting logic is testable in milliseconds with plain data, no browser needed. It also collects every violation, not just the first, so a failure report is complete on the first run instead of "fix one, rerun, find the next."

5. report — PASS isn't the only case that matters. On failure it prints both articles' titles, IDs, and exact timestamps — enough for someone to understand and act on the failure without re-running anything. That's directly modeled on the "how to write a great bug report" instinct.

6. withRetry + main() — network hiccups shouldn't produce a false failure, so navigation gets 1-2 retries. Everything's wrapped in try/catch/finally so the browser always closes — no orphaned Chrome process, no silent hang — and process.exitCode is set properly (0/1) so this behaves like a real CI check, not just a script that prints things.

7. A bug I actually found while building this: the original entry point ran unconditionally at the bottom of the file. When I require()d index.js to unit-test validateSortOrder without duplicating code, that bottom block fired too — silently launching a real browser as a side effect of importing the file. I fixed it with Node's require.main === module guard. Worth saying out loud in the video: this is testing methodology surfacing a real defect, not just "I wrote code and it happened to work."

Did it solve a creative challenge?

Yes, and it's worth naming directly in the video: the README literally says "validate the first 100 articles are sorted" — that reads like a 10-line script. The part it doesn't say is that the data source is alive and changing while you're scraping it, which means the honest version of this task has a latent flakiness bug hiding in it. Most naive solutions would pass in testing and then fail unpredictably in the real world — which is exactly the class of problem QA Wolf's entire business exists to solve. Recognizing that and building the dedupe/backfill safety net around it is the actual "QA thinking" the assignment is testing for, even though it's never spelled out.

---

# Full Loom Script (~2 min total)

Timing budget: ~55-60 sec for the answer, ~85-95 sec for the demo. Say both
sections out loud once with a timer before recording.

## Part 1: Why QA Wolf (~55-60 sec, ~130 words)

▎ "Hi, I'm Charnel. Three things drew me to QA Wolf.
▎
▎ Firstly, I'm a new grad, and I specifically want to grow inside an early-stage
▎ startup — where ownership and moving fast aren't nice-to-haves, they're the
▎ actual job. That's exactly what QA Wolf's values talk about: delivering
▎ impact fast, and getting a little better every day.
▎
▎ I also want to be at the center of how AI is reshaping software teams. Dev
▎ teams are shipping faster than ever, which means QA has to move at that same
▎ speed to stay useful — and QA Wolf is literally built to solve that problem.
▎
▎ And lastly QA Wolf says they hire for fit as much as experience — I think I'm a
▎ strong fit. I'm someone who shows up enthusiastic to learn and contribute.
▎ One things that stood out to me is that your next interview paid work session — 
▎ that tells me you value people's time by default. Since this role is 
▎ customer-facing, I'd bring that same energy to QA Wolf's customers."

## Part 2: Technical demo (~85-95 sec, ~205 words)

▎ [Screen: index.js open]
▎
▎ "The assignment looks simple — check that the first 100 Hacker News
▎ articles are sorted newest to oldest. But there's a catch: this page only
▎ shows 30 at a time, and it's a live list — new posts get added while you're
▎ scraping, which can shift articles between pages.
▎
▎ [Scroll to extractArticlesFromPage]
▎ Instead of reading the '3 minutes ago' text on screen, I pull the exact
▎ timestamp Hacker News stores in the DOM, down to the second — that's what I
▎ actually validate against.
▎
▎ [Scroll to collectArticles]
▎ As I paginate to collect 100 articles, I deduplicate by each story's unique
▎ ID, because the live list can shift and the same article can appear on two
▎ pages. Left unhandled, the script would fail occasionally for no real
▎ reason — the exact flakiness QA Wolf's own engineering blog talks about
▎ taming, so I designed around it upfront.
▎
▎ [Scroll to validateSortOrder / report]
▎ The sort check itself is a small, pure function — no browser involved — so
▎ it's fast and easy to verify in isolation. On failure, I don't just print
▎ 'FAIL' — I print exactly which two articles are out of order, with IDs and
▎ timestamps, so it's immediately actionable.
▎
▎ [Switch to terminal]
▎ Let me run it live."
▎
▎ [Run node index.js — narrate over the wait instead of going silent, e.g.
▎ "it's paginating through the pages now, collecting unique articles..."]
▎
▎ "There — it collected 100 unique articles across 4 pages, and confirmed
▎ they're sorted newest to oldest."

**Cut this first if you're running long:** the FAIL-path add-on isn't in the
script above anymore — at ~2:20-2:30 combined it was already tight without it.
If a practice run comes in comfortably under 2 min, add it back:
swap two timestamps live, rerun, show the violation output, say "and that's
what a real failure looks like," then revert before your final take.