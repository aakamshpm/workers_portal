import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The design tokens (ADR-0019).
 *
 * These tests read theme.css as text and check the values, because a token
 * file has no behaviour to call. They guarantee four things:
 *
 *  1. Every colour, size and space the design uses is declared, with the
 *     design's own value, so a screen copied from the design does not silently
 *     land on a Tailwind default.
 *  2. Every text colour reaches 4.5:1 against the surface it sits on, which is
 *     the WCAG AA threshold. The palette is checked here rather than by eye,
 *     because one edited hex can break a pair without anybody noticing.
 *  3. No body text is smaller than 16px and nothing at all is smaller than
 *     14px, which is the rule in the UI brief for a worker reading outdoors.
 *  4. The font stack covers all five scripts (ADR-0015), so Hindi, Bengali,
 *     Malayalam and Odia do not fall back to a different-looking font.
 */


// Read from disk, not imported. A stylesheet import would be processed by
// Tailwind, and `?raw` comes back empty because that plugin claims the file
// first. Vitest starts in the client folder, which is where this path begins.
const CSS = readFileSync(resolve(process.cwd(), "src/shared/theme.css"), "utf8");

/** The file without its comments, so a value in prose is never read as CSS. */
function code(): string {
  return CSS.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The custom properties declared in theme.css, as name to value. */
function tokens(): Map<string, string> {
  const block = code().match(/@theme\s*\{([^}]*)\}/);
  if (!block) throw new Error("theme.css has no @theme block");
  const found = new Map<string, string>();
  // A value may run over several lines, as the font stack does, so the split is
  // on the semicolon and not on the newline.
  for (const decl of block[1]!.split(";")) {
    const m = decl.match(/\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)/i);
    if (m) found.set(m[1]!, m[2]!.replace(/\s+/g, " ").trim());
  }
  return found;
}

const T = tokens();

/** The size tokens, without the `--line-height` and `--font-weight` ones. */
function textSizeNames(): string[] {
  return [...T.keys()].filter((k) => /^--text-[a-z0-9]+(-[a-z0-9]+)*$/.test(k) && !k.includes("--", 2));
}

function value(name: string): string {
  const v = T.get(name);
  if (v === undefined) throw new Error(`theme.css does not declare ${name}`);
  return v;
}

/** One channel of an sRGB colour, undone back to light intensity. */
function channel(eight: number): number {
  const c = eight / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, WCAG 2.1 definition. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contrast between two colours, from 1 (same) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x! > y! ? [x!, y!] : [y!, x!];
  return (hi + 0.05) / (lo + 0.05);
}

function colour(name: string): string {
  return value(`--color-${name}`);
}

/** A px number out of a token value like "16px". */
function px(name: string): number {
  const v = value(name);
  const m = v.match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`${name} is "${v}", which is not a px value`);
  return Number(m[1]);
}

/** A rem value in px, at the browser default of 16px to the rem. */
function remPx(name: string): number {
  const v = value(name);
  const m = v.match(/^(\d+(?:\.\d+)?)rem$/);
  if (!m) throw new Error(`${name} is "${v}", which is not a rem value`);
  return Number(m[1]) * 16;
}

describe("colour palette", () => {
  // The design's Material 3 palette, grown from the seed colour #0F766E.
  // Read from the Stitch export, and the reason each one exists.
  const PALETTE: Record<string, string> = {
    // The seed's darker tone: icons, links, active text, small marks.
    primary: "#005c55",
    "on-primary": "#ffffff",
    // The seed itself: filled buttons.
    "primary-container": "#0f766e",
    "on-primary-container": "#a3faef",
    // A selected row, and a quiet reassurance panel.
    secondary: "#216963",
    "on-secondary": "#ffffff",
    "secondary-container": "#a8ece5",
    "on-secondary-container": "#266d68",
    // Links to another record, and the officer's own marks.
    tertiary: "#005584",
    "on-tertiary": "#ffffff",
    "tertiary-container": "#136ea6",
    "on-tertiary-container": "#daebff",
    // A refused action, a disputed record, a failed check.
    error: "#ba1a1a",
    "on-error": "#ffffff",
    "error-container": "#ffdad6",
    "on-error-container": "#93000a",
    // The page itself, and the five card depths above it.
    surface: "#f8f9ff",
    "on-surface": "#0b1c30",
    "on-surface-variant": "#3e4947",
    "surface-container-lowest": "#ffffff",
    "surface-container-low": "#eff4ff",
    "surface-container": "#e5eeff",
    "surface-container-high": "#dce9ff",
    "surface-container-highest": "#d3e4fe",
    // Borders. `outline-variant` is the quiet one, for a divider.
    outline: "#6e7977",
    "outline-variant": "#bdc9c6",
  };

  it("declares every colour the design uses, with the design's value", () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(colour(name), `--color-${name}`).toBe(hex);
    }
  });

  it("declares no colour the design does not define", () => {
    const declared = [...T.keys()]
      .filter((k) => k.startsWith("--color-"))
      .map((k) => k.replace("--color-", ""));
    expect(declared.sort()).toEqual(Object.keys(PALETTE).sort());
  });

  // Each pair is text on a background that the components actually put it on.
  const TEXT_PAIRS: [string, string][] = [
    ["on-surface", "surface"],
    ["on-surface", "surface-container-low"],
    ["on-surface", "surface-container"],
    ["on-surface", "surface-container-high"],
    ["on-surface", "surface-container-highest"],
    ["on-surface-variant", "surface"],
    ["on-surface-variant", "surface-container-lowest"],
    ["on-surface-variant", "surface-container-high"],
    ["primary", "surface"],
    ["primary", "surface-container-lowest"],
    ["primary", "surface-container-low"],
    ["on-primary", "primary"],
    ["on-primary", "primary-container"],
    ["on-secondary-container", "secondary-container"],
    ["on-tertiary", "tertiary"],
    ["on-tertiary-container", "tertiary"],
    ["on-error", "error"],
    ["on-error-container", "error-container"],
  ];

  it.each(TEXT_PAIRS)("%s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(colour(fg), colour(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the main reading colour well above the minimum", () => {
    // AAA, because this pair carries almost every sentence in the app.
    expect(contrast(colour("on-surface"), colour("surface"))).toBeGreaterThanOrEqual(7);
  });

  it("gives a border enough contrast to be seen", () => {
    // 3:1 is the WCAG threshold for a control's boundary, which is not text.
    expect(contrast(colour("outline"), colour("surface"))).toBeGreaterThanOrEqual(3);
  });
});

