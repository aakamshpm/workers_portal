// The worker app's service worker. Its folder, /worker/, is its scope. ADR-0018.
importScripts("/sw-core.js");
self.startAppWorker("worker");
