import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SectionTitle, Card, Hint, Btn, Select, Checkbox, IconBtn, Pill, DuprChip, GenderDot } from '../lib/ui';
import { showAlert } from '../lib/confirm';
import { pushOnce } from '../lib/nav';
import { useAuth } from '../lib/auth';
import {
  useStore, setEventOption, applyFormat, seedList, moveSeed, pairPlayers, unpair, autoPair, playerName, playerGender,
  getPlayerById, nextSessionOf, scheduleNextSession, publishRoster,
} from '../lib/store';
import { eventOptions, getConfirmedAndWaitlist, playerCapacity } from '../lib/engine';
import { STANDINGS_MODES } from '../lib/standings';
import { PLAYOFF_TYPES, PLAYOFF_SIZES } from '../lib/playoffs';
import { REPEAT_MODES, seriesEvents } from '../lib/series';
import {
  FORMATS, SEEDING_MODES, GROUP_MODES, MOVEMENT_MODES, PARTNER_MODES, GAMES_MODES, EXTRAS_MODES, formatLabel, describeOptions,
} from '../lib/formats';
import { colors, radius } from '../lib/theme';

const items = list => list.map(m => ({ label: m.label, value: m.key, description: m.description }));
const STANDINGS_BLURB = {
  off: 'No standings — games are just for fun.',
  winPct: 'Ranked by the share of games won (sitting out never counts against anyone), then average point difference.',
  courtPoints: 'A win on a higher court is worth more (court 1 is the top court). Ties go to average point difference.',
};

/* Setup (edit mode): the format and the options it fills in. Every option
   defaults to the original round robin, so an event nobody touches works
   exactly as before. */
export function EventOptionsEditor({ ev }) {
  useStore(s => s.players); // pairs and seeds show names and ratings
  const o = eventOptions(ev);
  const fmt = FORMATS.find(f => f.key === o.format);
  const set = key => v => setEventOption(ev, key, v);
  const noGames = o.games === 'none';
  const movementItems = MOVEMENT_MODES.filter(m => m.key === 'none' || (o.groups === 'fixed' ? m.key === 'set' : m.key === 'game'));
  const sizes = PLAYOFF_SIZES.filter(s => o.playoffs !== 'double' || s >= 4);

  return (
    <View>
      <SectionTitle>Format & options</SectionTitle>
      <Card style={styles.stack}>
        <Select
          label="Format" value={o.format === 'custom' ? 'custom' : (fmt ? fmt.key : 'popcorn')}
          // Custom keeps the current options and lets you set each one below.
          onValueChange={(v) => { if (v === 'custom') setEventOption(ev, 'format', 'custom'); else applyFormat(ev, v); }}
          items={[
            ...FORMATS.map(f => ({ label: f.label, value: f.key, description: f.blurb, group: f.group })),
            { label: 'Custom', value: 'custom', description: 'Your own mix of the options — set each one below.', group: 'Custom' },
          ]}
        />
        <Hint style={styles.hint}>{fmt ? fmt.blurb : 'Your own mix of the options below.'} Picking a format fills in the options below; change any of them, or pick Custom, to set your own.</Hint>

        <Select label="Games" value={o.games} onValueChange={set('games')} items={items(GAMES_MODES)} />
        {noGames ? <Hint style={styles.hint}>Players RSVP as usual; there's no roster or rounds. Publish the event from the summary.</Hint> : (
          <>
            <Select label="Partners" value={o.partners} onValueChange={set('partners')} items={items(PARTNER_MODES)} />
            {o.partners === 'fixed' ? <PairsEditor ev={ev} /> : null}

            <Select label="Seeding — where the first round starts" value={o.seeding} onValueChange={set('seeding')} items={items(SEEDING_MODES)} />
            {o.seeding === 'dupr' ? <Hint style={styles.hint}>Best rating on court 1, playing 1 & 4 v 2 & 3. Players without a DUPR rating start at the bottom (ratings are on the Players tab).</Hint> : null}
            {o.seeding === 'manual' ? <SeedOrderEditor ev={ev} /> : null}
            <Checkbox label="Re-seed every round from the standings" checked={!!o.reseed} onChange={set('reseed')} />

            <Select label="Court groups" value={o.groups} onValueChange={set('groups')} items={items(GROUP_MODES)} />
            {o.groups === 'fixed' ? <Hint style={styles.hint}>{o.partners === 'rotating' ? 'Each group of 4 stays on its court for 3 games and plays every partner combination.' : (o.partners === 'singles' ? 'Players' : 'Pairs') + ' play in pools of 4–7, everyone in a pool playing each other once. Every free court is used each round, and whoever has sat out longest plays next.'}</Hint> : null}
            <Select label="Court movement" value={o.movement} onValueChange={set('movement')} items={items(movementItems)} />
            {o.movement !== 'none' ? <Hint style={styles.hint}>Court 1 is the top court. The next round is made once this round's scores are in — until then it shows as provisional.</Hint> : null}

            <Select label="Players beyond court capacity" value={o.extras} onValueChange={set('extras')} items={items(EXTRAS_MODES)} />
            <Select label="Standings" value={o.standings} onValueChange={set('standings')} items={items(STANDINGS_MODES)} />
            <Hint style={styles.hint}>{STANDINGS_BLURB[o.standings]} Scores are entered on the Rounds step, by you or by players for their own games.</Hint>

            <Select label="Playoffs" value={o.playoffs} onValueChange={set('playoffs')} items={items(PLAYOFF_TYPES)} />
            {o.playoffs !== 'none' ? (
              <>
                <Select label="Teams in the playoffs" value={o.playoffTeams} onValueChange={(v) => setEventOption(ev, 'playoffTeams', Number(v))} items={sizes.map(s => ({ label: String(s), value: s, description: `The top ${s} ${o.partners === 'singles' ? 'players' : 'teams'} play the bracket.` }))} />
                {o.playoffs === 'single' ? <Checkbox label="Play a 3rd-place match" checked={!!o.thirdPlace} onChange={set('thirdPlace')} /> : null}
                {o.repeat !== 'none' ? <Select label="Seed the playoffs from" value={o.playoffSeedFrom} onValueChange={set('playoffSeedFrom')} items={[
                  { label: "This session's standings", value: 'event', description: "Only this session's results decide the seeds." },
                  { label: 'Season standings', value: 'season', description: 'Results from every session in the series so far.' },
                ]} /> : null}
                <Hint style={styles.hint}>You start the playoffs from the Rounds step when pool play is done; rounds not yet played are dropped. {o.partners === 'rotating' ? 'With rotating partners, the top players are paired best with worst.' : ''}</Hint>
              </>
            ) : null}
          </>
        )}
        <Select label="Repeat" value={o.repeat} onValueChange={set('repeat')} items={items(REPEAT_MODES)} />
        {o.repeat !== 'none' ? <Hint style={styles.hint}>{o.repeat === 'ladder' ? 'Each session starts players where they finished the last one. ' : ''}Schedule each next session from the Setup summary; standings add up across the series.</Hint> : null}
      </Card>
    </View>
  );
}

