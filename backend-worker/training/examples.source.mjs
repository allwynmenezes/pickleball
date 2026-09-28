/* Example messages and the JSON the model should return for each, for
   review and then as few-shot examples and an accuracy gate (see
   README.md). Only the fields that matter are listed here; build.mjs fills
   in the rest with the "not mentioned" values ("" / 0 / [] / false), runs
   each through the app's real code to show what the event would end up
   as, and writes examples.json.

   Everything is relative to NOW: Saturday 26 Sep 2026, 10:00 at UTC-4.
   Players are made up (the group for these examples is PLAYERS below). */

export const NOW = { now: '2026-09-26T10:00:00-04:00', tzOffsetMin: -240, label: 'Saturday 26 Sep 2026, 10:00am (UTC−4)' };

export const PLAYERS = ['Priya Shah', 'Sam Lee', 'Ben Ortiz', 'Cleo Park', 'Dev Rao', 'Fay Adams', 'Gus Kim', 'Hana Ito', 'Ivan Cruz', 'Jo Moss', 'Kai Reed', 'Lena Hart']
  .map((name, i) => ({ id: `p${i + 1}`, name }));

/* The event the edit examples start from. */
export const BASE_EVENT = {
  name: 'Tuesday Night', date: '2026-09-29', startTime: '18:00', durationMin: 180, courts: 2, gameLenMin: 15,
  segments: [{ start: '18:00', end: '21:00', modes: {} }], memberIds: ['p1', 'p2', 'p3', 'p4'],
};

/* The interpretation rules the examples follow — approve these too. */
export const CONVENTIONS = [
  { id: 'C1', text: '"next Tuesday" is the coming Tuesday (29 Sep from Sat 26 Sep); "this Friday" is 2 Oct; "tomorrow" is 27 Sep.' },
  { id: 'C2', text: 'An hour from 1 to 7 without am/pm means the evening (6:30 → 6:30pm).' },
  { id: 'C3', text: 'No start time given → 6pm (the app default). No length or end given → 4 hours (the app default).' },
  { id: 'C4', text: 'Courts not stated → players ÷ 4, rounded down (8 → 2, 10 → 2, 12 → 3). Court numbers count as courts ("courts 3 and 4" → 2).' },
  { id: 'C5', text: '"One court X, the other Y" → court 1 is X, court 2 is Y, for the whole event unless a time is given.' },
  { id: 'C6', text: '"A break every hour" → breaks start on the hour (7:00, 8:00, 9:00 for 6–10pm); play time is shortened, not moved. No break at the start or end.' },
  { id: 'C7', text: '"A break after every hour of play" → a full hour of play, then the break, then the next hour of play (7:00, 8:10, 9:20 with 10-minute breaks for 6–10pm).' },
  { id: 'C8', text: 'A break stops games on every court unless a court is named. Any time not described is open play (any combination).' },
  { id: 'C9', text: 'Speech-to-text often hears "courts" as "codes" or "cords"; they mean courts.' },
  { id: 'C10', text: 'In an edit, only what the message changes is returned; the rest stays as it is. A new play format must cover the whole event, keeping the parts the message doesn\'t mention.' },
];

const seg = (start, end, mode, courtModes = []) => ({ start, end, mode, courtModes });
const c = (court, mode) => ({ court, mode });

