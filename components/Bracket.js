import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { SectionTitle, Card, Hint, GenderDot, Banner } from '../lib/ui';
import { playerName, playerGender, setPlayoffScore, courtLabel } from '../lib/store';
import { resolvePlayoffs, playoffCourts, isPlayoffMatchDone, playoffMatchLocked } from '../lib/playoffs';
import { colors, radius } from '../lib/theme';

const STAGES = [['W', null], ['L', "Losers' bracket"], ['3', null], ['F', null]];

/* The playoff bracket (lib/playoffs.js) on the Rounds step: every match in
   order, the court each ready match is on, and score entry — the host for
   any match, players for their own. */
export default function Bracket({ ev, canEdit, meId }) {
  // Worked out on a copy: rendering never changes the event.
  const p = JSON.parse(JSON.stringify(ev.playoffs));
  const { champion, runnerUp, third } = resolvePlayoffs(p);
  const courts = playoffCourts(p, ev.courts);
  const byId = new Map(p.matches.map(m => [m.id, m]));
  const teamName = t => t.map(playerName).join(' & ');
  const sourceLabel = src => (src.seed ? `Seed ${src.seed}`
    : `${src.winnerOf ? 'Winner' : 'Loser'} of ${(byId.get(src.winnerOf || src.loserOf) || {}).label || '?'}`);

  return (
    <View>
      <SectionTitle>Playoffs · {p.type === 'double' ? 'double' : 'single'} elimination</SectionTitle>
      {champion ? (
        <Banner kind="info">🏆 Champions: {teamName(champion)}{runnerUp ? ` · Runners-up: ${teamName(runnerUp)}` : ''}{third ? ` · 3rd: ${teamName(third)}` : ''}</Banner>
      ) : null}
      <Card lift>
        <Text style={styles.seeds}>Seeds: {p.teams.map((t, i) => `${i + 1}. ${teamName(t)}`).join('   ')}</Text>
        {STAGES.map(([stage, title]) => {
          const ms = p.matches.filter(m => m.stage === stage);
          if (!ms.length) return null;
          return (
            <View key={stage}>
              {title ? <Text style={styles.stage}>{title}</Text> : null}
              {ms.map(m => {
                const done = isPlayoffMatchDone(m);
                const ready = m.teamA && m.teamB;
                const court = courts.get(m.id);
                const mine = !!meId && ready && [...m.teamA, ...m.teamB].includes(meId);
                const editable = ready && (canEdit || mine) && !playoffMatchLocked(p, m.id);
                const status = done ? 'Final' : !ready ? 'Waiting for earlier results' : court ? courtLabel(ev, court) : 'Waiting for a court';
                return (
                  <View key={m.id} style={[styles.match, court && !done && styles.matchLive]}>
                    <View style={styles.head}>
                      <Text style={styles.label}>{m.label}</Text>
                      <Text style={[styles.status, court && !done && styles.statusLive]}>{status}</Text>
                    </View>
                    {[['A', m.teamA, m.a, m.scoreA], ['B', m.teamB, m.b, m.scoreB]].map(([side, team, src, score]) => {
                      const won = done && (side === 'A' ? m.scoreA > m.scoreB : m.scoreB > m.scoreA);
                      return (
                        <View key={side} style={styles.teamRow}>
                          <View style={styles.names}>
                            {team ? team.map(id => (
                              <View key={id} style={styles.nameItem}>
                                <Text style={[styles.name, won && styles.won]}>{playerName(id)}</Text>
                                <GenderDot gender={playerGender(id)} size={14} />
                              </View>
                            )) : <Text style={styles.tbd}>{sourceLabel(src)}</Text>}
                          </View>
                          <TextInput
                            keyboardType="number-pad" editable={!!editable}
                            style={[styles.score, !editable && styles.scoreOff]}
                            value={score == null ? '' : String(score)} placeholder="–" placeholderTextColor={colors.slate}
                            accessibilityLabel={`${m.label} score for ${team ? teamName(team).replace(/ & /g, ' and ') : sourceLabel(src)}`}
                            onChangeText={(v) => setPlayoffScore(ev, m.id, side, v)}
                          />
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          );
        })}
        <Hint>{p.type === 'double' ? 'A team is out after its second loss. The grand final is one game.' : 'Lose once and you\'re out.'} A result is fixed once the next match that depends on it has a score.</Hint>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  seeds: { fontSize: 12, color: colors.slate, marginBottom: 6 },
  stage: { fontSize: 12, fontWeight: '700', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
  match: { paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4, borderRadius: radius.sm },
  matchLive: { backgroundColor: colors.courtTint },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: { fontWeight: '700', fontSize: 13, color: colors.ink },
  status: { fontSize: 12, color: colors.slate },
  statusLive: { color: colors.court, fontWeight: '700' },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  names: { flex: 1, gap: 2 },
  nameItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontSize: 13, color: colors.ink },
  won: { fontWeight: '700' },
  tbd: { fontSize: 12.5, color: colors.slate, fontStyle: 'italic' },
  score: { width: 40, textAlign: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 4, fontWeight: '700', color: colors.ink, backgroundColor: colors.white },
  scoreOff: { backgroundColor: colors.chalk, color: colors.slate },
});
