# QA report: event formats (`feature/event-options`)

- **Build under test:** `1f6964a6` (d5583a0d + PRD/test-plan docs). The web export was rebuilt from this code before the browser runs.
- **Date:** 2026-09-30
- **Requirements:** `docs/event-options.md` (FR-1 … FR-10)
- **Plan:** `docs/qa-test-plan.md`
- **Environment:** Windows 11, Node 22, Git Bash, and Edge through playwright-core. The server was simulated with `page.route`, and the static server on :5055 served `e2e/web`.
- **Scope:** QA added files only (`test/qa/`, `e2e/qa/`, this report). No application code was changed. Nothing was deployed or pushed, and no remote database was touched.

## 1. Summary

### 1.1 Existing suites (test plan §0)

| Suite | Command | Result |
|---|---|---|
| Unit: engine | `npm test` → `test/engine.test.mjs` | PASS: 35/35 |
| Unit: standings | `test/standings.test.mjs` | PASS: 7/7 |
| Unit: formats | `test/formats.test.mjs` | PASS: 22/22 |
| Unit: playoffs + series | `test/playoffs.test.mjs` | PASS: 13/13 |
| Server rules + AI parsing | `cd backend-worker && npm run test:parse` | PASS: eventParse 65/65, ai 23/23, state 16/16 |
| Node backend smoke | `cd backend && npm test` | PASS: 41/41, "All smoke checks passed." |
| Web build | `CI=1 npx expo export --platform web --output-dir e2e/web` | PASS: "Web Bundled" (908 modules) |
| Android build | `CI=1 npx expo export --platform android --output-dir <scratch>` | PASS: "Android Bundled" (1106 modules) |
| Browser e2e: rounds | `cd e2e && node rounds.mjs` | PASS: 7/7 |
| Browser e2e: formats | `node formats.mjs` | PASS: 12/12 |
| Browser e2e: calendar | `node calendar.mjs` | PASS: 8/8 |
| Browser e2e: assistant | `node assistant.mjs` | PASS: 18/18 |

All existing suites pass: **304 checks, 0 failures**, and both bundles build.

### 1.2 New QA checks (written for this report)

| Script | Covers (plan §2) | Checks | Pass | Fail |
|---|---|---|---|---|
| `test/qa/formats.qa.test.mjs` | 1 defaults, 2 preset matrix (≈570 rosters played out), 3 movement, groups/seeding/pairs/singles/breaks, option rules, stress | 61 | 49 | 12 |
| `test/qa/playoffs-series.qa.test.mjs` | 4 playoffs (all 64 double-elim-of-4 outcomes, 300 random double-elim-of-8), 5 series | 16 | 14 | 2 |
| `test/qa/server-rules.qa.test.mjs` | 6 server rules (adversarial non-host), Worker ↔ Node mirror | 15 | 10 | 5 |
| `e2e/qa/formats-qa.mjs` (run from `e2e/`) | 7 UI show/hide, seed buttons, clinic, player gating; 8 live sync; alerts; playoffs; series | 23 | 21 | 2 |
| **Total** | | **115** | **94** | **21** |

The 21 failures map to **14 defects**: 8 major, 6 minor, and no blockers. Nothing crashed. Every roster in the preset matrix had no duplicate players and the right team sizes, accounted for every player in the round's pool, and took well under 3 s to generate. A single 3-hour roster for 32–40 players on 8 courts generates in 10–160 ms.

## 2. Requirement → result → evidence

