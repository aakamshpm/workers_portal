import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DisputedRecord } from "../shared/types";

/**
 * The officer's Disputed records page (design O3, ADR-0021).
 *
 * These are records a worker rejected without writing a complaint. What these
 * tests guarantee:
 * - the page is its own page, with its own heading, and asks for both lists:
 *   the records waiting, and the ones an officer already dealt with;
 * - each record shows what the contractor recorded next to what the worker
 *   states, and the amount between them, so the officer sees the gap first;
 * - a contractor who has not answered is not shown as agreeing;
 * - a complaint already decided on the same contract is shown before the
 *   figures, because it may be the same matter;
 * - a review needs a note of ten characters, and changes no sealed figure: it
 *   only takes the record off the waiting list, with the officer's name on it;
 * - a reviewed record can be put back, so a review is never a dead end;
 * - nothing uses a colour outside the theme.
 *
 * The API module is mocked. No test reaches the server, so no SMS is sent.
 */

vi.mock("../shared/api", () => ({
  api: { disputedRecords: vi.fn(), reviewDispute: vi.fn(), reopenDispute: vi.fn() },
}));

import { api } from "../shared/api";
import DisputedRecordsPage from "./DisputedRecordsPage";

const WAITING = {
  kind: "PAYMENT", id: "p1", offerId: "o1", siteName: "Kakkanad Phase 2",
  worker: { id: "w", name: "Bijoy Das", phone: "9880030001" },
  contractor: { id: "c", name: "Ramesh Pillai", company: "Ramesh Builders", phone: "9000010001" },
  contractorSays: "Paid ₹8,000 in cash", workerSays: "Received ₹4,000", gapValue: 4000,
  period: "18 Jul 2026", note: "He gave me only half.", via: "SMS", at: "2026-07-19T10:00:00.000Z",
  employerStatement: null, review: null, relatedComplaint: null,
} as unknown as DisputedRecord;

const ANSWERED = {
  ...WAITING, kind: "WORK", id: "w1", worker: { id: "w2", name: "Sanjay Kumar", phone: "9880030002" },
  period: "13 to 18 Jul 2026", note: null, via: null,
  employerStatement: { note: "The two days were Sundays.", at: "2026-08-03T10:00:00.000Z" },
  relatedComplaint: { status: "RESOLVED", outcome: "UPHELD", note: "Paid in full.", closedAt: "2026-08-20T00:00:00.000Z" },
} as unknown as DisputedRecord;

const REVIEWED = {
  ...WAITING, id: "p9", worker: { id: "w3", name: "Pramod Nayak", phone: "9880030003" },
  review: { reason: "SETTLED_OUTSIDE", note: "Called both, they settled it.", at: "2026-08-01T00:00:00.000Z", officer: { id: "o", name: "Anita Joseph" } },
} as unknown as DisputedRecord;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.disputedRecords).mockImplementation(((reviewed?: boolean) =>
    Promise.resolve(reviewed ? [REVIEWED] : [WAITING, ANSWERED])) as never);
});

async function open() {
  const view = render(<DisputedRecordsPage />);
  await screen.findByRole("heading", { level: 1, name: "Disputed records" });
  return view;
}

const rowOf = (name: string) => screen.getByText(new RegExp(`^${name} ·`)).closest("li")!;

