# Fencing Vault Mobile

Expo-managed React Native client for iOS and Android. It uses the same InstantDB app, Express auth
API, and video storage API as the web client.

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

Start the API from the repository root with `npm run dev:api`. You can then run the app from the
root with `npm run mobile`, `npm run mobile:ios`, or `npm run mobile:android`.

The app uses Expo's managed workflow. Do not generate or commit `ios/` or `android/` directories;
use EAS Build when native store binaries are needed.

## Checks

```bash
npm run typecheck
```
