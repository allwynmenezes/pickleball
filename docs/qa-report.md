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

---

## Round 2: verification of `18760cd4`

- **Build under test:** `18760cd4` ("Fix QA round 1 defects (D-1 to D-14)"). The web export was rebuilt from this commit before the browser runs.
- **Date:** 2026-09-30
- **Rules:** As in round 1. No application code was changed; QA added only `test/qa/round2.qa.test.mjs`, `e2e/qa/round2-qa.mjs` and this section. Nothing was deployed, committed or pushed.

### R2.1 Suites

| Suite | Result |
|---|---|
| `npm test` (engine, standings, formats, playoffs) | PASS: 77/77 |
| `npm run test:qa` (QA round 1 suites, as updated in 18760cd4) | PASS: 92/92 (formats 61, playoffs-series 16, server-rules 15) |
| `backend-worker` `npm run test:parse` | PASS: 111/111 |
| `backend` `npm test` | PASS: 41/41, "All smoke checks passed." |
| Web export | PASS: "Web Bundled" |
| e2e `rounds.mjs`, `formats.mjs`, `calendar.mjs`, `assistant.mjs` | PASS: 7/7, 12/12, 8/8, 18/18 |
| e2e `qa/formats-qa.mjs` | PASS: 23/23 |
| **New:** `test/qa/round2.qa.test.mjs` | 17 pass, **7 fail** |
| **New:** `e2e/qa/round2-qa.mjs`, with PUTs routed through the real `enforceEventHosts` | 9 pass, **2 fail** |

The new scripts are regression checks for the round-1 fixes:
- **Legitimate flows run through the new server merge:**
  - a player's RSVP Out or partial before games start (in the browser too);
  - a player scoring their own King of the Court game with the remade later rounds;
  - typing "1" then "11" before the reply;
  - a host correction beating a player's score, with the player's stale copy then unable to undo it;
  - every host flow;
  - playoff scoring by a player, and a host's stale copy.
- **Adversarial non-host saves.**
- **Groups:** staggered groups, narrow (6-round) sets with and without `movement: 'set'`, Pool play court use, and a matrix with late arrivals and early leavers.
- **Client:** save retry and round alerts.

### R2.2 Review of the QA test edits made in 18760cd4

| Edit | Verdict |
|---|---|
| server-rules "older host copy": stale copy sends `baseAt: 0` | **Fair.** A stale host copy never saw the player's server stamp. |
| Mirror check's function list (`mergeScore`, `mergeHostRoster`, …) | **Fair.** The check still compares every rule function and `HOST_ONLY_FIELDS`, and it passes. |
| `groupProblems` rewritten for per-group counters (`ns`, `len`) | **Fair, but weaker.** It no longer checks that a group stays on its court during its set. QA re-added that check in round 2, and it finds N-4. |
| "a new set starts early" now allows the intact group to finish its set | **Fair.** This matches the per-group model in the updated FR-2f. |
| Season test pointed at `seasonStandingsFor` | **Fair.** `lib/store.js` `playoffRows` uses it. |
| D-10 check changed to "spread ≤ 3" | **Accepted for 3-round sets** (Scramble, Double Header). **Challenged for 6-round narrow sets.** The threshold is hard-coded to 3 and the matrix doesn't cover them, yet there one set means 6 rounds: in a 60-minute Pool play on 1 court, half the pairs never play (N-5). The fair-share rule should be tested per `groupSet.len`, and a set shouldn't be longer than the event allows everyone to play. |

### R2.3 Round-1 defects: status

