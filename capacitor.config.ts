import type { CapacitorConfig } from '@capacitor/cli';

// Android app: the built web app (dist/) packaged with Capacitor.
// Build with:  npm run android:build   (see README → Android app)
const config: CapacitorConfig = {
  appId: 'com.fabtrainer.app',
  appName: 'FaB Trainer',
  webDir: 'dist',
  android: {
    // keep the game full-bleed and dark while it loads
    backgroundColor: '#14110f',
  },
};

export default config;