| Req | Result | Evidence |
|---|---|---|
| FR-1 Setup UI: conditional controls, instant save, Custom, summary | PASS | `e2e/qa` "defaults…", "fixed pairs shows the pairs editor…", "manual seeding shows the seed editor; up/down reorder options.seedOrder", "groups on: movement offers…", "groups off with set movement…", "playoffs: sub-options appear…", "no games (clinic) hides…", "every option change is saved…"; `e2e/formats.mjs`; "summary shows Session 2 of 2" |
| FR-1 Switching presets keeps `playoffTeams` | FAIL (minor) | D-13 |
| FR-2a Defaults unchanged | PASS | `formats.qa` QA 1: 147 setups × 6 option sets are byte-identical to the pre-branch engine (`git show 5c7a937b:lib/engine.js`). The setups include mixed/men/women/break courts and partial RSVPs. |
| FR-2b DUPR seeding, unrated at bottom | PASS | "DUPR seeding, unrated players start at the bottom"; "Double Header: first set seeded by DUPR" |
| FR-2b "Seeded fours play 1&4 v 2&3" with groups | FAIL (minor) | D-12 |
| FR-2c Seeding sets only the first round or set | PASS | `test/formats.test.mjs`; matrix |
| FR-2d Re-seed | PASS | "re-seed (Gauntlet): every round after the first is filled in standings order" |
| FR-2e Movement per game | PARTIAL | PASS: all-scored cases on 1/3/4 courts, partners split, provisional flag, a whole event of moves, and an unscored *middle* court staying. FAIL: an unscored or tied top court doesn't keep its four, and players jump 2 courts (D-9). |
| FR-2f Groups: same four for 3 rounds, every partner once, early new set | PASS | Matrix `groupProblems`; "Scramble: each group's 3 games cover every partner…"; "a new set starts early…" |
| FR-2f Groups use the courts available | FAIL | D-8 (pairs/singles pools), D-11 (late arrivals) |
| FR-2g Set movement | PARTIAL | PASS: "Up & Down the River: top 2 up, bottom 2 down". FAIL: "a group with no results stays together" (D-9). |
| FR-2h Fixed pairs | PARTIAL | PASS: host pairs never split in the matrix, and the odd player out sits. FAIL: day-of pairs are re-formed each round (D-7). |
| FR-2i Singles | PASS | "singles: 1 v 1 and capacity is 2 per court"; matrix |
| FR-2j Extras rotate: spread ≤ 1, no back-to-back sits | PARTIAL | PASS for every non-group preset in the matrix and for King of the Court with 14 players on 3 courts. FAIL for Scramble and Double Header (D-10). |
| FR-2k Breaks: no games, no sit-outs | PARTIAL | PASS for format-engine events (kingOfCourt, scramble, shuffle). FAIL for plain events (D-14, which predates this branch). |
| FR-2l Provisional | PASS | Movement checks; `e2e/formats.mjs` |
| FR-3 Results-driven recompute; scores kept on remade games | PASS | `playOut` in every results-driven preset; "remade games… keep their scores"; "history stays consistent after many recomputes" |
| FR-4 Score permissions (UI) | PASS | `e2e/rounds.mjs`; `e2e/qa` "a player can score their own playoff match but not another" |
| FR-4 Score permissions (server), newer score wins | FAIL (major) | D-1, D-3 |
| FR-4 Standings table | PASS | `e2e/rounds.mjs`, `test/standings.test.mjs`; "court points: … N−k+1" |
| FR-5 Bracket size, order, courts, double elimination, correction, champions | PASS | "size is cut…"; "single elimination of 8…"; "double elimination of 4: 64 result patterns…"; "…of 8: 300 result patterns…"; "correcting a semifinal before the final…"; "ready matches get courts…"; `e2e/formats.mjs` champions |
| FR-5 Lock after a dependent score | PARTIAL | PASS in the UI and `lib` ("host: once the final has a score, a semifinal score box is locked"). FAIL on the server (D-2). |
| FR-5 Entrants | FAIL (major) | D-4 (a player is in two teams), D-5 (season seeding) |
| FR-5 Player can't create, change or remove the bracket | PASS | server-rules "a player can't change another match, the teams or the bracket", "can't start or remove playoffs" |
| FR-5 "Back to pool play" only before a playoff score | PASS | `e2e/qa` host lock step; player sees none |
| FR-6 Series: seriesId, next session, ladder seed order, season standings, `addDays` | PASS | "addDays across month, year and leap-year boundaries"; "ladder finishing order… sit-outs… unscored court"; "ladder: members who never played still get a seed"; "Season standings appear once the series has 2 sessions"; `e2e/formats.mjs` weekly series |
| FR-6 Playoffs seeded from season standings | FAIL (major) | D-5 |
| FR-7 Clinic | PASS (note) | "a clinic shows 4 steps"; `e2e/formats.mjs` publish. Note: a Rounds link lands on Setup, so the "no games" text in `RoundsStep.js:24` can't be reached (observation O-1). |
| FR-8 Poll never overwrites a pending or in-flight save | PASS | "a poll during a slow save (12 s) does not overwrite the score being entered" |
| FR-8 A failed save | FAIL (major) | D-6 |
| FR-8 Alerts: player alerted, host not, tap opens Rounds, hides after 12 s, playoffs alert | PASS | `e2e/qa` last 4 steps; `e2e/formats.mjs` live sync |
| FR-8 Vibration on native | NOT TESTED | Web only (see §4) |
| FR-9 Host-only fields | PASS | "a player changing round index, options, playoffs, seriesId, checkedIn is reverted"; signed-out save; hostless open; non-host can't delete |
| FR-9 Non-host roster merge | FAIL (major) | D-1 |
| FR-9 Worker and Node backend mirror | PASS | "the rule functions are identical in backend/state.js and backend-worker/src/state.js" |
| FR-10 DUPR and check-in | PASS | `e2e/rounds.mjs` check-in; the `duprOf` 2–8 clamp was reviewed (`backend-worker/src/state.js:206`) |