export const EXAMPLES = [
  // ---- New events: date, time, length ----
  { id: 'N01', kind: 'create', category: 'Date & time', text: 'Next Tuesday 6 to 9pm, 3 courts', expect: { date: '2026-09-29', startTime: '18:00', endTime: '21:00', courts: 3 } },
  { id: 'N02', kind: 'create', category: 'Date & time', text: 'Tomorrow 7pm for 3 hours', expect: { date: '2026-09-27', startTime: '19:00', durationMin: 180 } },
  { id: 'N03', kind: 'create', category: 'Date & time', text: 'Friday night 6:30 till 9', expect: { date: '2026-10-02', startTime: '18:30', endTime: '21:00' } },
  { id: 'N04', kind: 'create', category: 'Date & time', text: 'Sunday morning 8 to 11, two courts', expect: { date: '2026-09-27', startTime: '08:00', endTime: '11:00', courts: 2 } },
  { id: 'N05', kind: 'create', category: 'Date & time', text: 'Saturday October 10th, 9am to noon', expect: { date: '2026-10-10', startTime: '09:00', endTime: '12:00' } },

  // ---- New events: courts and players ----
  { id: 'N06', kind: 'create', category: 'Courts & players', text: 'Next Thursday 6 to 10pm with 8 players', expect: { date: '2026-10-01', startTime: '18:00', endTime: '22:00', playerCount: 8 } },
  { id: 'N07', kind: 'create', category: 'Courts & players', text: 'Wednesday 7 to 9, twelve of us', expect: { date: '2026-09-30', startTime: '19:00', endTime: '21:00', playerCount: 12 } },
  { id: 'N08', kind: 'create', category: 'Courts & players', text: 'Tuesday 6pm on courts 3 and 4 for 2 hours', expect: { date: '2026-09-29', startTime: '18:00', durationMin: 120, courts: 2 } },
  { id: 'N09', kind: 'create', category: 'Courts & players', text: 'Monday 6 to 8pm, invite everyone', expect: { date: '2026-09-28', startTime: '18:00', endTime: '20:00', inviteEveryone: true } },
  { id: 'N10', kind: 'create', category: 'Courts & players', text: 'Friday 6 to 9 with Priya, Sam, Ben, Cleo, Dev, Fay, Gus and Hana', expect: { date: '2026-10-02', startTime: '18:00', endTime: '21:00', playerNames: ['Priya', 'Sam', 'Ben', 'Cleo', 'Dev', 'Fay', 'Gus', 'Hana'] } },

  // ---- New events: game length ----
  { id: 'N11', kind: 'create', category: 'Game length', text: 'Tuesday 6 to 9pm, 20 minute games', expect: { date: '2026-09-29', startTime: '18:00', endTime: '21:00', gameLenMin: 20 } },
  { id: 'N12', kind: 'create', category: 'Game length', text: 'Thursday 7pm for 2 hours, game length 12 minutes each', expect: { date: '2026-10-01', startTime: '19:00', durationMin: 120, gameLenMin: 12 } },

  // ---- New events: modes per court ----
  { id: 'N13', kind: 'create', category: 'Modes per court', text: 'Saturday 6 to 9pm, 2 courts, court 1 mixed and court 2 any combination',
    expect: { date: '2026-09-26', startTime: '18:00', endTime: '21:00', courts: 2, segments: [seg('18:00', '21:00', 'open', [c(1, 'mixed')])] } },
  { id: 'N14', kind: 'create', category: 'Modes per court', text: "Sunday 4 to 7pm, 3 courts: court 1 men's, court 2 women's, court 3 mixed",
    expect: { date: '2026-09-27', startTime: '16:00', endTime: '19:00', courts: 3, segments: [seg('16:00', '19:00', 'open', [c(1, 'men'), c(2, 'women'), c(3, 'mixed')])] } },
  { id: 'N15', kind: 'create', category: 'Modes per court', text: 'Friday 6 to 9, 3 courts. First hour court 1 mixed, court 2 mens and court 3 womens. Second hour all mixed. Last hour open',
    expect: { date: '2026-10-02', startTime: '18:00', endTime: '21:00', courts: 3, segments: [seg('18:00', '19:00', 'open', [c(1, 'mixed'), c(2, 'men'), c(3, 'women')]), seg('19:00', '20:00', 'mixed'), seg('20:00', '21:00', 'open')] } },
  { id: 'N16', kind: 'create', category: 'Modes per court', text: "Tuesday 6-10pm, 2 courts, court 1 women's doubles the whole time, court 2 open",
    expect: { date: '2026-09-29', startTime: '18:00', endTime: '22:00', courts: 2, segments: [seg('18:00', '22:00', 'open', [c(1, 'women')])] } },
  { id: 'N17', kind: 'create', category: 'Modes per court', text: 'Thursday 6 to 8pm, 2 courts, mixed doubles for the first hour then open play on both',
    expect: { date: '2026-10-01', startTime: '18:00', endTime: '20:00', courts: 2, segments: [seg('18:00', '19:00', 'mixed'), seg('19:00', '20:00', 'open')] } },

  // ---- New events: breaks ----
  { id: 'N18', kind: 'create', category: 'Breaks', text: 'Saturday 6 to 10pm, 2 courts, 15 minute break every hour', convention: 'C6',
    expect: { date: '2026-09-26', startTime: '18:00', endTime: '22:00', courts: 2, segments: [seg('19:00', '19:15', 'break'), seg('20:00', '20:15', 'break'), seg('21:00', '21:15', 'break')] } },
  { id: 'N19', kind: 'create', category: 'Breaks', text: 'Wednesday 6 to 10pm, 2 courts, 10 minute break after every hour of play', convention: 'C7',
    expect: { date: '2026-09-30', startTime: '18:00', endTime: '22:00', courts: 2, segments: [seg('19:00', '19:10', 'break'), seg('20:10', '20:20', 'break'), seg('21:20', '21:30', 'break')] } },
  { id: 'N20', kind: 'create', category: 'Breaks', text: 'Friday 7 to 10pm, a 30 minute break at 8:30',
    expect: { date: '2026-10-02', startTime: '19:00', endTime: '22:00', segments: [seg('20:30', '21:00', 'break')] } },
  { id: 'N21', kind: 'create', category: 'Breaks', text: 'Sunday 2 to 5pm, 2 courts, court 1 mixed and court 2 open, with a 15 minute break at 3:30',
    expect: { date: '2026-09-27', startTime: '14:00', endTime: '17:00', courts: 2, segments: [seg('14:00', '15:30', 'open', [c(1, 'mixed')]), seg('15:30', '15:45', 'break'), seg('15:45', '17:00', 'open', [c(1, 'mixed')])] } },
  { id: 'N22', kind: 'create', category: 'Breaks', text: "Tuesday 6 to 9pm, men's doubles for an hour, then a 15 minute break, then mixed",
    expect: { date: '2026-09-29', startTime: '18:00', endTime: '21:00', segments: [seg('18:00', '19:00', 'men'), seg('19:00', '19:15', 'break'), seg('19:15', '21:00', 'mixed')] } },

  // ---- New events: long, spoken descriptions (like the ones used in testing) ----
  { id: 'N23', kind: 'create', category: 'Long spoken descriptions', convention: 'C3, C5',
    text: 'Create a game for next Wednesday with eight players and the game spanning for a period of four hours. There are Priya, Sam, Ben, Cleo, Dev, Fay, Gus and Hana. Each game will be 15 minutes long. Make one of the courts to have mixed game and the other court could be of any combination.',
    expect: { date: '2026-09-30', durationMin: 240, playerCount: 8, gameLenMin: 15, playerNames: ['Priya', 'Sam', 'Ben', 'Cleo', 'Dev', 'Fay', 'Gus', 'Hana'], segments: [seg('18:00', '22:00', 'open', [c(1, 'mixed')])] } },
  { id: 'N24', kind: 'create', category: 'Long spoken descriptions', convention: 'C3, C5, C7',
    text: 'Create a new event for next Thursday. The event will span for a duration of four hours and will consist of eight players. It will have Priya, Sam, Ben, Cleo, Dev, Fay, Gus and Hana. The games will go on for one hour and after one hour there will be a break of ten minutes and this will continue till the end of the event. Every game segment will have two game modes. One court will have a mixed game and the other will have any combination.',
    expect: { date: '2026-10-01', durationMin: 240, playerCount: 8, playerNames: ['Priya', 'Sam', 'Ben', 'Cleo', 'Dev', 'Fay', 'Gus', 'Hana'],
      segments: [seg('18:00', '19:00', 'open', [c(1, 'mixed')]), seg('19:00', '19:10', 'break'), seg('19:10', '20:10', 'open', [c(1, 'mixed')]), seg('20:10', '20:20', 'break'), seg('20:20', '21:20', 'open', [c(1, 'mixed')]), seg('21:20', '21:30', 'break'), seg('21:30', '22:00', 'open', [c(1, 'mixed')])] } },
  { id: 'N25', kind: 'create', category: 'Long spoken descriptions', convention: 'C9',
    text: 'Next Wednesday for four hours with eight players. Make one of the codes mixed and the other code any combination.',
    expect: { date: '2026-09-30', durationMin: 240, playerCount: 8, segments: [seg('18:00', '22:00', 'open', [c(1, 'mixed')])] } },
  { id: 'N26', kind: 'create', category: 'Long spoken descriptions', text: 'Ladder night next Friday from 6:30 to 9:30pm, 5 courts, 12 minute games, everyone invited',
    expect: { name: 'Ladder Night', date: '2026-10-02', startTime: '18:30', endTime: '21:30', courts: 5, gameLenMin: 12, inviteEveryone: true } },

  // ---- Not events ----
  { id: 'N27', kind: 'create', category: 'Not an event', text: "What's the weather like tomorrow?", expect: { isEvent: false } },
  { id: 'N28', kind: 'create', category: 'Not an event', text: 'Remind me to buy new paddles', expect: { isEvent: false } },
  { id: 'N29', kind: 'create', category: 'Not an event', text: 'Great game everyone!', expect: { isEvent: false } },

  // ---- Edits (starting from BASE_EVENT: Tue 29 Sep, 6–9pm, 2 courts, 15-min games, open play, Priya/Sam/Ben/Cleo) ----
  { id: 'E01', kind: 'edit', category: 'Time & date', text: 'Move it to 7pm', expect: { startTime: '19:00' } },
  { id: 'E02', kind: 'edit', category: 'Time & date', text: 'Push it back an hour', expect: { startTime: '19:00' } },
  { id: 'E03', kind: 'edit', category: 'Time & date', text: 'End at 10', expect: { endTime: '22:00' } },
  { id: 'E04', kind: 'edit', category: 'Time & date', text: 'Move it to Thursday', expect: { date: '2026-10-01' } },
  { id: 'E05', kind: 'edit', category: 'Courts & games', text: 'Add a court', expect: { courts: 3 } },
  { id: 'E06', kind: 'edit', category: 'Courts & games', text: 'Can you update the game length to be 20mins each?', expect: { gameLenMin: 20 } },
  { id: 'E07', kind: 'edit', category: 'Play format', text: 'Make court 1 mixed doubles for the whole evening', convention: 'C10',
    expect: { segments: [seg('18:00', '21:00', 'open', [c(1, 'mixed')])] } },
  { id: 'E08', kind: 'edit', category: 'Play format', text: 'Mixed for the last hour', convention: 'C10',
    expect: { segments: [seg('18:00', '20:00', 'open'), seg('20:00', '21:00', 'mixed')] } },
  { id: 'E09', kind: 'edit', category: 'Breaks', text: 'Add a 10 minute break at 7:30', convention: 'C10',
    expect: { segments: [seg('18:00', '19:30', 'open'), seg('19:30', '19:40', 'break'), seg('19:40', '21:00', 'open')] } },
  { id: 'E10', kind: 'edit', category: 'Breaks', text: 'A 10 minute break after every hour of play', convention: 'C7',
    expect: { segments: [seg('18:00', '19:00', 'open'), seg('19:00', '19:10', 'break'), seg('19:10', '20:10', 'open'), seg('20:10', '20:20', 'break'), seg('20:20', '21:00', 'open')] } },
  { id: 'E11', kind: 'edit', category: 'Players', text: 'Add Dev and Fay, remove Sam', expect: { addPlayers: ['Dev', 'Fay'], removePlayers: ['Sam'] } },
  { id: 'E12', kind: 'edit', category: 'Name', text: 'Rename it to Ladder Night', expect: { name: 'Ladder Night' } },
  { id: 'E13', kind: 'edit', category: 'Play format', text: "Also make court 2 men's for the first hour", convention: 'C10',
    context: { segments: [{ start: '18:00', end: '21:00', modes: { 1: 'mixed' } }] },
    expect: { segments: [seg('18:00', '19:00', 'open', [c(1, 'mixed'), c(2, 'men')]), seg('19:00', '21:00', 'open', [c(1, 'mixed')])] } },
  { id: 'E14', kind: 'edit', category: 'Not a change', text: 'Thanks, looks good!', expect: { understood: false } },
];
