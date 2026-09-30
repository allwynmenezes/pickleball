# QA test plan — event formats (`feature/event-options`)

Requirements: `docs/event-options.md` (FR-1 … FR-10). Record every result as PASS, FAIL (with the steps that reproduce it) or BLOCKED (with the reason).

## 0. Setup

All commands run from the repo root (`C:\Code\The Pickle Slot`) with Git Bash. Node 22 is installed.

| Suite | Command | Expect |
|---|---|---|
| Unit: engine, standings, formats, playoffs, series | `npm test` | four "all passed" |
| Server rules + AI parsing | `cd backend-worker && npm run test:parse` | three "all passed" |
| Node backend smoke | `cd backend && npm test` | "All smoke checks passed." |
| Web build | `CI=1 npx expo export --platform web --output-dir e2e/web` | "Web Bundled" |
| Android build | `CI=1 npx expo export --platform android --output-dir <temp dir>` | "Android Bundled" |
| Browser e2e | serve the web build: `cd e2e && npx serve -s web -l 5055 --no-clipboard` (skip if something already listens on 5055); then `node rounds.mjs`, `node formats.mjs`, `node calendar.mjs`, `node assistant.mjs` | "all passed" each |

Notes:
- The browser tests use Microsoft Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` through playwright-core, with the server simulated by request routing. No backend is needed.
- Screenshots of failures go to `e2e/screenshots/FAILED-*.png`.
- `e2e/describe-event.mjs` needs a live local Worker and real AI calls. It is out of scope; do not run it.
- Do **not** deploy, push, or change the remote database. QA is read-only apart from local test files and the report.

## 1. Automated coverage map

| Requirement | Covered by |
|---|---|
| FR-2 a–l | `test/formats.test.mjs`, `test/engine.test.mjs` |
| FR-3 | `test/formats.test.mjs` (recomputeFrom), `e2e/formats.mjs` "King of the Court" |
| FR-4 | `test/standings.test.mjs`, `backend-worker/test/state.test.mjs`, `e2e/rounds.mjs` |
| FR-5 | `test/playoffs.test.mjs`, `e2e/formats.mjs` "playoffs", server tests "playoffs" |
| FR-6 | `test/playoffs.test.mjs` "series", `e2e/formats.mjs` "weekly series" |
| FR-7 | `e2e/formats.mjs` "clinic", `test/formats.test.mjs` "clinic" |
| FR-8 | `e2e/formats.mjs` "live sync" |
| FR-9 | `backend-worker/test/state.test.mjs` |
| FR-1 | `e2e/formats.mjs` (format picker, custom, pairs editor, summary) |

## 2. Exploratory and extra checks for QA to write or perform

Write extra scripts under `e2e/qa/` (browser) or `test/qa/` (node). Model them on `e2e/formats.mjs` and `test/formats.test.mjs`. Suggested cases:

1. **Defaults unchanged.** Generate a roster with no options and with `{ standings: 'winPct' }`. It must be identical to the original engine (same seed data, same output).
2. **Every preset** (`FORMATS`) × {8, 9, 10, 12, 13 players} × {1, 2, 3 courts} × {60, 120 min}. Check for each roster:
   - no player appears twice in a round;
   - on-court players plus sit-outs = the round's pool;
   - team sizes are 2 (or 1 for singles);
   - fixed pairs are never split;
   - groups keep the same 4 for 3 rounds;
   - it generates in under 3 s.
3. **Movement edge cases:**
   - 1 court (winners and losers stay);
   - an unscored court in the middle;
   - tied scores (not a result);
   - more players than spots with `extras: rotate`: sit-out spread ≤ 1.
4. **Playoffs:**
   - 3, 5 and 7 teams available (the size is cut down);
   - double elimination with 4 and 8 teams: every non-champion loses at least once, and the grand final pairs the right teams;
   - correcting a semifinal after the final has a score is blocked (locked);
   - correcting it before the final is scored clears nothing it shouldn't.
5. **Series:** a ladder's next session seed order when the last round had sit-outs or unscored courts, and `addDays` across month, year and leap-year boundaries.
6. **Server rules:**
   - a player trying to change another court's score, round index, options, playoffs, teams or `seriesId` is reverted;
   - an older host copy doesn't clobber a newer player score;
   - hostless events stay open.
7. **UI (browser):**
   - every option control in Setup edit mode shows and hides correctly (pairs editor, seed editor, movement choices by groups setting, playoff sub-options, season seeding only for series);
   - the seed-order up/down buttons reorder (`options.seedOrder`);
   - Clinic hides the Roster and Rounds steps;
   - a player sees no Start playoffs, Next round or Check-in controls.
8. **Live sync safety:** while a score is being typed (a local change pending), a server poll must not overwrite it. Simulate this by delaying the routed PUT response.

## 3. Report format

Write `docs/qa-report.md` with:
1. A summary: pass/fail counts per suite.
2. A table: requirement → result → evidence (test name or steps).
3. Defects, each with severity (blocker/major/minor), exact steps or a failing test, and expected vs actual.
4. Coverage gaps and risks.
