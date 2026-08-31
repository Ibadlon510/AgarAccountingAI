import * as SecureStore from 'expo-secure-store';

// Small, non-secret preferences (currently just the chosen workspace).
// expo-secure-store is used rather than AsyncStorage purely because it is
// already a dependency for Clerk's token cache — a client id is not a secret,
// but it is tiny and this avoids adding a storage library for one value.
// Every call is best-effort: losing a preference must never break the app.
export async function readPref(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writePref(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Storage unavailable — the choice just won't survive a restart.
  }
}

export const ACTIVE_CLIENT_KEY = 'activeClientId';
