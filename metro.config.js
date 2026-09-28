// Expo's default Metro config, plus folders Metro must not watch: the
// browser tests' web build and packages (e2e/), and the backends' own
// local state and packages. Metro crashed crawling e2e/web's exported
// assets, and none of these are part of the app.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const ignore = [
  /[\\/]e2e[\\/].*/,
  /[\\/]backend-worker[\\/].*/,
  /[\\/]backend[\\/].*/,
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...ignore];

module.exports = config;
