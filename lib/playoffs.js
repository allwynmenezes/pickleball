/* ===================== PLAYOFFS =====================
   A bracket after pool play (the event's `options.playoffs`). Pure — no
   store, no React — so it's unit-tested directly (test/playoffs.test.mjs).

   ev.playoffs = { type: 'single'|'double', teams: [[ids], ...] (seed order),
                   matches: [{ id, label, stage, a, b, teamA, teamB,
                               scoreA, scoreB, scoredAt }] }
   A match's sides (a, b) say where its teams come from: { seed: n },
   { winnerOf: matchId } or { loserOf: matchId }. resolvePlayoffs() fills in
   teamA/teamB from the results so far — stored on the match, so the server
   can tell whose game a score belongs to. Matches are listed so every match
   comes after the ones it depends on.

   Single elimination: the usual bracket (1 v 8, 4 v 5, 2 v 7, 3 v 6), with
   an optional 3rd-place match. Double elimination: a team is out after two
   losses — the losers' bracket takes each winners'-bracket loser, and its
   champion meets the winners' champion in the grand final (one game, no
   reset). */
import { computeStandings } from './standings.js';

export const PLAYOFF_TYPES = [
  { key: 'none', label: 'None' },
  { key: 'single', label: 'Single elimination' },
  { key: 'double', label: 'Double elimination' },
];
export const PLAYOFF_SIZES = [2, 4, 8];

/* Seeds in bracket order, paired off: [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function bracketOrder(size) {
  let order = [1, 2];
  while (order.length < size) { const n = order.length * 2 + 1; order = order.flatMap(s => [s, n - s]); }
  return order;
}

function roundName(teamsLeft) {
  return teamsLeft === 2 ? 'Final' : teamsLeft === 4 ? 'Semifinal' : teamsLeft === 8 ? 'Quarterfinal' : `Round of ${teamsLeft}`;
}

export function buildBracket(type, size, thirdPlace) {
  const matches = [];
  const add = (id, label, stage, a, b) => matches.push({ id, label, stage, a, b, teamA: null, teamB: null, scoreA: null, scoreB: null });
  const k = Math.round(Math.log2(size));
  const order = bracketOrder(size);
  const double = type === 'double' && size >= 4;
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r;
    const name = double ? (count === 1 ? 'Winners final' : `Winners ${roundName(size / 2 ** (r - 1)).toLowerCase()}`) : roundName(size / 2 ** (r - 1));
    for (let i = 1; i <= count; i++) {
      const a = r === 1 ? { seed: order[2 * i - 2] } : { winnerOf: `W${r - 1}-${2 * i - 1}` };
      const b = r === 1 ? { seed: order[2 * i - 1] } : { winnerOf: `W${r - 1}-${2 * i}` };
      add(`W${r}-${i}`, count > 1 ? `${name} ${i}` : name, 'W', a, b);
    }
  }
  if (double) {
    let lr = 1;
    let prev = [];
    for (let i = 1; i <= size / 4; i++) {
      add(`L1-${i}`, `Losers round 1${size > 4 ? ` · ${i}` : ''}`, 'L', { loserOf: `W1-${2 * i - 1}` }, { loserOf: `W1-${2 * i}` });
      prev.push(`L1-${i}`);
    }
    for (let r = 2; r <= k; r++) {
      lr++;
      const losers = Array.from({ length: size / 2 ** r }, (_, i) => `W${r}-${i + 1}`).reverse();
      const major = [];
      prev.forEach((p, i) => {
        const id = `L${lr}-${i + 1}`;
        add(id, `Losers round ${lr}${prev.length > 1 ? ` · ${i + 1}` : ''}`, 'L', { winnerOf: p }, { loserOf: losers[i] });
        major.push(id);
      });
      prev = major;
      if (r < k) {
        lr++;
        const minor = [];
        for (let i = 0; i < prev.length / 2; i++) {
          const id = `L${lr}-${i + 1}`;
          add(id, `Losers round ${lr}${prev.length > 2 ? ` · ${i + 1}` : ''}`, 'L', { winnerOf: prev[2 * i] }, { winnerOf: prev[2 * i + 1] });
          minor.push(id);
        }
        prev = minor;
      }
    }
    add('GF', 'Grand final', 'F', { winnerOf: `W${k}-1` }, { winnerOf: prev[0] });
  } else if (thirdPlace && size >= 4) {
    add('3RD', '3rd place', '3', { loserOf: `W${k - 1}-1` }, { loserOf: `W${k - 1}-2` });
  }
  return matches;
}

const finished = m => !!(m.teamA && m.teamB && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB);
const same = (x, y) => JSON.stringify(x || null) === JSON.stringify(y || null);

/* Fills in each match's teams from the results so far (mutates). A match
   whose teams changed — an earlier result was corrected — loses its stale
   score. Returns { champion, runnerUp, third }. */
