/* The event wizard's swipeable pager (native only). The web build gets
   StepPager.web.js instead: react-native-pager-view imports React Native
   internals that don't exist on web, which broke the web bundle even
   though the web screen never renders a pager. */
export { default } from 'react-native-pager-view';
