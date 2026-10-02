import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AppHeader from "./AppHeader";

/**
 * The bar at the top of every screen (ADR-0019).
 *
 * What this guarantees: it is the page's one banner landmark, so a screen
 * reader can jump to it; it always names the app; whatever the screen puts at
 * its end (the language list, sign out) is inside it; and it is the design's
 * height.
 */
describe("AppHeader", () => {
  it("is the page banner and names the app", () => {
    render(<AppHeader title="Worker Pay Record" />);
    expect(screen.getByRole("banner").textContent).toContain("Worker Pay Record");
  });

  it("holds the controls the screen gives it", () => {
    render(
      <AppHeader title="Worker Pay Record">
        <button type="button">Sign out</button>
      </AppHeader>,
    );
    const banner = screen.getByRole("banner");
    expect(banner.contains(screen.getByRole("button", { name: "Sign out" }))).toBe(true);
  });

  it("is the design's height", () => {
    render(<AppHeader title="Worker Pay Record" />);
    expect(screen.getByRole("banner").innerHTML).toContain("min-h-[var(--size-header)]");
  });

  it("does not make the app name a heading, so each screen's question is the only h1", () => {
    render(<AppHeader title="Worker Pay Record" />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
