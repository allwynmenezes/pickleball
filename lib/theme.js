/* Same Payzy-inspired palette as the web app, as plain color strings for
   React Native StyleSheet (no CSS variables in RN). */
export const colors = {
  court: '#6200EA',
  courtDeep: '#3D0091',
  courtTint: '#F4EEFE',
  chalk: '#FBF9FE',
  card: '#FFFFFF',
  ink: '#1A0F2E',
  slate: '#6B6478',
  ball: '#36FFC6',
  ballTint: '#E7FDF7',
  ballText: '#0E8074',
  clay: '#E23D5B',
  clayDeep: '#B22B47',
  clayTint: '#FDE6EA',
  clayText: '#7A1128',
  line: '#E7DFF7',
  male: '#2A5DAA',
  maleTint: '#E6EEF8',
  female: '#B23670',
  femaleTint: '#F7E3EC',
  otherTint: '#EDEBE3',
  white: '#FFFFFF',
};

export const radius = { md: 10, sm: 7 };

export function genderColor(g) {
  return g === 'M' ? colors.male : g === 'F' ? colors.female : colors.slate;
}
export function genderTint(g) {
  return g === 'M' ? colors.maleTint : g === 'F' ? colors.femaleTint : colors.otherTint;
}
