// The contractor app's service worker. Its folder, /contractor/, is its scope. ADR-0018.
importScripts("/sw-core.js");
self.startAppWorker("contractor");
