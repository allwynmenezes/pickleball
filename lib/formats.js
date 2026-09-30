/* ===================== FORMATS =====================
   Named formats are presets: each just fills in the event's options (see
   DEFAULT_OPTIONS in lib/engine.js), which the host can then adjust — any
   change after that shows the format as "Custom". */
import { DEFAULT_OPTIONS, eventOptions } from './engine.js';

export const FORMATS = [
  { key: 'popcorn', label: 'Round robin (popcorn)', blurb: 'Partners and opponents rotate every game, mixing everyone as evenly as possible.', options: {} },
  { key: 'scramble', label: 'Scramble', blurb: 'Groups of 4 share a court for 3 games, each partnering the other three once; extra players sit out in turns.', options: { groups: 'fixed', extras: 'rotate' } },
  { key: 'doubleHeader', label: 'Double Header', blurb: 'Like Scramble, but the first groups are formed by DUPR rating.', options: { groups: 'fixed', seeding: 'dupr', extras: 'rotate' } },
  { key: 'gauntlet', label: 'Gauntlet', blurb: 'Seeded by DUPR, then re-seeded every game from the standings: winners meet winners (1 & 4 v 2 & 3).', options: { seeding: 'dupr', reseed: true, standings: 'winPct' } },
  { key: 'kingOfCourt', label: 'King of the Court (Claim the Throne)', blurb: 'After every game winners move up a court and losers down, splitting partners. Wins on higher courts score more.', options: { movement: 'game', standings: 'courtPoints', extras: 'rotate' } },
  { key: 'upDownRiver', label: 'Up & Down the River', blurb: 'Groups of 4 play 3 games; then the top 2 of each group move up a court and the bottom 2 move down.', options: { groups: 'fixed', movement: 'set', standings: 'winPct' } },
  { key: 'creamOfCrop', label: 'Cream of the Crop', blurb: 'Up & Down the River, starting from groups seeded by DUPR.', options: { groups: 'fixed', movement: 'set', seeding: 'dupr', standings: 'winPct' } },
  { key: 'shuffle', label: 'Shuffle (fixed partners)', blurb: 'Set pairs stay together all event and play a different pair each game.', options: { partners: 'fixed', standings: 'winPct' } },
  { key: 'rumble', label: 'Rumble', blurb: 'Fixed pairs, re-seeded every game: winning pairs meet winning pairs.', options: { partners: 'fixed', reseed: true, standings: 'winPct' } },
  { key: 'poolPlay', label: 'Pool play + playoffs', blurb: 'Fixed pairs play everyone in their pool of 4, then the top pairs play a bracket.', options: { partners: 'fixed', groups: 'fixed', standings: 'winPct', playoffs: 'single', playoffTeams: 4 } },
  { key: 'singles', label: 'Singles round robin', blurb: 'One against one, a different opponent each game.', options: { partners: 'singles', standings: 'winPct' } },
  { key: 'league', label: 'League night', blurb: 'A weekly series with season standings across sessions.', options: { repeat: 'weekly', standings: 'winPct' } },
  { key: 'ladder', label: 'Ladder', blurb: 'King of the Court each session; where you finish is where you start next time.', options: { repeat: 'ladder', movement: 'game', standings: 'courtPoints', extras: 'rotate' } },
  { key: 'clinic', label: 'Clinic / lesson', blurb: 'RSVPs only — no games are scheduled.', options: { games: 'none' } },
];

/* Options kept when switching format: the host's own lists. */
const KEEP = ['seedOrder', 'pairs', 'playoffTeams'];

export function formatOptions(ev, key) {
  const f = FORMATS.find(x => x.key === key) || FORMATS[0];
  const cur = eventOptions(ev);
  const kept = Object.fromEntries(KEEP.map(k => [k, cur[k]]));
  return { ...DEFAULT_OPTIONS, ...kept, ...f.options, format: f.key };
}
export function formatLabel(ev) {
  const o = eventOptions(ev);
  if (o.format === 'custom') return 'Custom';
  return (FORMATS.find(f => f.key === o.format) || FORMATS[0]).label;
}

export const SEEDING_MODES = [
  { key: 'off', label: 'Off' },
  { key: 'dupr', label: 'By DUPR rating' },
  { key: 'manual', label: 'Manual order' },
];
export const GROUP_MODES = [
  { key: 'off', label: 'Mix everyone' },
  { key: 'fixed', label: 'Groups of 4 for 3 games' },
];
export const MOVEMENT_MODES = [
  { key: 'none', label: 'None' },
  { key: 'game', label: 'After every game: winners up, losers down' },
  { key: 'set', label: 'After each group\'s 3 games: top 2 up, bottom 2 down' },
];
export const PARTNER_MODES = [
  { key: 'rotating', label: 'Rotating partners' },
  { key: 'fixed', label: 'Fixed pairs' },
  { key: 'singles', label: 'Singles' },
];
export const GAMES_MODES = [
  { key: 'scheduled', label: 'Scheduled games' },
  { key: 'none', label: 'No games (clinic / lesson)' },
];
export const EXTRAS_MODES = [
  { key: 'waitlist', label: 'Waitlist them' },
  { key: 'rotate', label: 'Everyone plays, sitting out in turns' },
];

/* Keeps combinations consistent: movement after each set needs groups, and
   groups can't move after every game (they stay together for their 3). */
export function normalizeOptions(o) {
  const out = { ...o };
  if (out.groups === 'fixed' && out.movement === 'game') out.movement = 'set';
  if (out.groups !== 'fixed' && out.movement === 'set') out.movement = 'game';
  if (out.playoffs === 'double' && out.playoffTeams < 4) out.playoffTeams = 4;
  if (out.playoffs !== 'none' && out.standings === 'off') out.standings = 'winPct';
  if ((out.reseed || out.movement !== 'none') && out.standings === 'off') out.standings = out.movement === 'game' ? 'courtPoints' : 'winPct';
  return out;
}

/* One line describing the options, for the Setup summary. */
export function describeOptions(ev) {
  const o = eventOptions(ev);
  if (o.games === 'none') return 'No games — RSVPs only.';
  const parts = [];
  parts.push(PARTNER_MODES.find(m => m.key === o.partners).label);
  if (o.seeding !== 'off') parts.push(`seeded ${o.seeding === 'dupr' ? 'by DUPR' : 'in your order'}`);
  if (o.reseed) parts.push('re-seeded every game');
  if (o.groups === 'fixed') parts.push('groups of 4');
  if (o.movement === 'game') parts.push('winners up / losers down every game');
  if (o.movement === 'set') parts.push('top 2 up / bottom 2 down after each set');
  if (o.extras === 'rotate') parts.push('extra players rotate in');
  if (o.playoffs !== 'none') parts.push(`${o.playoffs === 'double' ? 'double' : 'single'}-elimination playoffs (${o.playoffTeams} teams)`);
  if (o.repeat === 'weekly') parts.push('weekly series');
  if (o.repeat === 'ladder') parts.push('ladder');
  return parts.join(' · ');
}