/* Manual seeding: move players up or down; best first. */
function SeedOrderEditor({ ev }) {
  const list = seedList(ev);
  if (!list.length) return <Hint style={styles.hint}>Players appear here once they RSVP.</Hint>;
  return (
    <View style={styles.listBox}>
      {list.map((id, i) => (
        <View key={id} style={styles.listRow}>
          <Text style={styles.seedNo}>{i + 1}</Text>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{playerName(id)}</Text>
            <DuprChip dupr={(getPlayerById(id) || {}).dupr} />
          </View>
          <IconBtn icon="chevron-up" label={`Move ${playerName(id)} up`} onPress={() => moveSeed(ev, id, -1)} />
          <IconBtn icon="chevron-down" label={`Move ${playerName(id)} down`} onPress={() => moveSeed(ev, id, 1)} />
        </View>
      ))}
    </View>
  );
}

/* Fixed pairs: tap two unpaired players to pair them. Anyone left
   unpaired on the day is paired in RSVP order. */
function PairsEditor({ ev }) {
  const [picked, setPicked] = React.useState(null);
  const players = useStore(s => s.players);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const coming = [...confirmed, ...waitlist];
  const pairs = eventOptions(ev).pairs || [];
  const paired = new Set(pairs.flat());
  const loose = coming.filter(id => !paired.has(id));
  function tap(id) {
    if (!picked) { setPicked(id); return; }
    if (picked !== id) pairPlayers(ev, picked, id);
    setPicked(null);
  }
  return (
    <View style={styles.listBox}>
      <Text style={styles.smallLabel}>Pairs ({pairs.length})</Text>
      {pairs.length === 0 ? <Hint style={styles.hint}>No pairs yet.</Hint> : pairs.map((p, i) => (
        <View key={p.join('+')} style={styles.listRow}>
          <View style={styles.nameRow}>
            {p.map((id, j) => (
              <React.Fragment key={id}>
                {j ? <Text style={styles.amp}>&</Text> : null}
                <Text style={styles.name} numberOfLines={1}>{playerName(id)}</Text>
                <GenderDot gender={playerGender(id)} size={12} />
              </React.Fragment>
            ))}
            {p.some(id => !coming.includes(id)) ? <Text style={styles.warn}>not coming</Text> : null}
          </View>
          <IconBtn icon="close" danger label={`Split ${p.map(playerName).join(' and ')}`} onPress={() => unpair(ev, i)} />
        </View>
      ))}
      {loose.length ? (
        <>
          <Text style={[styles.smallLabel, { marginTop: 8 }]}>{picked ? `Pair ${playerName(picked)} with…` : 'Not paired yet — tap two to pair them'}</Text>
          <View style={styles.chips}>
            {loose.map(id => <Pill key={id} label={playerName(id)} accessibilityLabel={`Pair ${playerName(id)}`} active={picked === id} onPress={() => tap(id)} />)}
          </View>
        </>
      ) : null}
      <View style={styles.actions}>
        <Btn title="Auto-pair by DUPR" variant="outline" small onPress={() => autoPair(ev, 'balanced')} disabled={loose.length < 2} />
        <Btn title="Pair in RSVP order" variant="ghost" small onPress={() => autoPair(ev, 'rsvp')} disabled={loose.length < 2} />
      </View>
      <Hint style={styles.hint}>"Auto-pair by DUPR" pairs the highest rating with the lowest for even teams. Anyone still unpaired on the day is paired in RSVP order.</Hint>
    </View>
  );
}

