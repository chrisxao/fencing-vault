# Fencing Vault Mobile

Expo-managed React Native client for iOS and Android. It uses the same InstantDB app, Express auth
API, and video storage API as the web client.

Upload and playback calls send the current Instant bearer token. A presigned upload is finalized
through Express so S3 can verify its declared MIME type and byte length; the server-side
`MEDIA_MAX_UPLOAD_BYTES` limit applies to native uploads too.

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Set `EXPO_PUBLIC_INSTANT_APP_ID` to the same public app ID as `VITE_INSTANT_APP_ID`. Set
`EXPO_PUBLIC_API_URL` to a reachable Express API origin:

- iOS simulator: `http://127.0.0.1:8787`
- Android emulator: `http://10.0.2.2:8787`
- Physical device: your computer's LAN URL, such as `http://192.168.1.20:8787`
- Production: the HTTPS origin of the deployed API

From the repository root, use `npm run dev:mobile`, `npm run dev:mobile:ios`, or
`npm run dev:mobile:android` to start Express and Expo together. The `npm run mobile*` commands
start only Expo; when using one of those, run `npm run dev:api` in another terminal.

Expo loads `EXPO_PUBLIC_*` values when Metro starts. Restart Metro after creating or changing
`mobile/.env`.

The app uses Expo's managed workflow. Do not generate or commit `ios/` or `android/` directories;
use EAS Build when native store binaries are needed.

## Checks

```bash
npm run typecheck
```
