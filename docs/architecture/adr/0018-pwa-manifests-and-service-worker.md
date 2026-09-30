# ADR-0018: PWA manifests, service worker and install button

## Status

Accepted. Carries out ADR-0005 within the three apps of ADR-0012.

## Context

ADR-0005 chose a PWA over a native app, and ADR-0012 said the worker and contractor apps each get their own manifest, and the officer app none. The details were left for the PWA step: which files, what the service worker keeps, and where the install button appears.

A worker's phone is often shared, cheap and offline for part of the day. His records are money records.

## Decision

- **One manifest per installable app:** `client/public/worker/manifest.webmanifest` and `client/public/contractor/manifest.webmanifest`. For each, `id`, `start_url` and `scope` are the app's own address, so an installed worker app never opens the contractor or officer app inside itself. `display: standalone`. Icons are PNG, 192 px and 512 px, plus one maskable 512 px, with the SVG source next to them.
- **The officer app has no manifest and no service worker** (ADR-0012). A test checks both.
- **A service worker we write ourselves, no plugin.** `public/<app>/sw.js` loads the shared `public/sw-core.js`, so its scope is the app's own folder. No new dependency.
- **What it keeps:** the app's page and the files that page loads (scripts, styles, icons). A page opens from the network first and from the cache only when there is no network, so an online reader always gets the newest version. Hashed build files are served from the cache, because their name changes with their content.
- **What it never keeps: anything under `/api/`.** Those requests pass straight to the network. A saved balance could be old and show the wrong amount owed, and on a shared phone it would stay readable after sign-out. Offline, the app opens and each page shows its usual "could not load" message.
- **Per-app cache names** (`worker-v1`, `contractor-v1`). Both apps share one origin, so when the worker service worker clears old caches it removes only its own.
- **Registered only in the production build.** In development Vite serves source files that change on every save, and a cache would show old code.
- **Install button:** shown in the header of the worker and contractor apps, only after the browser says the app can be installed (`beforeinstallprompt`). It is hidden once the app is installed. It is never shown in the officer app. The worker's button text is in his language (ADR-0015).

## Consequences

- Installing is tested on Android Chrome and Brave. iPhone Safari has no install event, so there a user adds the app with "Add to Home Screen" himself. No button is shown there.
- Installing needs HTTPS, or `localhost` during development. To try it, run `npm --prefix client run build` then `npm --prefix client run preview`.
- Offline writes (an offer, a confirmation) are out of scope, as in ADR-0005.
- When `sw-core.js` changes in a way that must clear old caches, its version number changes.
