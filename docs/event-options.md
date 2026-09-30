# Event formats — product requirements (PRD)

Branch: `feature/event-options`. Status: implemented, awaiting QA.

## 1. Goal

Instead of building separate event types, the app now has one event with a small set of **options**. The formats that Pickleheads and similar apps offer (Popcorn, Scramble, Double Header, Gauntlet, King of the Court / Claim the Throne, Up & Down the River, Cream of the Crop, Shuffle, Rumble, pool play with playoffs, singles, leagues, ladders, clinics) are **presets** that fill in those options. Every option defaults to the original behaviour, so an event without options must work exactly as before.

## 2. Roles

- **Host**: the account that created the event (`createdBy`). The host edits Setup, runs event day, checks players in, starts playoffs and schedules the next session.
- **Player**: any other signed-in account in the event. A player can RSVP and can score **only games they play in**.
- **Hostless (legacy) event**: an event with no `createdBy`. It stays open to everyone.

## 3. Options (stored as `event.options`; defaults in `DEFAULT_OPTIONS`, `lib/engine.js`)

| Option | Values (default first) | Meaning |
|---|---|---|
| `format` | `popcorn` … `clinic`, `custom` | Which preset filled the options. Becomes `custom` after any manual change. |
| `standings` | `off` · `winPct` · `courtPoints` | Ranking from entered scores. Ties are broken by average point difference, then wins. A court-points win on the k-th of N courts earns N−k+1. |
| `seeding` | `off` · `dupr` · `manual` (`seedOrder`) | Where the **first** round (or the first set of groups) starts. Seeded fours play 1&4 v 2&3. |
| `reseed` | `false` · `true` | Every round is re-seeded from the standings so far. |
| `groups` | `off` · `fixed` | Groups of 4 units stay together for 3 rounds and play every partner combination. Pairs and singles play every opponent across 2 courts. |
| `movement` | `none` · `game` · `set` | `game`: after every game, winners move up a court and losers down, splitting partners. `set` (requires groups): after each group's 3 games, the top 2 move up a group and the bottom 2 move down. |
| `partners` | `rotating` · `fixed` (`pairs`) · `singles` | Singles puts 2 players on a court and halves the capacity. |
| `extras` | `waitlist` · `rotate` | Players beyond court capacity either wait for a spot or all play, sitting out in turns. |
| `playoffs` | `none` · `single` · `double` (+ `playoffTeams` 2/4/8, `thirdPlace`, `playoffSeedFrom` event/season) | A bracket after pool play. |
| `repeat` | `none` · `weekly` · `ladder` | Series (`event.seriesId`) with season standings. A ladder seeds each next session by finishing order. |
| `games` | `scheduled` · `none` | `none` = clinic or lesson: RSVPs only, with no Roster or Rounds steps. |

Consistency rules (`normalizeOptions`, `lib/formats.js`):
- Groups combined with `movement: game` becomes `set`.
- `set` movement without groups becomes `game`.
- Movement, re-seeding or playoffs turn standings on.
- Double elimination needs at least 4 teams.

## 4. Presets (`FORMATS`, `lib/formats.js`)

| Preset | Options |
|---|---|
| Round robin (popcorn) | defaults |
| Scramble | groups + extras rotate |
| Double Header | groups + DUPR seeding + extras rotate |
| Gauntlet | DUPR seeding + re-seed + win % |
| King of the Court | movement per game + court points + extras rotate |
| Up & Down the River | groups + movement per set + win % |
| Cream of the Crop | groups + movement per set + DUPR seeding |
| Shuffle | fixed pairs + win % |
| Rumble | fixed pairs + re-seed |
| Pool play + playoffs | fixed pairs + groups + single-elimination playoffs (4 teams) |
| Singles round robin | singles + win % |
| League night | weekly series + win % |
| Ladder | ladder series + movement per game + court points + extras rotate |
| Clinic / lesson | no games |

Switching presets keeps the host's `pairs`, `seedOrder` and `playoffTeams`.

## 5. Functional requirements and acceptance criteria

**FR-1 Setup UI (host, edit mode).**
- A "Format & options" card lists the format picker and every option. Controls appear conditionally:
  - the pairs editor for fixed pairs;
  - the seed-order editor for manual seeding;
  - the movement choices that fit the groups setting;
  - the playoff sub-options;
  - "Seed the playoffs from" only for series.
- Changing an option saves immediately and rebuilds the roster (rounds already played are kept).
- The read-only summary shows a "Format" card with:
  - Format, How it plays, Standings and Capacity;
  - for a series, "Session n of m" and the next session.

**FR-2 Round generation (`assignFormatRound`, `lib/engine.js`).**
- (a) An event with default options produces exactly the same roster as before. The original engine is used, so the tests in `test/engine.test.mjs` are unchanged.
- (b) DUPR seeding: the top 4 by rating are on court 1, split 1&4 v 2&3. Unrated players start at the bottom.
- (c) Seeding applies to the first round or set only; later rounds mix by variety unless re-seed or movement is on.
- (d) Re-seed: each round's courts are filled in standings order.
- (e) Movement per game:
  - court 1's winners stay, and the other winners go up one court;
  - the bottom court's losers stay, and the other losers go down one court;
  - partners are split;
  - an unscored game keeps its four on the same court.