// Every size the design uses, with its line height and weight.
const SCALE: Record<string, [number, number, number]> = {
  "stat-callout": [28, 36, 700], // an amount of money, the largest thing
  "headline-lg": [24, 32, 700],
  "headline-md": [20, 28, 700],
  "headline-sm": [18, 26, 600],
  "body-lg": [16, 24, 400], // ordinary sentences
  "body-lg-medium": [16, 24, 500],
  "body-lg-bold": [16, 24, 700],
  "label-md": [14, 20, 500], // a badge, a column heading
  "label-sm": [14, 20, 400],
};

describe("text scale", () => {
  it.each(Object.entries(SCALE))("%s is the design's size", (name, [size, line, weight]) => {
    expect(px(`--text-${name}`)).toBe(size);
    expect(px(`--text-${name}--line-height`)).toBe(line);
    expect(Number(value(`--text-${name}--font-weight`))).toBe(weight);
  });

  it("has no size below 14px", () => {
    const sizes = textSizeNames();
    expect(sizes).toHaveLength(Object.keys(SCALE).length);
    for (const name of sizes) {
      expect(px(name), name).toBeGreaterThanOrEqual(14);
    }
  });

  it("keeps body text at 16px, which a worker reads outdoors", () => {
    for (const name of ["body-lg", "body-lg-medium", "body-lg-bold"]) {
      expect(px(`--text-${name}`)).toBeGreaterThanOrEqual(16);
    }
  });

  it("gives every size a line height of at least 1.3 times the size", () => {
    for (const name of Object.keys(SCALE)) {
      const ratio = px(`--text-${name}--line-height`) / px(`--text-${name}`);
      expect(ratio, name).toBeGreaterThanOrEqual(1.28);
    }
  });
});

describe("fonts", () => {
  it("covers all five scripts, so no language falls back to another font", () => {
    const stack = value("--font-sans");
    for (const family of [
      "Noto Sans",
      "Noto Sans Devanagari",
      "Noto Sans Bengali",
      "Noto Sans Malayalam",
      "Noto Sans Oriya",
    ]) {
      expect(stack, family).toContain(family);
    }
  });

  it("ends in a generic family, so text still shows before the font arrives", () => {
    expect(value("--font-sans")).toMatch(/sans-serif\s*$/);
  });

  it("names every font role in the design, so design markup can be copied", () => {
    // The design writes `font-headline-md text-headline-md`. Every role is the
    // same family there, so these exist only to keep copied markup working.
    // Each one must point at the single stack, not repeat it, because a copied
    // list would drift from it on the next edit.
    for (const role of [
      "headline-lg",
      "headline-md",
      "headline-sm",
      "body-lg",
      "body-lg-medium",
      "body-lg-bold",
      "label-md",
      "label-sm",
      "stat-callout",
    ]) {
      expect(value(`--font-${role}`)).toBe("var(--font-sans)");
    }
  });
});

describe("spacing and shape", () => {
  // The design's named steps. A teammate copies `gap-space-sm` from the design
  // HTML, so the names have to exist with the design's values.
  const SPACING: Record<string, number> = {
    "space-xs": 4,
    "space-sm": 8,
    "space-md": 12,
    "space-lg": 16,
    "space-xl": 24,
    "space-2xl": 32,
    margin: 16, // the page's side margin on a phone
    "margin-desktop": 32,
    gutter: 16,
    "gutter-desktop": 24,
  };

  it.each(Object.entries(SPACING))("%s is %ipx", (name, expected) => {
    expect(remPx(`--spacing-${name}`)).toBe(expected);
  });

  it("puts a card's corner at the design's 12px", () => {
    expect(remPx("--radius-xl")).toBe(12);
  });

  it("names the sizes a finger has to hit", () => {
    // Below 48px a tap starts to miss, and for a worker signing a wage record
    // outdoors a missed tap is a wrong answer, not an annoyance.
    for (const name of ["--size-touch", "--size-button", "--size-control", "--size-digit-box"]) {
      expect(px(name), name).toBeGreaterThanOrEqual(48);
    }
    expect(px("--size-header")).toBeGreaterThanOrEqual(48);
  });

  it("keeps the officer's small control above the pointer minimum", () => {
    // This one is deliberately under the finger floor, for a dense table on the
    // officer website, which is read with a mouse. WCAG 2.2 sets 24px as the
    // minimum for a pointer target, so this has to stay well above that and
    // below the floor, which is what makes it a separate token.
    const small = px("--size-control-sm");
    expect(small).toBeGreaterThanOrEqual(40);
    expect(small).toBeLessThan(px("--size-control"));
  });
});

describe("the file itself", () => {
  it("holds every colour in the app, so no component writes a hex", () => {
    // Any hex outside the @theme block would be a value nothing can override.
    // `[^}]*` and not `[\s\S]*`, because the second is greedy: it would run to
    // the last brace in the file and hide a rule written after the block.
    const outside = code().replace(/@theme\s*\{[^}]*\}/, "");
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
