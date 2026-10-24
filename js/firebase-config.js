/*
 * World leaderboards: paste your Firebase web config here to switch them on.
 * Until then the game works as before, with leaderboards on this device only.
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
window.BEAT_FRETS_FIREBASE = null;