- (f) Groups: the same four share a court for 3 rounds, and each partners every other once. A new set starts after 3 rounds, or earlier if a member becomes unavailable.
- (g) Movement per set: the top 2 of a group (by wins, then point difference) move up a group and the bottom 2 move down. A group with no results stays together.
- (h) Fixed pairs stay together every round. Players without a pair are paired in RSVP order, and an odd player out sits.
- (i) Singles: 1 v 1, and capacity is 2 per court.
- (j) With `extras: rotate`, everyone who RSVPs is confirmed. Sit-outs are shared, differing by at most 1, and nobody sits twice in a row when avoidable.
- (k) Break segments produce rounds with no games and no sit-outs.
- (l) A round decided by results not yet in is marked `provisional`.

**FR-3 Results-driven rounds (store).**
- For results-driven events (re-seed or movement), entering a score in the current round (or earlier) remakes every round after the current one.
- "Next round" remakes the new current round from the latest scores unless it already has scores.
- Remade games with the same teams on the same court keep scores already entered.

**FR-4 Score entry and standings.**
- The host can score any game; a player can score only their own. The server enforces both rules.
- Scores carry `scoredAt`, and the server keeps the newer of two conflicting scores, for the host too.
- The standings table shows rank, W–L, Win % or Pts, and +/−, with the viewer's own row highlighted.

**FR-5 Playoffs (`lib/playoffs.js`, Rounds step).**
- The host starts playoffs with "Start playoffs" (with a confirmation). Rounds after the current one are dropped.
- Seeds come from standings:
  - singles: players in rank order;
  - fixed pairs: pairs ranked by their best player;
  - rotating partners: the top 2N players paired 1&2N, 2&2N−1, and so on.
- The bracket size is the largest of 2/4/8 not above the requested size and the number of teams available.
- Single elimination uses the standard bracket (1v8, 4v5, 2v7, 3v6), plus an optional 3rd-place match.
- Double elimination:
  - the losers' bracket takes every winners'-bracket loser;
  - the grand final is one game with no reset;
  - a team is out after its second loss.
- Ready matches get courts 1..N in bracket order; others show "Waiting for a court" or "Waiting for earlier results".
- A result is locked once a dependent match has a score. Correcting an earlier result clears stale later scores.
- A champions banner appears when the final is decided.
- "Back to pool play" appears only before any playoff score, and it reschedules the rest of the event.
- Players can score their own playoff match (server-enforced); they can't create, change or remove the bracket.

**FR-6 Series (`lib/series.js`).**
- Setting `repeat` gives the event a `seriesId`.
- "Schedule next session" creates an unpublished copy one week later (same setup, members and options, with no RSVPs or roster).
- For a ladder, the next session gets `seeding: manual` with `seedOrder` = finishing order: last round's courts from court 1 down, winners first, then everyone else by standings.
- "Season standings" appear on the Rounds step once the series has 2 or more sessions.
- Playoffs can be seeded from season standings.

**FR-7 Clinic (`games: none`).**
- There are no Roster or Rounds steps, and the step indicator shows 4 steps.
- The host publishes with "Publish event" on the Setup summary.
- The Rounds step (if reached by link) explains that there are no games.

**FR-8 Live sync and round alerts.**
- While the app is in front, it polls `GET /api/state` every 8 s, and it also applies the reply to its own saves.
- A reply is applied only if nothing changed locally since the request, and no save is pending or in flight.
- When a published event you're a member of (and don't host) starts games, changes round or starts playoffs, a banner shows your court, partner and opponents (or "sitting out"). The phone vibrates on native.
- Tapping the banner opens the Rounds step; the banner hides after 12 s.

**FR-9 Server rules (`backend-worker/src/state.js`, mirrored in `backend/state.js`).**
- The host-only fields now include `options`, `checkedIn`, `published`, `started`, `startedAt`, `currentRoundIndex`, `playoffs` and `seriesId`.
- Non-host roster changes:
  - rounds before the current one keep their stored version;
  - scores change only on the player's own games, and only if newer;
  - recomputed later rounds pass through.
- Playoffs: a non-host can change only the scores of their own matches; teams are re-resolved on the server.

**FR-10 DUPR and check-in (step 1).**
- A DUPR rating (2.000–8.000) is typed in on the Players tab (own rating) or in the host's member editor.
- Host check-in marks each player Here or Not here. "Not here" takes the player out of unplayed rounds; "Here" brings them back.

## 6. Out of scope and known limitations

- **Push notifications while the app is closed** are not built. They need an Expo account, FCM credentials and a new native build. In-app alerts (FR-8) cover the open app.
- Men's and women's court modes apply only to plain rotating events. In format events they play as open courts. Mixed is honoured when the four allow a mixed split.
- Groups are 4 only (no groups of 5). Brackets are 2/4/8 teams with no byes. Double elimination has no bracket reset.
- The event assistant (AI) doesn't set format options yet.
- Live sync is polling (8 s), not push. Two phones remaking the same provisional rounds at once end up with the last writer's version, which is regenerated anyway when the host moves on.

## 7. Where the code is

- `lib/engine.js`: options, capacity, the format engine and `recomputeFrom`.
- `lib/standings.js`, `lib/formats.js`, `lib/playoffs.js`, `lib/series.js`.
- `lib/store.js`: option setters, pairs and seeds, score stamping, results-driven recompute, playoffs, series and live sync.
- `components/EventOptions.js`, `components/Bracket.js`, `components/RoundNotifier.js`, `components/Standings.js`.
- `components/eventSteps/{SetupStep,RoundsStep,RosterStep,RsvpStep}.js` and `app/event/[id].js`.
- Tests: `test/*.test.mjs`, `backend-worker/test/state.test.mjs`, `e2e/{rounds,formats}.mjs`.
