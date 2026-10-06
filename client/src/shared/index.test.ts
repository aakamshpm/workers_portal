import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The base styles in index.css (ADR-0019).
 *
 * Tailwind 4 removed the pointer hand from buttons, so a button shows the
 * ordinary arrow and does not look tappable with a mouse. These tests guarantee
 * that everything a reader can press shows the hand, that a control which is
 * switched off shows "not allowed" instead, and that the rule sits in the base
 * layer, so a component can still choose its own cursor with a utility class.
 *
 * The file is read as text, because a stylesheet has no behaviour to call.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/shared/index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The declaration block that follows the first selector list containing `needle`. */
function rule(needle: string): string {
  const at = CSS.indexOf(needle);
  if (at < 0) throw new Error(`no rule mentions ${needle}`);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

describe("cursor", () => {
  it.each(["button:not(:disabled)", "summary", "select:not(:disabled)", '[role="button"]:not([aria-disabled="true"])'])(
    "shows the pointer hand on %s",
    (selector) => {
      expect(rule(selector)).toMatch(/cursor:\s*pointer/);
    },
  );

  it("shows not-allowed on a control that is switched off", () => {
    expect(rule("button:disabled")).toMatch(/cursor:\s*not-allowed/);
  });

  it("lives in the base layer, so a utility class on a component still wins", () => {
    const layer = CSS.indexOf("@layer base");
    expect(layer).toBeGreaterThan(-1);
    expect(CSS.indexOf("cursor: pointer")).toBeGreaterThan(layer);
  });
});