describe("Disputed records page", () => {
  it("has its own heading, and asks for the waiting list and the reviewed list", async () => {
    await open();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(api.disputedRecords).toHaveBeenCalledWith();
    expect(api.disputedRecords).toHaveBeenCalledWith(true);
    expect(screen.getByRole("region", { name: "Needing your attention (2)" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Already dealt with (1)" })).toBeTruthy();
  });

  it("puts what the contractor recorded next to what the worker states, with the gap", async () => {
    await open();
    const row = rowOf("Bijoy Das");
    expect(row.textContent).toContain("Bijoy Das · Kakkanad Phase 2");
    expect(row.textContent).toContain("Payment 18 Jul 2026 · Ramesh Pillai (Ramesh Builders)");
    expect(row.textContent).toContain("Amount in dispute");
    expect(row.textContent).toContain("₹4,000");
    expect(within(row).getByText("The contractor recorded").parentElement!.textContent).toContain("Paid ₹8,000 in cash");
    expect(within(row).getByText("The worker states").parentElement!.textContent).toContain("Received ₹4,000");
    expect(row.textContent).toContain("The worker added: He gave me only half.");
    expect(row.textContent).toContain("by text message");
    expect(row.querySelector('a[href="tel:+919880030001"]')).not.toBeNull();
  });

  it("does not show a contractor who has not answered as agreeing", async () => {
    await open();
    expect(rowOf("Bijoy Das").textContent).toContain(
      "The contractor has not given his account of this. That is not the same as agreeing with the worker.",
    );
    expect(rowOf("Sanjay Kumar").textContent).toContain("The two days were Sundays.");
    expect(rowOf("Sanjay Kumar").textContent).not.toContain("has not given his account");
  });

  it("warns before the figures when a complaint on the same contract was already decided", async () => {
    await open();
    const row = rowOf("Sanjay Kumar");
    const warning = within(row).getByText(/A complaint on this same contract was already closed/);
    const figures = within(row).getByText("The contractor recorded");
    expect(warning.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.textContent).toContain("as upheld");
    expect(row.textContent).toContain("Check before contacting anyone again.");
    expect(rowOf("Bijoy Das").textContent).not.toContain("A complaint on this same contract");
  });

  it("keeps the form closed, and the button that opens it says whether it is open", async () => {
    await open();
    const row = rowOf("Bijoy Das");
    expect(within(row).queryByRole("textbox")).toBeNull();
    const openButton = within(row).getByRole("button", { name: "No more action needed" });
    expect(openButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(openButton);
    expect(within(row).getByLabelText(/What did you find/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByRole("textbox")).toBeNull();
  });

  it("takes a record off the list only with a note of ten characters, and names the reason he chose", async () => {
    vi.mocked(api.reviewDispute).mockResolvedValue({ reviewed: true, message: "Taken off your list." });
    await open();
    const row = rowOf("Bijoy Das");
    fireEvent.click(within(row).getByRole("button", { name: "No more action needed" }));
    const save = within(row).getByRole("button", { name: "Take off my list" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(within(row).getByLabelText(/Why does this need no more attention/), {
      target: { value: "UNPROVABLE" },
    });
    fireEvent.change(within(row).getByLabelText(/What did you find/), { target: { value: "too short" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText(/What did you find/), {
      target: { value: "Called both. Nothing can prove it." },
    });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() =>
      expect(api.reviewDispute).toHaveBeenCalledWith({
        kind: "PAYMENT",
        id: "p1",
        reason: "UNPROVABLE",
        note: "Called both. Nothing can prove it.",
      }),
    );
    await screen.findByText("Taken off your list.");
    // Both lists are loaded again, so the record moves to "Already dealt with".
    await waitFor(() => expect(vi.mocked(api.disputedRecords).mock.calls.length).toBeGreaterThan(2));
  });

  it("shows a reviewed record with the reason, the officer and the note, and can put it back", async () => {
    vi.mocked(api.reopenDispute).mockResolvedValue({ reopened: true, message: "Back on your list." });
    await open();
    const row = rowOf("Pramod Nayak");
    expect(row.textContent).toContain("Settled between the two of them");
    expect(row.textContent).toContain("Anita Joseph");
    expect(row.textContent).toContain("Called both, they settled it.");
    expect(within(row).queryByRole("button", { name: "No more action needed" })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Put back on my list" }));
    await waitFor(() => expect(api.reopenDispute).toHaveBeenCalledWith("PAYMENT", "p9"));
    await screen.findByText("Back on your list.");
  });

  it("says plainly when nothing is waiting, and leaves out the empty reviewed list", async () => {
    vi.mocked(api.disputedRecords).mockResolvedValue([]);
    await open();
    expect(screen.getByText("Nothing is waiting for you here.")).toBeTruthy();
    expect(screen.queryByText(/Already dealt with/)).toBeNull();
  });

  it("says what went wrong when the records cannot be loaded, instead of staying blank", async () => {
    vi.mocked(api.disputedRecords).mockRejectedValue(new Error("The server is not answering."));
    render(<DisputedRecordsPage />);
    await screen.findByText("The server is not answering.");
    expect(screen.queryByText("Please wait…")).toBeNull();
  });

  it("uses no colour outside the theme, with a form open", async () => {
    const { container } = await open();
    fireEvent.click(within(rowOf("Bijoy Das")).getByRole("button", { name: "No more action needed" }));
    expect(container.innerHTML).not.toMatch(/(slate|rose|emerald|sky|amber|red|green|blue|violet)-\d/);
  });
});