## 3. Defects

Severity: **blocker** stops release, **major** breaks a requirement in a way users will hit or can exploit, **minor** is a rule deviation with a workaround or low impact.

### D-1 (major): A non-host can rewrite the current and later rounds, score other people's games and delete rounds
- **Where:** `backend-worker/src/state.js:55-73`, mirrored in `backend/state.js:50-68`.
  - `:60` protects only rounds *before* `currentIdx`, so the current round is taken from the client.
  - `:66` (`if (!sameTeams(before, c)) return c;`) accepts any court whose teams differ, including its score.
  - `:72` keeps only the rounds before `currentIdx` when the incoming roster is shorter.
- **Steps:** `node --no-warnings test/qa/server-rules.qa.test.mjs`
  - Player `a` sends the current round's court 2 (not their game) with teamA and teamB swapped and `11-0`. The server stores `["d","h"] v ["c","g"] 11-0`.
  - Player `h` replaces `d` with `a` on court 2 of the current round. This is accepted.
  - Player `a` sends `roster.slice(0, 1)`. The server keeps 1 of 3 rounds.
- **Expected:** FR-9: "scores change only on the player's own games". Rounds from the current one on may change only as a genuine recompute.
- **Actual:** Any signed-in member can change who plays and the results of games they aren't in, or wipe the rest of the event. The host's app then adopts the change on its next poll.
- **Suggestion:** Treat the current round like played rounds for non-hosts (only their own score may change). Accept later rounds only for results-driven events or the player's own RSVP change. Never accept a score on a court whose teams changed. Never shorten the roster.

### D-2 (major): The playoff lock is not enforced on the server; a semifinal loser can overturn a played final
- **Where:** `backend-worker/src/state.js:113-120`, mirrored in `backend/state.js:108-115`. There is no `playoffMatchLocked` check. The host path (`:101-111`) has none either.
- **Steps:** server-rules "a player can't change their semifinal result once the final has a score". The bracket is SF1 a,b 11–5 g,h, and the final a,b 11–7 c,d. Player `g` then sends SF1 as 5–11 with a newer `scoredAt`.
- **Expected:** FR-5: "A result is locked once a dependent match has a score."
- **Actual:** SF1 flips, `resolvePlayoffTeams` puts g,h into the final, and the final's score is erased. The lock exists only in the UI (`components/Bracket.js:127`, `lib/store.js:743`).

### D-3 (major): The server trusts the client's `scoredAt`, so a future-dated or clock-skewed score can't be corrected, even by the host
- **Where:** `backend-worker/src/state.js:30` (`newer`), used at `:44`, `:67`, `:109` and `:118`. Mirrored in `backend/state.js:25`.
- **Steps:** server-rules "a player can't future-date their own score…". Player `a` scores their own game with `scoredAt` 10 years ahead. The host corrects it a minute later and the correction is discarded.
- **Expected:** FR-4: the newer score wins, and the host can correct any score.
- **Actual:** The future-dated score wins forever. A phone whose clock is just a few minutes fast also beats corrections for that long.
- **Suggestion:** Stamp or clamp `scoredAt` with server time on receipt, and let the host override.

### D-4 (major): "Start playoffs" can seed the same player into two teams (fixed pairs)
- **Where:** `lib/store.js:716-718` builds the list as `o.pairs` + `pairsPlayed(ev)`, deduplicated by pair only. `lib/playoffs.js:139-141` never checks that a player appears in just one pair. This is fed by D-7.
- **Steps (UI):** `cd e2e && node qa/formats-qa.mjs`, step "Start playoffs never puts a player in two teams".
  - A Pool play event has host pairs H+Ben, Cara+Dev, Eli+Fay and Gus+Ivy.
  - Round 1 was played as H+Cara v Ben+Dev (the host re-paired afterwards).
  - Start playoffs.
- **Expected:** 4 distinct pairs.
- **Actual:** `[["host1","p2"],["host1","p3"],["p3","p4"],["p2","p4"]]`. Four players are in two teams each, and Eli, Fay, Gus and Ivy are left out. Screenshot: `e2e/screenshots/FAILED-qa-1.png`. The same result reproduces at `lib` level in playoffs-series "fixed pairs changed during the event…".

