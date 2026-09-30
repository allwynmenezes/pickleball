/* ===================== STANDINGS =====================
   Results worked out from the scores entered on an event's rounds. Pure —
   no store, no React — so it's unit-tested directly (test/standings.test.mjs).

   Two ways to rank (the event's `options.standings`):
   - 'winPct'      — wins ÷ games played. Normalises for players who played
                     fewer games (sat out, arrived late); a bye never counts.
   - 'courtPoints' — a win on a higher court is worth more: on a round using
                     N courts, a win on the k-th highest court earns N−k+1
                     (court 1 is the top court), a loss earns nothing. For
                     formats where players move between courts.
   Ties are broken by average point differential (points scored minus points
   allowed, per game), then wins.

   A game counts once both scores are in and they differ (pickleball has no
   draws; equal scores are treated as not yet entered). */

export const STANDINGS_MODES = [
  { key: 'off', label: 'Off' },
  { key: 'winPct', label: 'Win %' },
  { key: 'courtPoints', label: 'Court points' },
];

/* Every finished game on the event: { round, court, rank, courtsInRound,
   teamA, teamB, scoreA, scoreB }. Rounds after `throughRound` (the event's
   current round by default) are left out — they haven't been played. */
export function finishedGames(ev, throughRound = ev.currentRoundIndex || 0) {
  const games = [];
  (ev.roster || []).forEach((round, ri) => {
    if (ri > throughRound) return;
    const courts = (round.courts || []).filter(c => c.teamA && c.teamB);
    const order = [...courts].map(c => c.court).sort((a, b) => a - b);
    courts.forEach(c => {
      if (c.scoreA == null || c.scoreB == null || c.scoreA === c.scoreB) return;
      games.push({
        round: ri, court: c.court, rank: order.indexOf(c.court) + 1, courtsInRound: order.length,
        teamA: c.teamA, teamB: c.teamB, scoreA: c.scoreA, scoreB: c.scoreB,
      });
    });
  });
  return games;
}

/* Per-player standings, best first:
   [{ id, games, wins, losses, pointsFor, pointsAgainst, diff, avgDiff, winPct, courtPoints, rank }] */
export function computeStandings(ev, mode = 'winPct', throughRound) {
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) rows.set(id, { id, games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, courtPoints: 0 });
    return rows.get(id);
  };
  finishedGames(ev, throughRound).forEach(g => {
    const aWon = g.scoreA > g.scoreB;
    const worth = g.courtsInRound - g.rank + 1;
    [[g.teamA, g.scoreA, g.scoreB, aWon], [g.teamB, g.scoreB, g.scoreA, !aWon]].forEach(([team, us, them, won]) => {
      team.forEach(id => {
        const r = row(id);
        r.games++;
        r.pointsFor += us;
        r.pointsAgainst += them;
        if (won) { r.wins++; r.courtPoints += worth; } else r.losses++;
      });
    });
  });
  const list = [...rows.values()].map(r => ({
    ...r,
    diff: r.pointsFor - r.pointsAgainst,
    avgDiff: r.games ? (r.pointsFor - r.pointsAgainst) / r.games : 0,
    winPct: r.games ? r.wins / r.games : 0,
  }));
  const primary = mode === 'courtPoints'
    ? (a, b) => b.courtPoints - a.courtPoints || b.winPct - a.winPct
    : (a, b) => b.winPct - a.winPct;
  list.sort((a, b) => primary(a, b) || b.avgDiff - a.avgDiff || b.wins - a.wins || String(a.id).localeCompare(String(b.id)));
  // Equal on everything that ranks → same rank ("=2nd").
  list.forEach((r, i) => {
    const prev = list[i - 1];
    const same = prev && primary(prev, r) === 0 && prev.avgDiff === r.avgDiff && prev.wins === r.wins;
    r.rank = same ? prev.rank : i + 1;
  });
  return list;
}

export const fmtPct = p => `${Math.round(p * 100)}%`;
export const fmtDiff = d => `${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}`;
