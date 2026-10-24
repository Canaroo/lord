/*
 * World leaderboards: the Firebase web config for the "beat-frets" project.
 * Set it to null to switch world boards off (leaderboards stay on this device).
 *
 * In the Firebase console: Project settings → Your apps → Web app → Config.
 * Also turn on Authentication → Sign-in method → Anonymous, and publish the
 * rules in firestore.rules (see the README, "World leaderboards").
 *
 * window.BEAT_FRETS_FIREBASE = {
 *   apiKey: '…',
 *   authDomain: '….firebaseapp.com',
 *   projectId: '…',
 *   storageBucket: '….appspot.com',
 *   messagingSenderId: '…',
 *   appId: '…',
 * };
 */
window.BEAT_FRETS_FIREBASE = {
  apiKey: 'AIzaSyCWTWhI0TzEYxLjYegIMf85W1k_98AnMQs',
  authDomain: 'beat-frets.firebaseapp.com',
  projectId: 'beat-frets',
  storageBucket: 'beat-frets.firebasestorage.app',
  messagingSenderId: '315986848448',
  appId: '1:315986848448:web:945d5254fb663609b09b25',
};