### D-5 (major): Season-seeded playoffs pick players who aren't at this session
- **Where:** `lib/store.js:709` returns `seasonStandings(...)` unfiltered. `lib/playoffs.js:137` and `:147` take the top rows as they are.
- **Steps:** playoffs-series "season seeding only seeds players who are in this session".
  - Session 1 has a,b,c,d,w,x,y,z.
  - Session 2 has a,b,c,d.
  - Start rotating-partner playoffs seeded from the season.
- **Expected:** The teams are drawn from this session's players.
- **Actual:** The teams are `[["w","z"],["x","y"]]`, and none of those players are present. Singles has the same problem. Fixed pairs are unaffected because the pairs come from the event.

### D-6 (major): A score whose save fails is silently wiped by the next poll
- **Where:** `lib/store.js:59-70`. `.catch` only decrements `inFlight`, so the change is not remembered as unsaved and there is no retry. At `:113-119`, the next `refreshFromServer` then applies the older server state.
- **Steps:** `e2e/qa` "a score whose save failed (server 500)…". The host types 11 and the PUT returns 500. About 8 s later the poll returns the old state and the box is empty again, with no error shown. Screenshot: `e2e/screenshots/FAILED-qa-2.png`.
- **Expected:** FR-8 says a local change must never be undone by a poll. An unsaved change should stay and be retried, or at least be flagged.
- **Actual:** The score is lost. Before this branch there was no polling, so the local copy survived until the next save.

### D-7 (major): Day-of fixed pairs are re-formed every round; one late or early player reshuffles every unpaired team
- **Where:** `lib/engine.js:521-523`. `unitsFor` pairs loose players by their position in *this round's* pool.
- **Steps:** formats.qa "fixed pairs: players paired on the day stay paired when another player leaves early". There are 8 players with no host pairs, and p1 leaves after 30 minutes. From round 3 the pairs become p0+p2, p3+p4 and p5+p6.
- **Expected:** FR-2h: "Fixed pairs stay together every round."
- **Actual:** Every day-of pair after the missing player changes, which also makes the standings per pair meaningless and feeds D-4. A related risk: with `extras: waitlist`, a host pair can be split when one partner is past capacity (`lib/engine.js:326-331` counts players, not pairs).

### D-8 (major): Pool play and other pairs/singles groups schedule no games on 1 court and leave a court idle with an odd number of courts
- **Where:** `lib/engine.js:697-698`, where `courtsPerGroup` is 2 for pairs and singles.
- **Steps:**
  - formats.qa "Pool play on 1 court still schedules games" gives 0 games in 8 rounds, and everyone sits out every round. The matrix `poolPlay` records 120 problems, all on 1-court setups.
  - The probe with 12 players on 3 courts shows court 3 empty in every round while 4 confirmed players sit out a whole set, in rotation.
- **Expected:** The preset works, or Setup warns that it needs an even number of courts (at least 2).
- **Actual:** It fails silently. The 4-units-only restriction is documented, but the 2-courts-per-group requirement is not.

### D-9 (minor): Movement displaces an unscored or tied court, and players can move two courts
- **Where:**
  - `lib/engine.js:566-571`: arrivals from below get sub-key 2, which sorts ahead of "stay" (5).
  - `lib/engine.js:604-609`: the same rule for sets.
- **Steps (formats.qa):**
  - "an unscored top court keeps its four in place": court 1 goes from p0–p3 to p0,p1,p4,p5.
  - "a tied score on court 1…": the same result.
  - "with an unscored middle court nobody moves more than one court": court 3's winners jump to court 1, and court 1's losers drop to court 3.
  - "set movement: a group with no results stays together": the result-less top group is split.
- **Expected:** FR-2e says an unscored game keeps its four on the same court. FR-2g says a group with no results stays together. The PRD also says winners and losers move one court.
- **Actual:** The four or group is split when a neighbour has a result. This only matters if the host moves on before every score is in.

### D-10 (minor): Scramble and Double Header break the sit-out fairness rule
- **Where:** `lib/engine.js:702-703`. A set continues without re-choosing who sits.
- **Steps:** formats.qa "extras rotate with groups…".
  - With 8 players on 1 court for 120 minutes, p4–p7 sit 5 rounds and p0–p3 sit 3.
  - With 10 players on 2 courts, the spread is 1 but there are back-to-back sits.
- **Expected:** FR-2j: spread ≤ 1, and nobody sits twice in a row when avoidable.
- **Actual:** The spread reaches 2–3, and the same players sit 3 rounds in a row. This follows from 3-game groups. Either document it as a known limitation or rotate sitters between sets more evenly.

