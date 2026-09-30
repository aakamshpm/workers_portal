// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

/**
 * The service worker (public/sw-core.js). ADR-0018.
 *
 * It runs here in a Node sandbox with a fake `self`, `caches` and `fetch`,
 * because a real browser service worker cannot run inside a unit test.
 *
 * What these tests guarantee:
 * - an /api/ request is never answered from the cache and never stored, even a
 *   GET. A saved balance could be old and show the wrong amount owed, and on a
 *   shared phone it would stay readable after sign-out;
 * - an app page comes from the network when there is one, so an online reader
 *   always gets the newest version, and from the cached page when there is
 *   none, for any address inside the app;
 * - installing stores the app page and every build file that page links;
 * - a request outside the app's own address, or not a GET, is left alone;
 * - clearing old caches removes only this app's old caches, never the other
 *   app's, since both apps share one origin.
 */

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = readFileSync(resolve(CLIENT, "public", "sw-core.js"), "utf8");
const ORIGIN = "http://localhost:5173";

const SHELL = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/worker-AbC123.js"></script>
<link rel="modulepreload" crossorigin href="/assets/api-Xy9.js">
<link rel="stylesheet" crossorigin href="/assets/index-Qq1.css">
<link rel="manifest" href="/worker/manifest.webmanifest">
</head><body></body></html>`;

class FakeResponse {
  constructor(
    public body: string,
    public status = 200,
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, this.status);
  }
  async text() {
    return this.body;
  }
}

type Req = { url: string; method: string; mode: string };

/** One Cache: a map from URL to response. */
class FakeCache {
  store = new Map<string, FakeResponse>();
  async put(req: Req | string, res: FakeResponse) {
    this.store.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res);
  }
  async match(req: Req | string) {
    return this.store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
  }
}

function sandbox() {
  const named = new Map<string, FakeCache>();
  const listeners: Record<string, (e: unknown) => void> = {};
  const network = { online: true, fetched: [] as string[] };

  const caches = {
    async open(name: string) {
      if (!named.has(name)) named.set(name, new FakeCache());
      return named.get(name)!;
    },
    async keys() {
      return [...named.keys()];
    },
    async delete(name: string) {
      return named.delete(name);
    },
  };

  async function fetch(req: Req | string) {
    const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
    network.fetched.push(url);
    if (!network.online) throw new TypeError("Failed to fetch");
    const path = new URL(url).pathname;
    // Like the real server: every address inside an app, except a file, is the app page.
    if (/^\/(worker|contractor)\//.test(path) && !/\.[a-z0-9]+$/i.test(path)) return new FakeResponse(SHELL);
    return new FakeResponse(`body of ${path}`);
  }

  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/worker/sw.js` },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  runInNewContext(CORE, { self, caches, fetch, URL, Promise, console });
  return { self: self as typeof self & { startAppWorker: (app: string) => void }, named, listeners, network };
}

/** Send one fetch event. Returns the response, or null when the worker left it alone. */
async function dispatch(s: ReturnType<typeof sandbox>, path: string, init: Partial<Req> = {}) {
  let answered: Promise<FakeResponse> | null = null;
  const request: Req = { url: new URL(path, ORIGIN).href, method: "GET", mode: "cors", ...init };
  const waits: Promise<unknown>[] = [];
  s.listeners.fetch!({
    request,
    respondWith: (p: Promise<FakeResponse>) => {
      answered = p;
    },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  const res = answered ? await answered : null;
  await Promise.all(waits);
  return res as FakeResponse | null;
}

async function lifecycle(s: ReturnType<typeof sandbox>, type: "install" | "activate") {
  const waits: Promise<unknown>[] = [];
  s.listeners[type]!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

function allStored(s: ReturnType<typeof sandbox>) {
  return [...s.named.values()].flatMap((c) => [...c.store.keys()]);
}

let s: ReturnType<typeof sandbox>;

beforeEach(async () => {
  s = sandbox();
  s.self.startAppWorker("worker");
  await lifecycle(s, "install");
  await lifecycle(s, "activate");
});

describe("service worker: money data", () => {
  it("never answers an /api/ request itself, and never stores one", async () => {
    for (const path of ["/api/offers", "/api/ledger?workerId=1", "/api/auth/me"]) {
      expect(await dispatch(s, path)).toBeNull();
    }
    expect(allStored(s).some((u) => u.includes("/api/"))).toBe(false);
  });

  it("leaves /api/ alone offline too, so the page shows its own error", async () => {
    s.network.online = false;
    expect(await dispatch(s, "/api/offers")).toBeNull();
  });
});

describe("service worker: the app page", () => {
  it("stores the app page and every build file it links when installed", () => {
    const stored = allStored(s);
    for (const path of ["/worker/", "/assets/worker-AbC123.js", "/assets/api-Xy9.js", "/assets/index-Qq1.css"]) {
      expect(stored).toContain(`${ORIGIN}${path}`);
    }
  });

  it("gets a page from the network when online, and keeps the newest copy", async () => {
    const before = s.network.fetched.length;
    const res = await dispatch(s, "/worker/records", { mode: "navigate" });
    expect(res?.body).toBe(SHELL);
    expect(s.network.fetched.length).toBe(before + 1);
  });

  it("opens any address inside the app from the stored page when offline", async () => {
    s.network.online = false;
    for (const path of ["/worker/", "/worker/work", "/worker/find-work?town=Aluva"]) {
      const res = await dispatch(s, path, { mode: "navigate" });
      expect(res?.body, path).toBe(SHELL);
    }
  });

  it("serves a build file from the cache without asking the network", async () => {
    const before = s.network.fetched.length;
    const res = await dispatch(s, "/assets/worker-AbC123.js");
    expect(res?.body).toBe("body of /assets/worker-AbC123.js");
    expect(s.network.fetched.length).toBe(before);
  });

  it("stores a build file it had not seen, the first time it is loaded", async () => {
    await dispatch(s, "/assets/late-Zz7.js");
    expect(allStored(s)).toContain(`${ORIGIN}/assets/late-Zz7.js`);
  });
});

describe("service worker: what it leaves alone", () => {
  it("does not touch a request that is not a GET", async () => {
    expect(await dispatch(s, "/worker/", { method: "POST", mode: "navigate" })).toBeNull();
  });

  it("does not answer for another app or the sign-in page", async () => {
    for (const path of ["/", "/officer/", "/officer/complaints", "/contractor/workers"]) {
      expect(await dispatch(s, path, { mode: "navigate" }), path).toBeNull();
    }
  });

  it("does not touch another site", async () => {
    expect(await dispatch(s, "https://photon.komoot.io/api/?q=Aluva")).toBeNull();
  });
});

describe("service worker: old caches", () => {
  it("removes only this app's old caches, never the other app's", async () => {
    const t = sandbox();
    await t.named.set("worker-v0", new FakeCache());
    await t.named.set("contractor-v0", new FakeCache());
    await t.named.set("contractor-v1", new FakeCache());
    t.self.startAppWorker("worker");
    await lifecycle(t, "install");
    await lifecycle(t, "activate");
    const names = [...t.named.keys()];
    expect(names).not.toContain("worker-v0");
    expect(names).toEqual(expect.arrayContaining(["contractor-v0", "contractor-v1"]));
    expect(names.filter((n) => n.startsWith("worker-"))).toHaveLength(1);
  });
});
