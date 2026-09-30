/* ===================== SERIES (leagues and ladders) =====================
   An event with options.repeat 'weekly' or 'ladder' belongs to a series
   (ev.seriesId, the first session's id). The host schedules each next
   session from the last one; the series keeps season standings across them.
   A ladder also carries court positions over: the next session is seeded in
   the order players finished (court 1's winners first). Pure — tested in
   test/series.test.mjs. */
import { computeStandings } from './standings.js';
import { isFinishedGame } from './engine.js';

export const REPEAT_MODES = [
  { key: 'none', label: 'One-off' },
  { key: 'weekly', label: 'Weekly series (season standings)' },
  { key: 'ladder', label: 'Ladder (positions carry over)' },
];

export function seriesEvents(events, seriesId) {
  if (!seriesId) return [];
  return events.filter(e => e.seriesId === seriesId).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/* Standings over every scored game of every session in the series. */
export function seasonStandings(events, seriesId, mode = 'winPct') {
  const roster = seriesEvents(events, seriesId).flatMap(e => e.roster || []);
  return computeStandings({ roster, currentRoundIndex: roster.length }, mode, roster.length);
}

/* Season standings among one session's players — for seeding that
   session's playoffs (nobody absent tonight makes the bracket). */
export function seasonStandingsFor(events, ev, mode = 'winPct') {
  const here = new Set((ev.roster || []).flatMap(r => (r.courts || []).flatMap(c => [...c.teamA, ...c.teamB])));
  return seasonStandings(events, ev.seriesId, mode).filter(r => here.has(r.id));
}

/* YYYY-MM-DD a week later (calendar days, no timezone involved). */
export function addDays(date, days) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/* Where players finished a session, best first: the last round's courts
   from court 1 down, winners before losers on each; then anyone who didn't
   play that round, by the session's standings. */
export function finishingOrder(ev, mode = 'courtPoints') {
  const order = [];
  const push = id => { if (!order.includes(id)) order.push(id); };
  const rounds = (ev.roster || []).slice(0, (ev.currentRoundIndex || 0) + 1);
  const last = [...rounds].reverse().find(r => r.courts && r.courts.length);
  if (last) {
    [...last.courts].sort((a, b) => a.court - b.court).forEach(c => {
      const aWon = isFinishedGame(c) ? c.scoreA > c.scoreB : true;
      [...(aWon ? c.teamA : c.teamB), ...(aWon ? c.teamB : c.teamA)].forEach(push);
    });
  }
  computeStandings(ev, mode, (ev.roster || []).length).forEach(r => push(r.id));
  return order;
}

/* The fields of the next session: a week on, same setup and players, no
   RSVPs or roster yet. A ladder starts from where players finished. */
export function nextSessionFields(ev) {
  const options = { ...(ev.options || {}) };
  if (options.repeat === 'ladder') {
    const members = ev.memberIds || [];
    const finished = finishingOrder(ev).filter(id => members.includes(id));
    options.seeding = 'manual';
    options.seedOrder = [...finished, ...members.filter(id => !finished.includes(id))];
  }
  return {
    name: ev.name, date: addDays(ev.date, 7), startTime: ev.startTime, durationMin: ev.durationMin,
    courts: ev.courts, gameLenMin: ev.gameLenMin, courtNames: { ...(ev.courtNames || {}) },
    segments: (ev.segments || []).map(s => ({ ...s, modes: { ...(s.modes || {}) } })),
    memberIds: [...(ev.memberIds || [])], options, seriesId: ev.seriesId || ev.id,
  };
}
