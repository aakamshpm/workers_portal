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