### D-11 (minor): With groups, late arrivals can't use an idle court until the set ends
- **Where:** `lib/engine.js:702`. The existing set is kept whenever `gs.groups.length <= maxGroups`.
- **Steps:** formats.qa "groups: a late arrival…". 12 players, 3 courts, 4 arrive at round 2. Round 2 uses 2 courts while p8–p11 sit out.
- **Expected:** A new group forms on the free court.
- **Actual:** They sit for up to 2 rounds.

### D-12 (minor): A seeded group's first game is 1&2 v 3&4, not 1&4 v 2&3
- **Where:** `lib/engine.js:720-721`. `SPLITS[0]` is used for n = 0.
- **Steps:** formats.qa "Double Header: a seeded four's first game is 1&4 v 2&3". The result is p0,p1 v p2,p3.
- **Expected:** PRD §3: "Seeded fours play 1&4 v 2&3."
- **Actual:** The two best players partner in the first game. All three splits still happen over the set.

### D-13 (minor): Switching presets overrides the host's `playoffTeams`
- **Where:** `lib/formats.js:116`. `...f.options` is spread after `...kept`, so Pool play's `playoffTeams: 4` wins.
- **Steps:** formats.qa "switching presets keeps the host's playoffTeams…": 8 becomes 4.
- **Expected:** PRD §4: "Switching presets keeps the host's pairs, seedOrder and playoffTeams."
- **Actual:** The value is reset for Pool play. Fix either the code or the PRD.

### D-14 (minor, predates this branch): Break rounds in plain rotating events list everyone as sitting out
- **Where:** `lib/engine.js:375-395`. `assignRound` benches the whole pool when no court is usable. The UI then shows it at `components/eventSteps/RoundsStep.js:101`, and `components/RoundNotifier.js:70` alerts "you're sitting out this one".
- **Steps:** formats.qa "popcorn: a break segment gives rounds with no games and no sit-outs". The break round has `sitOut` of 8.
- **Expected:** FR-2k: no sit-outs in a break round.
- **Actual:** Everyone is listed. It is harmless to fairness, since everyone is counted equally, but confusing in the UI. The output is identical to the original engine, so fixing it touches FR-2a.

### Observations (not counted as defects)
- **O-1:** A Rounds link to a clinic lands on Setup (`app/event/[id].js:171`), so the "no games" message in `RoundsStep.js:24` can't be reached. This is safe behaviour, but the PRD FR-7 wording doesn't match.
- **O-2:** Round alerts also fire when the host steps *back* a round (`lib/store.js:86`).
- **O-3:** `rsvps` and `noShows` are not host-only. A player can therefore mark another player out, which has the same effect as a "Not here" check-in, even though `checkedIn` itself is protected. This design predates the branch, but it undercuts FR-10's host-only check-in.

## 4. Coverage gaps and risks

- **Native only:** vibration (FR-8) and the Android UI were not exercised. The Android bundle builds, but nothing ran on a device.
- **Real backend:** The server rules were tested as a pure function (`enforceEventHosts`). The Worker/D1 round-trip, auth tokens and two real phones racing were not tested; the plan puts `describe-event.mjs` out of scope.
- **Concurrency:** The PRD accepts that two phones remaking provisional rounds is last-writer-wins. Combined with D-1, a player's stale or malicious recompute of the *current* round will be accepted.
- **Mixed courts in format events:** Mixed courts were checked only for crashes and invariants in the matrix, not for split quality. Men's and women's courts become open courts in format events, as documented.
- **Groups with singles:** Singles with groups is not a preset and was only reached through the custom path in reasoning. It shares D-8.
- **Large events:** The stress runs used up to 40 players on 8 courts. `varietyGroups` switches to "first 4" above 28 units (`lib/engine.js:667`), so large Scramble events lose variety. Variety quality was not measured.
- **Ladder across 3+ sessions and season playoffs:** Only the next-session seed order and a 2-session season were tested.
- **Stale screenshot:** `e2e/screenshots/FAILED-qa-3.png` is from an earlier QA run and should be ignored.

## 5. How to rerun the QA checks

```
node --no-warnings test/qa/formats.qa.test.mjs
node --no-warnings test/qa/playoffs-series.qa.test.mjs
node --no-warnings test/qa/server-rules.qa.test.mjs
cd e2e && node qa/formats-qa.mjs     # needs the web export served on :5055
```
Each script exits non-zero while its defects are open. The failing checks are named in §3.
