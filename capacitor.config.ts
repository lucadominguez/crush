import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.a0b29d2bb63e48bc82506331b651ad2b',
  appName: 'Crush',
  webDir: 'dist',
  server: {
    // Points the native shell at your live Lovable preview so server functions,
    // auth, realtime, and DB all keep working without rebuilding.
    // Swap this to your published URL (e.g. https://project--<id>.lovable.app)
    // when you ship to the App Store / Play Store.
    url: 'https://id-preview--a0b29d2b-b63e-48bc-8250-6331b651ad2b.lovable.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
