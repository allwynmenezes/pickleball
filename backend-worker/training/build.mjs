/* Builds training/examples.json from examples.source.mjs: each example's
   full model JSON (unmentioned fields filled with "" / 0 / [] / false) and
   what the app would do with it — worked out by the same code the live
   server runs (buildDraft / buildEdit), so an example that doesn't come
   out as intended shows up here, before review.

     node training/build.mjs */
import fs from 'node:fs';
import { buildDraft, buildEdit, describeModes } from '../src/eventParse.js';
import { EXAMPLES, CONVENTIONS, NOW, PLAYERS, BASE_EVENT } from './examples.source.mjs';

const CREATE_BLANK = { isEvent: true, name: '', date: '', startTime: '', endTime: '', durationMin: 0, courts: 0, playerCount: 0, gameLenMin: 0, segments: [], playerNames: [], inviteEveryone: false };
const EDIT_BLANK = { understood: true, name: '', date: '', startTime: '', endTime: '', durationMin: 0, courts: 0, playerCount: 0, gameLenMin: 0, segments: [], addPlayers: [], removePlayers: [], inviteEveryone: false };

const fmtTime = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
const fmtDay = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const addMin = (hhmm, min) => { const [h, m] = hhmm.split(':').map(Number); const t = (h * 60 + m + min) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const nameOf = id => (PLAYERS.find(p => p.id === id) || {}).name;
const format = (segs, courts) => segs.map(s => `${fmtTime(s.start)}–${fmtTime(s.end)}: ${describeModes(s.modes, courts)}`);

function describeEvent(ev, extra = {}) {
  return [
    ['Date', fmtDay(ev.date)],
    ['Time', `${fmtTime(ev.startTime)} – ${fmtTime(addMin(ev.startTime, ev.durationMin))} (${ev.durationMin} min)`],
    ['Courts', `${ev.courts}${extra.courtsFrom ? ` (${extra.courtsFrom} players ÷ 4)` : ''}`],
    ['Game length', `${ev.gameLenMin} min`],
    ['Play format', format(ev.segments, ev.courts)],
    ['Players', ev.memberIds.length ? ev.memberIds.map(nameOf).join(', ') : '—'],
    ...(extra.unmatched && extra.unmatched.length ? [['Not found', extra.unmatched.join(', ')]] : []),
  ];
}

const out = EXAMPLES.map(ex => {
  if (ex.kind === 'create') {
    const model = { ...CREATE_BLANK, ...ex.expect };
    const r = buildDraft(ex.text, model, PLAYERS, NOW);
    const result = r
      ? { refused: false, name: r.draft.name, rows: describeEvent(r.draft, { courtsFrom: r.courtsFrom, unmatched: r.unmatchedNames }) }
      : { refused: true, rows: [['Result', 'Refused — not an event ("Couldn\'t find event details in that")']] };
    return { ...ex, model, result };
  }
  const current = { ...BASE_EVENT, ...(ex.context || {}) };
  const model = { ...EDIT_BLANK, ...ex.expect };
  const r = model.understood === false ? null : buildEdit(ex.text, model, current, PLAYERS, NOW);
  let result;
  if (!r || !r.summary) {
    result = { refused: true, rows: [['Result', model.understood === false ? 'Refused — not a change to this event' : 'Nothing changed']] };
  } else {
    const c = r.changes;
    const after = {
      ...current, ...Object.fromEntries(['name', 'date', 'startTime', 'durationMin', 'courts', 'gameLenMin', 'segments'].filter(k => c[k] !== undefined).map(k => [k, c[k]])),
      memberIds: [...current.memberIds.filter(id => !(c.removeIds || []).includes(id)), ...(c.addIds || [])],
    };
    result = { refused: false, summary: r.summary, rows: [['Reply', r.summary], ...describeEvent(after, { unmatched: r.unmatchedNames })] };
  }
  return { ...ex, context: ex.context ? current : undefined, model, result };
});

const base = { ...BASE_EVENT, rows: describeEvent(BASE_EVENT) };
const data = { now: NOW, players: PLAYERS.map(p => p.name), conventions: CONVENTIONS, baseEvent: base, examples: out };
fs.writeFileSync(new URL('./examples.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`${out.length} examples → training/examples.json`);
for (const ex of out) console.log(`${ex.id.padEnd(4)} ${ex.result.refused ? 'refused' : (ex.result.summary || ex.result.rows.find(r => r[0] === 'Play format')[1].join(' | '))}`);