| Defect | Status | Evidence |
|---|---|---|
| D-1 non-host roster rewrite | **Fixed as specified**, with residual gaps N-1, N-2, N-3 and N-7 | The round in play is frozen once started. Other people's scores, swapped teams and deleted rounds are all rejected (server-rules and round2 "once started…"). A legitimate RSVP drop-out and a results-driven recompute are accepted (round2 and e2e round2). |
| D-2 server playoff lock | **Fixed** | server-rules "…once the final has a score (FR-5 lock)" |
| D-3 client clock trusted | **Fixed** | Stamps are the server's (`scoredAt`, `scoredBy`), and a future `baseAt` can't block the host (server-rules; round2 "host correction…"). `baseAt` is not stored. |
| D-4 player in two playoff teams | **Fixed** | playoffs-series; e2e qa "Start playoffs never puts a player in two teams" |
| D-5 season seeding picks absent players | **Fixed** | playoffs-series (through `seasonStandingsFor`) |
| D-6 failed save wiped by poll | **Fixed** for transient failures, with residual N-6 | e2e qa "…server 500…" passes; e2e round2 "a save that fails twice is retried…and reaches the server" |
| D-7 day-of pairs re-formed | **Fixed** | formats.qa "fixed pairs: players paired on the day stay paired…" |
| D-8 Pool play idle or unusable courts | **Partially fixed** | 1 court now schedules games, and 2 and 3 courts give everyone a game at 16 or 24 players. But with 16 players on 3 courts, court 3 is still idle every round while 8 players sit (round2 "no court sits idle…"). This contradicts updated FR-2f ("when that would leave courts idle, for example on 1 or 3 courts"). Also see N-5. |
| D-9 movement into unscored courts | **Fixed** | formats.qa QA 3 (unscored top and middle courts, tie, at most one court's move) and set movement |
| D-10 group sit-out spread | **Accepted** (by design, PRD FR-2j) for 3-round sets | See R2.2 and N-5 for 6-round sets. |
| D-11 late arrivals wait a set | **Fixed**, with regression N-4 | formats.qa "a late arrival…" |
| D-12 seeded group opening split | **Fixed** | formats.qa "Double Header: 1&4 v 2&3" |
| D-13 preset resets `playoffTeams` | **Fixed** | formats.qa. The Pool play preset now also sets `extras: rotate`, but the PRD §4 table (`docs/event-options.md:50`) doesn't list it. |
| D-14 break-round sit-outs | **Fixed** | formats.qa "popcorn: a break segment…". This deliberately differs from the pre-branch engine for all-break rounds only; the FR-2a comparison still passes. |
| O-2 alerts on stepping back | **Fixed** | e2e round2 "the host stepping back a round gives no alert; moving forward does" |
| O-1, O-3 | Unchanged | |

### R2.4 New defects and residual gaps

**N-1 (major): A non-host can remove other players from every later round.**
- **Where:** `backend-worker/src/state.js:85-93` and `backend/state.js:80-88`. `validRound` checks that every id is a member and appears once, but not that the round's pool is still accounted for (on court or sitting out).
- **Steps:** round2 "a player can't drop other players from later rounds". In a started event, a player sends rounds 3–4 without `p11`, who is in neither the games nor `sitOut`.
- **Expected:** Rejected. FR-9 says "recomputed later rounds pass through", and a recompute never loses an available player.
- **Actual:** Stored. `p11` has no game for the rest of the event, and the host's phone adopts this on its next poll.
- **Suggestion:** Require that each accepted round's players equal the stored round's players, apart from the requester's own RSVP change.

**N-2 (minor): Court numbers aren't validated in non-host rounds.**
- **Where:** Same function (`validRound`).
- **Steps:** round2 "a player can't put two games on the same court…". Two games on court 1 and one on court 9 are stored.
- **Expected:** Court numbers are unique and between 1 and `ev.courts`.
- **Actual:** Accepted. Round alerts and the Rounds step then show impossible courts.

**N-3 (minor, a risk accepted by the PRD but broader than stated): The server can't tell a recompute from hand-made later rounds.**
- **Where:** `backend-worker/src/state.js:93`.
- **Steps:** round2 "a player can't rewrite later rounds…". With no RSVP change and no results-driven options, a player puts themselves with the two best players on court 1 for every later round. It is stored.
- **Suggestion:** Accept later rounds from a non-host only when the event is results-driven, or when the requester's own RSVP changed in the same save.

**N-4 (minor): With staggered groups, a group moves courts mid-set.**
- **Where:** `lib/engine.js:736` and `:766-771`. Entries are re-indexed, so a continuing group takes `courts[gi]` by its new position.
- **Steps:** round2 "staggered groups…". Scramble with 12 players on 3 courts, where 4 players arrive for round 2:
  - round 3: group p8–p11 moves from court 3 to court 1;
  - round 4: group p0, p1, p4, p5 moves from court 2 to court 1.
- **Expected:** FR-2f: "the same four share a court for 3 rounds".
- **Actual:** The four stay together but switch courts mid-set, which is confusing on the day.

**N-5 (major): Narrow 6-round sets can leave half the players with no games.**
- **Where:** `lib/engine.js:716-719`. `setLen = 6` applies regardless of how many rounds the event has, and nobody is rotated in during a set.
- **Steps:** round2 "Pool play, 16 players / 1 court / 60 min…". With 4 rounds, `p8`–`p15` play 0 games while `p0`–`p7` play 2 each (Pool play now defaults to `extras: rotate`, so all 16 are confirmed).
- **Expected:** FR-2j: sit-outs are shared ("everyone who RSVPs … sitting out in turns").
- **Actual:** Half the field never plays. 2 and 3 courts are fine at 16 or 24 players.

**N-6 (minor): A failing save gives no visible sign, and it pauses live sync for as long as it fails.**
- **Where:** `lib/store.js:71` and `:118`. `unsaved` only makes `applyRemote` retry the save and return; there is no UI for it.
- **Steps (e2e round2):**
  - "the app tells the user…": with saves failing, no "not saved / offline / retrying" text appears.
  - "while a player's save keeps failing…": `GET` works, `PUT` returns 503, and the host moves to round 2. After 20 s the player's phone is still on round 1.
- **Expected:** FR-8 says the user sees the host's round changes. An unsaved change should be flagged.
- **Actual:** This is correct while fully offline (the `GET` fails too). But with a persistent `PUT` rejection (for example a 400 or 413), the phone stops syncing silently until the app restarts.

**N-7 (major, pre-existing but widened by D-1's fix): A player's stale copy reverts the host's re-made rounds.**
- **Where:** `backend-worker/src/state.js:83` and `:93`. Before games start, `frozenTo = currentIdx - 1`, so the player's copy of every round is accepted if it is well-formed.
- **Steps:** round2 "a player's stale copy…doesn't revert the host's rounds". The host switches seeding to DUPR and the rounds are re-made and stored. Within one poll interval, a player's phone saves anything with its older copy.
- **Expected:** The host's rounds stand; the player's save changes only the player's own data.
- **Actual:** The rounds revert to the old, unseeded ones, while `options` stay as the host set them. The roster no longer matches the format, and the host gets no sign of it.
- **Suggestion:** Base the check on a roster version, or accept a non-host roster only when it changes because of that requester's own RSVP or score.

**N-8 (minor, UI):** The RSVP step heading "Responses (capacity: courts × 4)" (`components/eventSteps/RsvpStep.js:87`) is wrong for singles (it should be courts × 2) and for `extras: rotate` (there is no limit). The timeline above it (`:36`) is already correct.

**Doc:** `docs/event-options.md:50` (the PRD §4 Pool play row) doesn't mention the new `extras: rotate`.

### R2.5 Summary

| | Count |
|---|---|
| Round-1 defects fixed with nothing left open | 9: D-2, D-3, D-4, D-5, D-7, D-9, D-12, D-13, D-14 |
| Fixed with residual gaps or a regression | 3: D-1 (N-1, N-2, N-3, N-7), D-6 (N-6), D-11 (N-4) |
| Partially fixed | D-8 (idle court on 3 courts; see also N-5) |
| Accepted | D-10 (for 3-round sets) |
| New defects | 8: N-1, N-5 and N-7 major; N-2, N-3, N-4, N-6 and N-8 minor |
| Regressions in existing suites | None. All 304 original checks and 92 round-1 QA checks pass. |

Recommendation: fix N-1, N-5 and N-7 before release, because they let a player or a stale phone take games away from others without anyone noticing. The rest can follow.

Rerun the round-2 checks with:
```
node --no-warnings test/qa/round2.qa.test.mjs
cd e2e && node qa/round2-qa.mjs      # web export on :5055
```

---

## Round 3: verification of `f842f888`

- **Build under test:** `f842f888` ("Fix QA round 2 defects (N-1 to N-8)"). The web export was rebuilt from this commit.
- **Date:** 2026-09-30
- **Rules:** As before. No application code was changed; QA added only `test/qa/round3.qa.test.mjs`, `e2e/qa/round3-qa.mjs` and this section. Nothing was deployed, committed or pushed.

### R3.1 Suites

| Suite | Result |
|---|---|
| `npm test` (now includes `test/merge.test.mjs`) | PASS: 81/81 |
| `npm run test:qa` (formats 61, playoffs-series 16, server-rules 15, round2 24) | PASS: 116/116 |
| `backend-worker` `npm run test:parse` | PASS: 113/113 |
| `backend` `npm test` | PASS: 41/41 |
| Web export | PASS: "Web Bundled" |
| e2e `rounds`, `formats`, `calendar`, `assistant` | PASS: 7/7, 12/12, 8/8, 18/18 |
| e2e `qa/formats-qa`, `qa/round2-qa` | PASS: 23/23, 11/11 |
| **New:** `test/qa/round3.qa.test.mjs` | 20 pass, **7 fail** |
| **New:** `e2e/qa/round3-qa.mjs`, with saves routed through the real `enforceEventHosts` | 3 pass, **3 fail** |

**The coordinator's adapted round-2 checks are fair.** The "pools (pairs)…" and "narrow sets with movement 'set'…" checks now take the set's end as the next `groupSet.n === 0`. That matches the pool model in the updated FR-2f, and they still check all 6 match-ups, full court use and top-2-up/bottom-2-down. One caveat: if a set never ends within the event, `roster[end]` is undefined and the check would crash rather than report clearly. That can't happen at 24 players and 180 minutes.

**The pool matrix was extended as asked** (round3 "1440 pool events…"). It covers:
- 6 variants: Pool play plain, waitlist, set movement and DUPR-seeded; singles groups with and without set movement;
- 1–4 courts;
- 30, 45, 60, 90 and 120 minutes;
- 8, 10, 13, 16, 18 and 24 players;
- with and without late arrivals and early leavers.

In every event, rounds are valid: nobody appears twice, everyone in the round's pool is on court or sitting out, court numbers are real, teams are the right size, no game repeats within a set, and no court is idle while a pool game could be played. What fails is fairness to units left over from pools (R3-1).

### R3.2 Round-2 items: status

| Item | Status | Evidence |
|---|---|---|
| N-1 player drops others from later rounds | **Partly fixed:** direct edits are rejected, but it reopens through RSVPs (R3-2) | round2 "a player can't drop other players…" passes; round3 "…by also changing that person's RSVP in the same save" fails |
| N-2 court numbers | **Fixed** | round2 "…two games on the same court…" |
| N-3 hand-made later rounds | **Accepted** (PRD §6, `docs/event-options.md:166`) | |
| N-4 group changes court mid-set | **Fixed** | round2 "staggered groups…keeps its court" |
| N-5 / D-8 pools on 1–4 courts | **Partly fixed:** courts are always used and every multiple-of-4 field plays, but leftover units don't (R3-1) | round2 Pool play checks; round3 matrix |
| N-6 failing save unseen, live sync paused | **Fixed** for the first failure; residual defects R3-3, R3-4 and R3-5 | e2e round2 D-6 steps; e2e round3 "…503 shows Not saved yet…clears", "…400 says it was undone…" |
| N-7 stale copy reverts host rounds | **Fixed** | round2 check and round3 "a stale copy saved with a chat message…" |
| N-8 RSVP capacity heading | **Fixed** | `components/eventSteps/RsvpStep.js:87` |
| Docs (Pool play row) | **Fixed** | `docs/event-options.md:50` |

**Legitimate flows the stricter server rule still accepts** (round3 "server merge vs legitimate flows", all pass):
- partial RSVP windows (leaving at 30 minutes, arriving at 30 minutes, and on a 20-minute segment);
- waitlist promotion when a confirmed player drops out;
- a waitlisted player dropping out;
- an out player coming back in;
- a host who doesn't play (no RSVP), and a host who does;
- a Scramble early-leave after games have started;
- a Pool play drop-out;
- a Gauntlet player's own score remaking the later rounds.

**Merge behaviour that works** (lib level): same-game score conflicts, chats (both sides kept, in time order), new chats on both sides, deletions both ways, and a first save that fails before any base exists.

### R3.3 New defects

**R3-1 (major): Pools leave leftover pairs or singles out for the whole set, often the whole event.**
- **Where:** `lib/engine.js:708` and `:725`. `maxPools = floor(units/4)`. The 1–3 units that don't fit a pool sit until *every* pool has played all its games, and a set can run for more rounds than the event has.
- **Steps:** round3 "pools: nobody who RSVPed (extras rotate) goes the whole event without a game…". This fails in 142 of 1,440 events: every variant and court count where the number of units isn't a multiple of 4. For example:
  - Pool play, 10 players (5 pairs), 1 court, 60 minutes: one pair never plays while the others play 2 games each.
  - Pool play, 18 players, 2 courts, 90 minutes: one pair plays 0 games and others play 3.
  - Singles groups, 18 players, 3 courts, 120 minutes: 2 players play 0 games and others play 3.
- **Expected:** PRD FR-2f (`docs/event-options.md:83`) says "everyone gets games even when the event is too short for every pool to finish". FR-2j: sit-outs are shared.
- **Actual:** The leftover units are never scheduled. Pool play defaults to "extras rotate", so they are confirmed and expect to play.

**R3-2 (major): Changing someone else's RSVP now either leaves the event inconsistent or drops that player from later rounds.**
- **Where:** `backend-worker/src/state.js:90` (`ownRsvpChanged`) and `:100` (`available`, which reads the *incoming* RSVPs, not the stored ones). Mirrored in `backend/state.js`. RSVPs of others remain writable by any member (O-3, `docs/event-options.md:166`), and the app offers In/Out/Partial for every member (`components/eventSteps/RsvpStep.js:105-107`).
- **(a) A flow the app offers:** e2e round3 "a player taps Out for another player…". Ben taps Out for Gus. The server stores Gus as "out" but keeps him in all 3 rounds (the save's roster change isn't Ben's own RSVP). Nobody from the waitlist is promoted, and the host sees an Out player on court. This is a regression: in `18760cd4` the recompute was accepted.
- **(b) Adversarial:** round3 "a player can't drop someone else by also changing that person's RSVP in the same save". A player re-saves their own RSVP (for example "partial", 0–60 minutes), marks the victim out, and sends the recomputed rounds. All of it is accepted, and the victim loses every later game. This reopens N-1.
- **Suggestion:** Make RSVPs of others host-only (or self-only), and authorise roster changes only by stored-versus-incoming changes that are the requester's own.

**R3-3 (major): The merge while a save fails drops the host's own changes to the event.** This covers Next round, options, check-in and start/stop games.
- **Where:** `lib/merge.js:29-46`. When both sides changed an event, the server's copy wins, and only our scores and RSVPs are laid on top. `docs/event-options.md:106` documents this narrowly, but nothing tells the user.
- **Steps:** e2e round3 "host offline taps Next round while a player's score reaches the server…". The host's saves fail, the host taps Next round, and a player's score lands on the server. After the next poll and reconnecting:
  - the server is back on round 0;
  - the host's screen jumps back to round 1 (the first round);
  - the strip clears as if all was saved, and no "undone" message appears.
  
  Also reproduced at lib level: round3 "…Next round…" and "…changes an option…".
- **Expected:** FR-8: a server answer never undoes a local edit. If an edit can't be kept, the user is told.
- **Actual:** The host's action is silently lost during a live event. It needs the host's phone to be briefly offline or erroring, which is common courtside.

**R3-4 (minor): Merge can leave a player "Out" but still scheduled.**
- **Where:** `lib/merge.js:31-43`. Our RSVP is laid over the server's roster, but the roster isn't recomputed to match.
- **Steps:** round3 "player offline drops out while the host scores…". The merged event has `p1` out and `p1` still in round 2. The retried save is then accepted (`p1`'s own RSVP changed and the roster is unchanged), so the inconsistency is stored.

**R3-5 (minor): A second refused (4xx) save is undone without any message.**
- **Where:** `lib/store.js:67`. `setSyncProblem` only notifies on a *change*, and the state stays "rejected" until a save succeeds.
- **Steps:** e2e round3 "a second refused save…is reported too". After the first "couldn't be saved and was undone" message hides, the next refused save wipes the score box silently. A standalone probe with two 400s 10 s apart gave message 1, then nothing.

**R3-6 (minor): Merge keeps local pairing history wholesale when both sides changed it.**
- **Where:** `lib/merge.js:78`.
- **Steps:** round3 "history: …both changed": the server's new history entries are lost. This affects matchmaking variety only.

### R3.4 Release verdict

**Not ready to release yet.** Everything that passed before still passes: 81 unit, 116 QA, 113 worker and 41 backend checks, and 79 browser checks across the six existing and QA browser suites. Most round-1 and round-2 defects are fixed. But three new major defects are user-visible on ordinary event nights:
- **R3-1:** with 10 or 18 players in Pool play, a pair can go the whole night without a game.
- **R3-2:** tapping Out for a friend now leaves them scheduled.
- **R3-3:** a host's "Next round" tapped during a network blip is silently undone.

Suggested fixes, in order:
1. **R3-2:** make RSVPs self- or host-only on the server and in the RSVP step. This is small, and it also closes the N-1 reopening.
2. **R3-1:** let leftover units into pool games, or form a 5-unit pool, or end a set when the event can't finish it.
3. **R3-3/R3-4:** in the merge, keep the host's own event-level changes and recompute after laying RSVPs, or show "undone" when local changes are dropped.

R3-5 and R3-6 can follow. After these fixes, rerun `npm test`, `npm run test:qa`, `node --no-warnings test/qa/round3.qa.test.mjs` and `cd e2e && node qa/round3-qa.mjs`.
