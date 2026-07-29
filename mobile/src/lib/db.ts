import 'react-native-get-random-values';
import { init } from '@instantdb/react-native';
import schema from './schema';

export const instantAppId = process.env.EXPO_PUBLIC_INSTANT_APP_ID?.trim() ?? '';
export const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL?.trim() ?? '').replace(/\/$/, '');

// Keep initialization stable so the app can render a useful configuration
// message instead of crashing before React mounts.
const fallbackAppId = '00000000-0000-0000-0000-000000000000';

export const db = init({
  appId: instantAppId || fallbackAppId,
  schema,
});