/* Setup (read-only): the format, what it means, and the series and clinic
   actions. */
export function EventOptionsSummary({ ev, canEdit }) {
  const router = useRouter();
  const { player: me } = useAuth();
  const meId = me ? me.id : null;
  const events = useStore(s => s.events);
  const o = eventOptions(ev);
  const next = o.repeat !== 'none' ? nextSessionOf(ev) : null;
  const series = o.repeat !== 'none' ? seriesEvents(events, ev.seriesId || ev.id) : [];
  const cap = playerCapacity(ev);
  const rows = [
    ['Format', formatLabel(ev)],
    ['How it plays', describeOptions(ev)],
    ['Standings', (STANDINGS_MODES.find(m => m.key === o.standings) || STANDINGS_MODES[0]).label],
    ['Capacity', cap === Infinity ? 'No limit — extra players sit out in turns' : `${cap} players`],
  ];
  if (o.repeat !== 'none') rows.push(['Series', `Session ${Math.max(1, series.findIndex(e => e.id === ev.id) + 1)} of ${Math.max(1, series.length)}`]);
  if (next) rows.push(['Next session', next.date]);

  function schedule() {
    const n = scheduleNextSession(ev, meId);
    showAlert(`Next session scheduled for ${n.date}. Open it from the Events tab to publish it and collect RSVPs.`);
  }
  return (
    <View>
      <SectionTitle>Format</SectionTitle>
      <Card>
        {rows.map(([label, value], i) => (
          <View key={label} style={[styles.infoRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue}>{value}</Text>
          </View>
        ))}
        {canEdit && o.games === 'none' && !ev.published ? (
          <Btn title="Publish event" icon="megaphone-outline" onPress={() => publishRoster(ev)} style={styles.action} />
        ) : null}
        {canEdit && o.repeat !== 'none' && !next ? (
          <Btn title="Schedule next session" icon="calendar-outline" variant="outline" small onPress={schedule} style={styles.action} />
        ) : null}
        {next ? <Btn title="Open next session" icon="arrow-forward" variant="ghost" small onPress={() => pushOnce(router, { pathname: '/event/[id]', params: { id: next.id } })} style={styles.action} /> : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  hint: { marginTop: -4 },
  listBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 10, gap: 2, backgroundColor: colors.white },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line },
  seedNo: { width: 22, textAlign: 'center', fontWeight: '700', color: colors.court },
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' },
  name: { fontSize: 13.5, color: colors.ink, flexShrink: 1 },
  amp: { color: colors.slate, fontSize: 12 },
  warn: { fontSize: 11, color: colors.clay, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' },
  smallLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { fontSize: 12.5, color: colors.slate, fontWeight: '600' },
  infoValue: { fontSize: 13.5, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  action: { alignSelf: 'flex-end', marginTop: 10 },
});
