/*
 * Service worker core for the installable apps. ADR-0018.
 *
 * Loaded by /worker/sw.js and /contractor/sw.js with importScripts, then
 * started with the app's name. Each app's worker lives in the app's own folder,
 * so the browser gives it that folder as its scope and it never controls
 * another app's pages.
 *
 * Rules, in the order the fetch handler applies them:
 *   1. Only GET requests to this site. Anything else goes to the network untouched.
 *   2. Never /api/. Money data is always read fresh from the server and never
 *      stored here: a stored balance could be old and show the wrong amount
 *      owed, and on a shared phone it would stay readable after sign-out.
 *   3. /assets/ (build files, whose names change with their content): from the
 *      cache, else the network, and stored.
 *   4. A page inside this app: from the network, so an online reader always
 *      gets the newest version. Offline, the stored app page, for any address
 *      inside the app, since every address opens the same page.
 *   5. Everything else (other apps, the sign-in page): untouched.
 *
 * Plain JavaScript with no build step, because a service worker file must be
 * served as it is.
 */

// Change this when a change here must clear the caches already on phones.
var SW_VERSION = 1;

self.startAppWorker = function (app) {
  var PREFIX = app + "-v";
  var CACHE = PREFIX + SW_VERSION;
  var APP_PATH = "/" + app + "/";
  var SHELL = new URL(APP_PATH, self.location.origin).href;

  /** Build files a page links: scripts, module preloads, styles. */
  function linkedAssets(html) {
    var found = [];
    var re = /(?:src|href)="(\/assets\/[^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = new URL(m[1], self.location.origin).href;
      if (found.indexOf(url) === -1) found.push(url);
    }
    return found;
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(
      (async function () {
        var cache = await caches.open(CACHE);
        var page = await fetch(SHELL);
        if (!page.ok) throw new Error("could not load " + SHELL);
        var html = await page.clone().text();
        await cache.put(SHELL, page);
        await Promise.all(
          linkedAssets(html).map(async function (url) {
            var res = await fetch(url);
            if (res.ok) await cache.put(url, res);
          }),
        );
        await self.skipWaiting();
      })(),
    );
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      (async function () {
        var names = await caches.keys();
        // Both apps share one site, so only this app's old caches are removed.
        await Promise.all(
          names
            .filter(function (n) {
              return n.indexOf(PREFIX) === 0 && n !== CACHE;
            })
            .map(function (n) {
              return caches.delete(n);
            }),
        );
        await self.clients.claim();
      })(),
    );
  });

  async function fromCacheFirst(request) {
    var cache = await caches.open(CACHE);
    var hit = await cache.match(request);
    if (hit) return hit;
    var res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  }

  async function pageFromNetworkFirst(request) {
    var cache = await caches.open(CACHE);
    try {
      var res = await fetch(request);
      if (res.ok) {
        await cache.put(SHELL, res.clone());
        return res;
      }
      return (await cache.match(SHELL)) || res;
    } catch (offline) {
      var stored = await cache.match(SHELL);
      if (stored) return stored;
      throw offline;
    }
  }

  async function fromNetworkThenCache(request) {
    var cache = await caches.open(CACHE);
    try {
      var res = await fetch(request);
      if (res.ok) await cache.put(request, res.clone());
      return res;
    } catch (offline) {
      var stored = await cache.match(request);
      if (stored) return stored;
      throw offline;
    }
  }

  self.addEventListener("fetch", function (event) {
    var request = event.request;
    if (request.method !== "GET") return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.indexOf("/api/") === 0) return;

    if (url.pathname.indexOf("/assets/") === 0) {
      event.respondWith(fromCacheFirst(request));
      return;
    }

    var inApp = url.pathname === "/" + app || url.pathname.indexOf(APP_PATH) === 0;
    if (!inApp) return;

    if (request.mode === "navigate") {
      event.respondWith(pageFromNetworkFirst(request));
      return;
    }

    // The app's own small files: manifest, icons.
    event.respondWith(fromNetworkThenCache(request));
  });
};
