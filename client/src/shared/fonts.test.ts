import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The web fonts (ADR-0019).
 *
 * The app ships its own font files, because a font from a CDN is not there when
 * the app opens offline (ADR-0018). These tests guarantee:
 *
 *  1. Every family the theme's font stack names has a face here, so no script
 *     falls through to whatever the phone has, which on a cheap Android phone
 *     can be a font with no Odia at all.
 *  2. Each face covers its own script's Unicode block and only loads for it,
 *     so an English reader never downloads 400 KB of Indic fonts.
 *  3. Every file the CSS points at exists, at the pinned package version.
 *  4. Text is shown in a fallback font while the file arrives, instead of
 *     being invisible, which on a slow connection could be several seconds of
 *     a blank wage screen.
 *  5. The licence is named, because the fonts are redistributed in the build.
 */

const ROOT = process.cwd();
const CSS = readFileSync(resolve(ROOT, "src/shared/fonts.css"), "utf8");
const THEME = readFileSync(resolve(ROOT, "src/shared/theme.css"), "utf8");

type Face = { family: string; src: string; range: string; display: string; weight: string };

function faces(): Face[] {
  const found: Face[] = [];
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of code.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1]!;
    const get = (prop: string) =>
      body.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    found.push({
      family: get("font-family").replace(/["']/g, ""),
      src: get("src"),
      range: get("unicode-range"),
      display: get("font-display"),
      weight: get("font-weight"),
    });
  }
  return found;
}

const FACES = faces();

/** The family names in the theme's --font-sans stack, before the generic ones. */
function stack(): string[] {
  const value = THEME.match(/--font-sans:\s*([^;]+);/)![1]!;
  return [...value.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Whether a unicode-range list includes one code point. */
function covers(range: string, codePoint: number): boolean {
  return range.split(",").some((part) => {
    const [lo, hi] = part.trim().replace(/^U\+/i, "").split("-");
    const a = parseInt(lo!, 16);
    const b = hi ? parseInt(hi, 16) : a;
    return codePoint >= a && codePoint <= b;
  });
}

describe("fonts.css", () => {
  it("has a face for every family the theme names", () => {
    const families = new Set(FACES.map((f) => f.family));
    for (const family of stack()) expect(families.has(family), family).toBe(true);
  });

  // One letter from each script, and the family that must draw it.
  const SCRIPTS: [string, string, string][] = [
    ["Latin", "a", "Noto Sans"],
    ["Devanagari (Hindi)", "क", "Noto Sans Devanagari"],
    ["Bengali", "ক", "Noto Sans Bengali"],
    ["Malayalam", "ക", "Noto Sans Malayalam"],
    ["Odia", "କ", "Noto Sans Oriya"],
  ];

  it.each(SCRIPTS)("draws %s with its own font", (_script, letter, family) => {
    const cp = letter.codePointAt(0)!;
    const face = FACES.find((f) => f.family === family && covers(f.range, cp));
    expect(face, `${family} has no face covering U+${cp.toString(16)}`).toBeTruthy();
  });

  it("loads an Indic font only for its own script, not for English", () => {
    // Without a unicode-range, the browser downloads every face in the stack
    // the first time it draws anything, which is all five files on an English
    // page.
    for (const face of FACES.filter((f) => f.family !== "Noto Sans")) {
      expect(face.range, face.family).not.toBe("");
      expect(covers(face.range, "a".codePointAt(0)!), face.family).toBe(false);
    }
  });

  it("has the rupee sign in some face, since every worker screen shows money", () => {
    const rupee = 0x20b9;
    expect(FACES.some((f) => covers(f.range, rupee))).toBe(true);
  });

  it("shows text in a fallback font while a file is still arriving", () => {
    for (const face of FACES) expect(face.display, face.family).toBe("swap");
  });

  it("offers every weight the text scale uses, from one variable file", () => {
    // The scale uses 400, 500, 600 and 700. A variable font covers all of
    // them in one file, where fixed fonts would need four.
    for (const face of FACES) expect(face.weight, face.family).toBe("100 900");
  });

  it("points at files that exist, from the pinned font packages", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    for (const face of FACES) {
      const url = face.src.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      expect(url, face.family).toBeTruthy();
      expect(existsSync(resolve(ROOT, "node_modules", url!)), url).toBe(true);
      const name = url!.split("/files/")[0]!;
      // ADR-0019 and the repo rule: dependencies are pinned to one version.
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("names the licence the font files are redistributed under", () => {
    expect(CSS).toContain("SIL Open Font License");
  });
});
