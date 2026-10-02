import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LedgerEntry } from "./types";

/**
 * The records page (W7) on a phone and on a wide screen.
 *
 * What these tests guarantee:
 * - on a phone each record is one card, with its kind, what was written and
 *   the day, so nothing scrolls sideways on a 320px screen;
 * - on a wide screen (the officer's website) the table is still there;
 * - the kind filters are a row of their own that scrolls inside itself, so
 *   seven filters never push the page wider than the phone;
 * - each filter is big enough for a finger and says which one is chosen;
 * - nothing uses a colour outside the theme.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("./api", () => ({ api: { ledger: vi.fn(), verify: vi.fn() } }));

import { api } from "./api";
import LedgerView from "./LedgerView";

const entry = (i: number, recordType: LedgerEntry["recordType"], summary: string): LedgerEntry => ({
  id: `e${i}`,
  chainIndex: i,
  recordType,
  recordId: `r${i}`,
  workerId: "w1",
  summary,
  createdAt: "2026-07-04T00:00:00.000Z",
  previousHash: "0",
  currentHash: "x",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.ledger).mockResolvedValue({
    genesisHash: "0",
    entries: [
      entry(1, "OFFER", "Offer sent: Rs 850.00/day"),
      entry(2, "WORK", "Bijoy Das worked 6 days"),
    ],
  });
});

describe("LedgerView", () => {
  it("shows each record as one card on a phone", async () => {
    render(<LedgerView />);
    const list = await screen.findByRole("list", { name: "All records" });
    expect(list.className).toContain("sm:hidden");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Work offered");
    expect(items[0]!.textContent).toContain("Offer sent: Rs 850.00/day");
    expect(items[0]!.textContent).toContain("04 Jul 2026");
  });

  it("keeps the table for a wide screen", async () => {
    render(<LedgerView />);
    await screen.findByRole("list", { name: "All records" });
    const table = document.querySelector("table")!;
    expect(table.className).toContain("hidden");
    expect(table.className).toContain("sm:table");
  });

  it("puts the filters in their own row that scrolls inside itself", async () => {
    render(<LedgerView />);
    const filters = await screen.findByRole("group", { name: "Show" });
    expect(filters.className).toContain("overflow-x-auto");
    for (const b of within(filters).getAllByRole("button")) {
      expect(b.className).toContain("min-h-[var(--size-touch)]");
      expect(b.className).toContain("whitespace-nowrap");
    }
  });

  it("says which filter is chosen, and filters", async () => {
    render(<LedgerView />);
    const filters = await screen.findByRole("group", { name: "Show" });
    const work = within(filters).getByRole("button", { name: "Work done 1" });
    expect(work.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(work);
    expect(work.getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("list", { name: "All records" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps each date in a summary on one line, so 2026-07-06 never breaks at a hyphen", async () => {
    vi.mocked(api.ledger).mockResolvedValue({
      genesisHash: "0",
      entries: [entry(3, "WORK", "Bijoy Das worked 6 days (2026-07-06 to 2026-07-11)")],
    });
    render(<LedgerView />);
    const list = await screen.findByRole("list", { name: "All records" });
    const dates = [...list.querySelectorAll(".whitespace-nowrap")].map((e) => e.textContent);
    expect(dates).toContain("2026-07-06");
    expect(dates).toContain("2026-07-11");
    // The words around them are unchanged.
    expect(list.textContent).toContain("Bijoy Das worked 6 days (2026-07-06 to 2026-07-11)");
  });

  it("writes no colour outside the theme", async () => {
    const { container } = render(<LedgerView />);
    await screen.findByRole("list", { name: "All records" });
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-|indigo-|lime-|teal-/);
  });
});
