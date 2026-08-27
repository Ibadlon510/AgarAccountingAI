import { QueryClient } from '@tanstack/react-query';
import { setBaseUrl } from '@workspace/api-client-react';

// The web app calls the API with relative paths because it's served from
// the same origin. A native app has no "origin" to share, so every request
// needs an absolute base URL — set via EXPO_PUBLIC_API_BASE_URL so it can
// point at a local dev server, a staging API, or production per build.
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
if (!apiBaseUrl) {
  throw new Error('EXPO_PUBLIC_API_BASE_URL is required (see .env.example).');
}
setBaseUrl(apiBaseUrl.replace(/\/+$/, '') + '/api');

export const queryClient = new QueryClient();