export function resolvePlayoffs(p) {
  const res = new Map();
  const teamOf = src => {
    if (!src) return null;
    if (src.seed) return p.teams[src.seed - 1] || null;
    const r = res.get(src.winnerOf || src.loserOf) || {};
    return (src.winnerOf ? r.winner : r.loser) || null;
  };
  p.matches.forEach(m => {
    const A = teamOf(m.a), B = teamOf(m.b);
    if (!same(A, m.teamA) || !same(B, m.teamB)) {
      if (m.teamA || m.teamB) { m.scoreA = null; m.scoreB = null; delete m.scoredAt; }
      m.teamA = A; m.teamB = B;
    }
    res.set(m.id, finished(m) ? (m.scoreA > m.scoreB ? { winner: A, loser: B } : { winner: B, loser: A }) : {});
  });
  const final = p.matches.find(m => m.id === 'GF') || [...p.matches].reverse().find(m => m.stage === 'W');
  const third = p.matches.find(m => m.id === '3RD');
  const fr = final ? res.get(final.id) || {} : {};
  return { champion: fr.winner || null, runnerUp: fr.loser || null, third: third ? (res.get(third.id) || {}).winner || null : null };
}

/* Matches ready to play (both teams known, no result yet), each with a
   court: the first `courts` of them in bracket order get courts 1..n. */
export function playoffCourts(p, courts) {
  const ready = p.matches.filter(m => m.teamA && m.teamB && !finished(m));
  return new Map(ready.map((m, i) => [m.id, i < courts ? i + 1 : null]));
}
export function isPlayoffMatchDone(m) { return finished(m); }
/* A result can't change once a later match that depends on it has a score. */
export function playoffMatchLocked(p, matchId) {
  return p.matches.some(m => (m.scoreA != null || m.scoreB != null) && [m.a, m.b].some(s => s && (s.winnerOf === matchId || s.loserOf === matchId)));
}

/* The teams that make the playoffs, best seed first, from standings rows
   (computeStandings): singles — the top players; fixed pairs — the pairs,
   placed by their best player; rotating partners — the top 2N players,
   paired best with worst (1 & 2N, 2 & 2N−1, …). Size is cut to the largest
   of 2/4/8 that there are enough teams for. Returns { size, teams }. */
export function playoffEntrants({ rows, partners, pairs, requested }) {
  const pos = new Map(rows.map((r, i) => [r.id, i]));
  let pool;
  if (partners === 'singles') pool = rows.map(r => [r.id]);
  else if (partners === 'fixed') {
    pool = (pairs || []).filter(p => p.length === 2 && p.some(id => pos.has(id)))
      .map(p => ({ p, k: Math.min(...p.map(id => (pos.has(id) ? pos.get(id) : Infinity))) }))
      .sort((a, b) => a.k - b.k).map(x => x.p);
  } else pool = null;
  const available = pool ? pool.length : Math.floor(rows.length / 2);
  let size = [...PLAYOFF_SIZES].reverse().find(s => s <= Math.min(requested || 4, available)) || 0;
  if (size < 2) return { size: 0, teams: [] };
  if (pool) return { size, teams: pool.slice(0, size) };
  const top = rows.slice(0, size * 2).map(r => r.id);
  return { size, teams: Array.from({ length: size }, (_, i) => [top[i], top[size * 2 - 1 - i]]) };
}

/* The pairs that played in an event's rounds (fixed-pair events), for
   playoffEntrants — the host's pairs plus any formed on the day. */
export function pairsPlayed(ev) {
  const seen = new Map();
  (ev.roster || []).forEach(r => (r.courts || []).forEach(c => [c.teamA, c.teamB].forEach(t => {
    if (t && t.length === 2) seen.set([...t].sort().join('+'), t);
  })));
  return [...seen.values()];
}

/* Standings rows for seeding: this event's, or the whole series'. */
export function seedingRows(ev, mode, seasonRows) {
  return seasonRows || computeStandings(ev, mode, (ev.roster || []).length);
}
