import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The HTML entry of each app. ADR-0012, ADR-0005.
 *
 * What these tests guarantee:
 * - each app has its own entry page, so each builds as its own bundle;
 * - the officer page links no manifest. A browser offers to install a site
 *   only when a page links one, so this line is what keeps "labour officer:
 *   website only" true;
 * - no entry page links another app's script, so the officer bundle cannot
 *   quietly carry the worker's or the contractor's screens.
 *
 * The worker and contractor manifests are added in the PWA step, which will
 * add its own test that they are present.
 */

// The client folder. The package is an ES module, so there is no __dirname.
const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = {
  signin: { html: "index.html", script: "/src/signin/main.tsx" },
  worker: { html: "worker/index.html", script: "/src/worker/main.tsx" },
  contractor: { html: "contractor/index.html", script: "/src/contractor/main.tsx" },
  officer: { html: "officer/index.html", script: "/src/officer/main.tsx" },
} as const;

function read(html: string) {
  return readFileSync(resolve(CLIENT, html), "utf8");
}

describe("entry pages", () => {
  it.each(Object.entries(ENTRIES))("%s has its own entry page and script", (_name, e) => {
    expect(existsSync(resolve(CLIENT, e.html))).toBe(true);
    expect(read(e.html)).toContain(`src="${e.script}"`);
  });

  it.each(Object.entries(ENTRIES))("%s loads only its own script", (name, e) => {
    const html = read(e.html);
    for (const [other, o] of Object.entries(ENTRIES)) {
      if (other !== name) expect(html).not.toContain(o.script);
    }
  });

  it("the officer website links no manifest, so no browser offers to install it", () => {
    expect(read(ENTRIES.officer.html)).not.toMatch(/rel=["']manifest["']/);
  });

  it("the sign-in page links no manifest, because it belongs to no one app", () => {
    expect(read(ENTRIES.signin.html)).not.toMatch(/rel=["']manifest["']/);
  });
});

/**
 * The installable apps. ADR-0018.
 *
 * What these tests guarantee:
 * - the worker and contractor pages each link their own manifest, and no
 *   other one;
 * - each manifest's id, start_url and scope are the app's own address, so an
 *   installed worker app can never open the contractor or officer app inside it;
 * - every icon a manifest names exists, is a real PNG of the size it claims,
 *   and there is a maskable one, which Android needs for a round icon;
 * - each installable app has a service worker in its own folder, and only the
 *   worker and contractor entry scripts register one. The officer app has
 *   neither a manifest nor a service worker.
 */

const PUBLIC = resolve(CLIENT, "public");
const INSTALLABLE = ["worker", "contractor"] as const;

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function manifestOf(app: string): Manifest {
  return JSON.parse(readFileSync(resolve(PUBLIC, app, "manifest.webmanifest"), "utf8")) as Manifest;
}

/** Width and height from a PNG's IHDR chunk, which always starts at byte 16. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe.each(INSTALLABLE)("the %s app is installable", (app) => {
  const html = () => read(`${app}/index.html`);

  it("links its own manifest, and no other app's", () => {
    expect(html()).toContain(`<link rel="manifest" href="/${app}/manifest.webmanifest"`);
    expect(html().match(/rel=["']manifest["']/g)).toHaveLength(1);
  });

  it("opens and stays inside its own address", () => {
    const m = manifestOf(app);
    expect(m.id).toBe(`/${app}/`);
    expect(m.start_url).toBe(`/${app}/`);
    expect(m.scope).toBe(`/${app}/`);
    expect(m.display).toBe("standalone");
    expect(m.name.length).toBeGreaterThan(0);
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("names icons that exist, at the sizes they claim, with a maskable one", () => {
    const m = manifestOf(app);
    for (const icon of m.icons) {
      expect(icon.src.startsWith(`/${app}/`)).toBe(true);
      const file = resolve(PUBLIC, icon.src.slice(1));
      expect(existsSync(file), icon.src).toBe(true);
      const [w, h] = pngSize(file);
      expect(`${w}x${h}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
    const sizes = m.icons.filter((i) => (i.purpose ?? "any") === "any").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
  });

  it("has a service worker in its own folder, registered by its own entry script", () => {
    expect(readFileSync(resolve(PUBLIC, app, "sw.js"), "utf8")).toContain(`startAppWorker("${app}")`);
    expect(read(`src/${app}/main.tsx`)).toContain(`registerServiceWorker("${app}")`);
  });
});

describe("the officer website stays a website", () => {
  it("has no manifest and no service worker", () => {
    expect(existsSync(resolve(PUBLIC, "officer", "manifest.webmanifest"))).toBe(false);
    expect(existsSync(resolve(PUBLIC, "officer", "sw.js"))).toBe(false);
  });

  it("registers no service worker and listens for no install offer", () => {
    const main = read("src/officer/main.tsx");
    expect(main).not.toContain("registerServiceWorker");
    expect(main).not.toContain("captureInstallPrompt");
  });
});
