import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Icon, { ICON_NAMES, type IconName } from "./Icon";

/**
 * The icon component (ADR-0019).
 *
 * The design draws its icons with the Material Symbols web font, loaded from
 * Google's CDN. We draw the same shapes as inline SVG instead, because a font
 * fetched from another origin cannot be there when the app opens offline
 * (ADR-0018), and because a missing icon font shows a word like
 * "check_circle" in the middle of the screen rather than nothing at all.
 *
 * What these tests guarantee:
 *
 *  1. An icon that repeats nearby text is hidden from a screen reader, and an
 *     icon that carries meaning of its own is announced with a name. Getting
 *     this backwards is the common way an icon breaks a screen: either every
 *     decoration is read aloud, or the only mark saying "this record is
 *     disputed" is silent.
 *  2. The shape follows the text colour and the font size around it, so
 *     `text-primary` colours the icon too and no caller writes a hex.
 *  3. Every name in the set has real path data, so a typo in the generated
 *     file cannot ship an empty square.
 */

describe("the icon set", () => {
  it("has a shape for every name it offers", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      const path = container.querySelector("path");
      expect(path, name).not.toBeNull();
      // Material Symbols draw inside a 960 box, so any real shape is long.
      expect(path!.getAttribute("d")!.length, name).toBeGreaterThan(20);
    }
  });

  it("names are sorted, so a new one is added in one obvious place", () => {
    expect([...ICON_NAMES]).toEqual([...ICON_NAMES].sort());
  });

  it("draws every shape without a colour, so the theme decides", () => {
    // A path that carried its own fill would ignore `currentColor` and stay
    // that colour on every screen. The licence and the attribution are checked
    // in icons.source.test.ts, which can read the file as text.
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      expect(container.innerHTML, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});

describe("a decorative icon", () => {
  it("is hidden from a screen reader when it has no label", () => {
    const { container } = render(<Icon name="payments" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("is not reachable by keyboard, because there is nothing to do with it", () => {
    const { container } = render(<Icon name="payments" />);
    expect(container.querySelector("svg")!.getAttribute("focusable")).toBe("false");
  });
});

describe("an icon that carries meaning", () => {
  it("is announced with its label", () => {
    render(<Icon name="warning" label="This record is disputed" />);
    const found = screen.getByRole("img", { name: "This record is disputed" });
    expect(found.tagName.toLowerCase()).toBe("svg");
  });

  it("is not hidden, because then the label would never be read", () => {
    const { container } = render(<Icon name="warning" label="Disputed" />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("colour and size", () => {
  it("takes the colour of the text around it", () => {
    const { container } = render(<Icon name="check_circle" />);
    expect(container.querySelector("svg")!.getAttribute("fill")).toBe("currentColor");
  });

  it("is 20px across unless the caller asks for another size", () => {
    const { container } = render(<Icon name="check_circle" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });

  it("takes the size the caller asks for", () => {
    const { container } = render(<Icon name="check_circle" size={24} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
  });

  it("keeps the Material Symbols drawing box, so shapes are not cut off", () => {
    const { container } = render(<Icon name="check_circle" />);
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 -960 960 960");
  });

  it("passes extra classes through, so a caller can colour or place it", () => {
    const { container } = render(<Icon name="check_circle" className="text-primary" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("text-primary");
  });
});

describe("the filled variant", () => {
  it("draws a different shape from the outlined one", () => {
    const outline = render(<Icon name="check_circle" />).container.querySelector("path")!;
    const solid = render(<Icon name="check_circle" filled />).container.querySelector("path")!;
    expect(solid.getAttribute("d")).not.toBe(outline.getAttribute("d"));
  });

  it("falls back to the outlined shape when there is no filled one", () => {
    // `search` has no filled version in the set, and asking for one must not
    // blank the icon out.
    const plain = render(<Icon name="search" />).container.querySelector("path")!;
    const asked = render(<Icon name="search" filled />).container.querySelector("path")!;
    expect(asked.getAttribute("d")).toBe(plain.getAttribute("d"));
  });
});

describe("the spinning icon", () => {
  it("turns, and says it is busy, so a screen reader does not read it as a shape", () => {
    render(<Icon name="progress_activity" spin label="Loading" />);
    const svg = screen.getByRole("img", { name: "Loading" });
    expect(svg.getAttribute("class")).toContain("animate-spin");
  });
});

describe("the names the screens need", () => {
  // Each name here is used by a screen we are building. The list exists so that
  // trimming the set cannot quietly remove an icon a page depends on.
  const NEEDED: IconName[] = [
    "arrow_back",
    "call",
    "calendar_month",
    "check",
    "check_circle",
    "chevron_right",
    "close",
    "engineering",
    "gavel",
    "groups",
    "info",
    "install_mobile",
    "key_vertical",
    "language",
    "location_on",
    "lock",
    "logout",
    "payments",
    "person",
    "person_add",
    "progress_activity",
    "receipt_long",
    "schedule",
    "search",
    "send",
    "shield",
    "sms",
    "verified_user",
    "visibility",
    "warning",
  ];

  it.each(NEEDED)("has %s", (name) => {
    expect(ICON_NAMES).toContain(name);
  });
});
