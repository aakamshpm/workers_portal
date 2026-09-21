---
name: add-pwa
description: Add installable PWA support to the existing Vite React app. Use when the user asks for PWA, manifest, service worker, or install prompt. Not for React Native or Capacitor.
---

# add-pwa

Follow ADR-0005.

1. Write tests or a checklist script that the manifest is served and that officer routes do not show an install prompt.
2. Add `client/public/manifest.json` (name, icons, `display: standalone`, `start_url` by role is optional; default `/`).
3. Register a service worker that caches the app shell. Offline ledger writes are out of scope.
4. Show an install prompt only on worker and contractor routes.
5. Leaflet map, if added, is a separate component (`MapView.tsx`) using OSM tiles. No Google API key.

Do not add Capacitor or an Android project.
