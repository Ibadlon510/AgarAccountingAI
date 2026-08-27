import * as SecureStore from 'expo-secure-store';
import type { TokenCache } from '@clerk/clerk-expo';

// Clerk's session token lives in the OS keychain via expo-secure-store,
// mirroring how the web app leaves session handling to the browser's own
// cookie jar — neither app rolls its own token storage.
export const tokenCache: TokenCache = {
  async getToken(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Keychain unavailable (e.g. simulator without a passcode) — the
      // session just won't persist across app restarts.
    }
  },
};
