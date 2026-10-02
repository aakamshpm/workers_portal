import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * What icons.ts says, rather than what it exports (ADR-0019).
 *
 * The path data in that file is Google's work, copied in by
 * scripts/fetch-icons.mjs. Two things about it can only be checked by reading
 * the file as text: that the attribution and licence are still written there,
 * and that nobody has started editing a generated file by hand.
 *
 * It sits in its own file because it needs node:fs, and the app project's
 * TypeScript config deliberately has no Node types: browser code must not be
 * able to import a file system at all. The build lists this file under
 * tsconfig.node.json, next to the other tests that read from disk.
 */

// Vitest starts in the client folder, which is where this path begins.
const ICONS_TS = readFileSync(resolve(process.cwd(), "src/shared/components/icons.ts"), "utf8");

describe("icons.ts", () => {
  it("names where the shapes came from, and under which licence", () => {
    // Without these lines the file reads as our own drawing work.
    expect(ICONS_TS).toContain("google/material-design-icons");
    expect(ICONS_TS).toContain("Apache License 2.0");
  });

  it("says it is generated, and which script to run", () => {
    // Somebody who opens an 18 KB file of path data needs to be told, in the
    // file, not to fix an icon by editing it.
    expect(ICONS_TS).toContain("scripts/fetch-icons.mjs");
    expect(ICONS_TS).toContain("Do not edit by hand");
  });

  it("holds no colour, so every icon takes the colour of its text", () => {
    expect(ICONS_TS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("holds only path data, and no markup", () => {
    // The component writes the <svg> element. A tag in here would mean the
    // generator had captured more than the one path it is meant to.
    expect(ICONS_TS).not.toMatch(/<\/?(svg|path|g|defs)\b/i);
  });
});
