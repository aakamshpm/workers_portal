# ADR-0005: PWA, not a native app

## Status

Accepted. Refined by [ADR-0012](0012-three-apps-one-vite-project.md): the manifest belongs to the worker and contractor apps only, and the officer app has none.

## Context

React Native and Flutter need macOS to build iOS. The team has Linux. The client is already React.

## Decision

Add a web app manifest and a service worker to the existing Vite app. Worker and contractor may install it. Labour officer does not see an install prompt.

## Consequences

- No Capacitor, no APK requirement.
- GPS for the directory, if used at all, is the browser Geolocation API to help fill a typed location, not a live stream.
- Skill: `add-pwa`.
