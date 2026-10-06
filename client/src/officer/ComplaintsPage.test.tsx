import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Complaint, ContractBalance, DisputedRecord } from "../shared/types";

/**
 * The officer's Complaints page (design O1, ADR-0021).
 *
 * What these tests guarantee:
 * - the page shows three counts, and the number of disputes waiting is a link
 *   to the Disputed records page, which is no longer a tab inside this one;
 * - each open complaint is one card named by the worker, the state he comes
 *   from and the kind of complaint, with what he asks for and what the records
 *   show, so the officer is never judging a claim against nothing;
 * - when the claim and the records differ, the page says by how much, and says
 *   which records rest on the contractor's word alone;
 * - a decision needs a reason of ten characters, because the worker is sent it
 *   by SMS and an empty decision would reach his phone;
 * - closed cases stay on the page, found by the worker's name;
 * - nothing uses a colour outside the theme.
 *
 * The API module is mocked. No test reaches the server, so no SMS is sent.
 */

vi.mock("../shared/api", () => ({
  api: {
    complaints: vi.fn(),
    disputedRecords: vi.fn(),
    trackRecord: vi.fn(),
    askEmployer: vi.fn(),
    contact: vi.fn(),
    decide: vi.fn(),
    escalate: vi.fn(),
  },
}));

import { api } from "../shared/api";
import ComplaintsPage from "./ComplaintsPage";

const OFFICER: AuthUser = { id: "o1", name: "Anita Joseph", phone: "9000020001", role: "AUTHORITY" };

const CONTRACT = {
  offerId: "o1", status: "ACCEPTED",
  worker: { id: "w", name: "Pramod Nayak" },
  contractor: { id: "c", name: "Suresh Menon", company: "Sunrise Plywood Works", phone: "9000010002" },
  dailyRate: 700, workType: "Plywood", siteName: "Perumbavoor unit", startDate: "2026-07-20T00:00:00.000Z",
  expectedDays: 24, extraTerms: null, acceptedAt: "2026-07-18T00:00:00.000Z", acceptedVia: "SMS",
  daysWorked: 15, earned: 10500, paid: 4000, balance: 6500, daysConfirmed: 15, daysWaiting: 0, daysDisputed: 0,
  earnedConfirmed: 10500, paidConfirmed: 0, paidWaiting: 0, paidDisputed: 4000, awaitingConfirmation: 1,
  disputedRecords: 1, periodCount: 2, paymentCount: 1, lastPaymentOn: null, openComplaints: 1,
} as ContractBalance;

const OPEN = {
  id: "k1", category: "UNPAID", description: "I worked 15 days and received no payment.",
  language: "or", claimedAmount: 10500, status: "OPEN", outcome: null, outcomeNote: null, closedAt: null,
  createdAt: "2026-08-10T00:00:00.000Z", offerId: "o1",
  raisedBy: { id: "w", name: "Pramod Nayak", homeState: "Odisha", phone: "9880030003" },
  actions: [], contract: CONTRACT,
} as unknown as Complaint;

const CLOSED = {
  ...OPEN, id: "k2", status: "RESOLVED", outcome: "UPHELD", outcomeNote: "Paid in full on 20 Aug.",
  raisedBy: { id: "w2", name: "Sanjay Kumar", homeState: "Bihar", phone: "9880030002" },
  category: "DAYS_DISPUTE", claimedAmount: 1600, contract: null,
} as unknown as Complaint;

const DISPUTE = { kind: "PAYMENT", id: "p1", review: null } as unknown as DisputedRecord;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.complaints).mockResolvedValue([OPEN, CLOSED]);
  vi.mocked(api.disputedRecords).mockResolvedValue([DISPUTE, { ...DISPUTE, id: "p2" }]);
});

async function open() {
  const view = render(
    <MemoryRouter>
      <ComplaintsPage user={OFFICER} />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "Complaints" });
  return view;
}

const caseOf = () => screen.getByRole("article", { name: /Pramod Nayak/ });

describe("Complaints page", () => {
  it("has one heading, and three counts of which the disputes are a link to their own page", async () => {
    await open();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Open cases").parentElement!.textContent).toContain("1");
    expect(screen.getByText("Closed").parentElement!.textContent).toContain("1");
    const link = screen.getByRole("link", { name: /Disputes waiting/ });
    expect(link.getAttribute("href")).toBe("/disputes");
    expect(link.textContent).toContain("2");
  });

  it("asks only for the disputes not yet reviewed, to count them", async () => {
    await open();
    expect(api.disputedRecords).toHaveBeenCalledWith();
    expect(api.disputedRecords).not.toHaveBeenCalledWith(true);
  });

  it("no longer holds the disputes as a second tab", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /Disputes \(/ })).toBeNull();
    expect(screen.queryByText(/Needing your attention/)).toBeNull();
  });

  it("names each open case by worker, home state and kind, and gives what he asks for", async () => {
    await open();
    const card = caseOf();
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe(
      "Pramod Nayak · Odisha · Wages not paid",
    );
    expect(card.textContent).toContain("he asks for ₹10,500");
    expect(card.textContent).toContain("I worked 15 days and received no payment.");
    expect(card.querySelector('a[href="tel:+919880030003"]')).not.toBeNull();
  });

  it("shows what the records show, and by how much the claim differs", async () => {
    await open();
    const card = caseOf();
    expect(card.textContent).toContain("What the records show");
    for (const t of ["Agreed daily rate", "Days recorded", "Wages earned", "Wages paid"]) {
      expect(within(card).getByText(t)).toBeTruthy();
    }
    expect(card.textContent).toContain("₹6,500 outstanding");
    expect(card.textContent).toMatch(
      /claims ₹10,500, but the records come to ₹6,500, a difference of ₹4,000/,
    );
    expect(card.textContent).toContain("never confirmed by the worker");
    expect(card.textContent).toContain("The worker disputes ₹4,000 of the payments recorded here.");
  });

  it("keeps the decision button off until the reason is ten characters", async () => {
    vi.mocked(api.decide).mockResolvedValue(OPEN);
    await open();
    const card = caseOf();
    fireEvent.click(within(card).getByRole("button", { name: "Issue a decision" }));
    const send = within(card).getByRole("button", { name: "Record the decision" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.change(within(card).getByLabelText(/Reason for the decision/), { target: { value: "too short" } });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText(/Reason for the decision/), {
      target: { value: "15 days at ₹700 are recorded and confirmed." },
    });
    expect(send.disabled).toBe(false);

    fireEvent.click(send);
    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith("k1", "UPHELD", "15 days at ₹700 are recorded and confirmed."),
    );
    await screen.findByText("Decision recorded, and the worker has been notified.");
    // The page loads again, so the card reflects the decision.
    await waitFor(() => expect(vi.mocked(api.complaints).mock.calls.length).toBeGreaterThan(1));
  });

  it("offers Cancel on every action, and goes back to the four choices", async () => {
    await open();
    const card = caseOf();
    fireEvent.click(within(card).getByRole("button", { name: "Record a call" }));
    expect(within(card).queryByRole("button", { name: "Issue a decision" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    for (const name of ["Request an explanation", "Record a call", "Issue a decision", "Forward to a higher office"]) {
      expect(within(card).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("forwards a case only with grounds, to the office he chose", async () => {
    vi.mocked(api.escalate).mockResolvedValue(OPEN);
    await open();
    const card = caseOf();
    fireEvent.click(within(card).getByRole("button", { name: "Forward to a higher office" }));
    fireEvent.change(within(card).getByLabelText(/Which office/), { target: { value: "POLICE" } });
    fireEvent.change(within(card).getByLabelText("Grounds for forwarding"), {
      target: { value: "Documents were withheld from the worker." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Forward the case" }));
    await waitFor(() =>
      expect(api.escalate).toHaveBeenCalledWith("k1", "POLICE", "Documents were withheld from the worker."),
    );
  });

  it("words every kind of action the server writes, and never shows a raw code", async () => {
    // The kinds are the ones routes/complaints.ts writes. "ASKED_EMPLOYER" was once
    // looked up as "ASK_EMPLOYER", so the officer read the code instead of the words.
    const by = { id: "o1", name: "Anita Joseph", role: "AUTHORITY" };
    const kinds = ["ASKED_EMPLOYER", "EMPLOYER_REPLY", "CALLED_WORKER", "CALLED_EMPLOYER", "MESSAGED_WORKER", "DECIDED", "ESCALATED"];
    const actions = kinds.map((kind, i) => ({
      id: `a${i}`, kind, note: `note ${i}`, author: by, createdAt: "2026-08-03T00:00:00.000Z",
      escalatedTo: kind === "ESCALATED" ? "POLICE" : null,
    }));
    vi.mocked(api.complaints).mockResolvedValue([{ ...OPEN, actions } as unknown as Complaint]);
    await open();
    const history = within(caseOf()).getByRole("heading", { name: "Case history" }).parentElement!;
    expect(history.textContent).toContain("You requested an explanation from the contractor");
    expect(history.textContent).toContain("The contractor responded");
    expect(history.textContent).toContain("You called the worker");
    expect(history.textContent).toContain("You called the contractor");
    expect(history.textContent).toContain("You sent the worker a message");
    expect(history.textContent).toContain("You issued a decision");
    expect(history.textContent).toContain("Escalated → Police");
    expect(history.textContent).not.toMatch(/[A-Z]+_[A-Z]+/);
  });

  it("loads the history of both parties only when he asks", async () => {
    await open();
    expect(api.trackRecord).not.toHaveBeenCalled();
    vi.mocked(api.trackRecord).mockResolvedValue({
      worker: { id: "w", name: "Pramod Nayak", history: { workRecordsConfirmed: 2, workRecordsDisputed: 0, workRecordsWaiting: 0, paymentsConfirmed: 0, paymentsDisputed: 0, paymentsWaiting: 0, complaintsFiled: 1, complaintsUpheld: 0, complaintsRejected: 0, complaintsUnproven: 0 } },
      contractor: { id: "c", name: "Suresh Menon", history: { paymentsTotal: 3, paymentsWithProof: 1, paymentsWithBankTrail: 1, paymentsWithCode: 0, paymentsNoProof: 2, paymentsDisputed: 1, workRecordsDisputed: 0, complaintsAgainst: 1, complaintsUpheld: 0, complaintsRejected: 0, complaintsUnproven: 0 } },
      caution: "A history is not evidence about this case.",
    } as never);
    fireEvent.click(within(caseOf()).getByRole("button", { name: "Show the history of both parties" }));
    await screen.findByText("A history is not evidence about this case.");
    expect(api.trackRecord).toHaveBeenCalledWith("o1");
  });

  it("keeps closed cases on the page, with the officer's note", async () => {
    await open();
    const closed = screen.getByRole("region", { name: "Cases you have closed" });
    expect(closed.textContent).toContain("Sanjay Kumar");
    expect(closed.textContent).toContain("Days worked disputed");
    expect(closed.textContent).toContain("Paid in full on 20 Aug.");
  });

  it("says plainly when no complaint is waiting", async () => {
    vi.mocked(api.complaints).mockResolvedValue([CLOSED]);
    await open();
    expect(screen.getByText("No complaints are awaiting your review.")).toBeTruthy();
  });

  it("says what went wrong when the caseload cannot be loaded, instead of staying blank", async () => {
    vi.mocked(api.complaints).mockRejectedValue(new Error("The server is not answering."));
    render(
      <MemoryRouter>
        <ComplaintsPage user={OFFICER} />
      </MemoryRouter>,
    );
    await screen.findByText("The server is not answering.");
    expect(screen.queryByText("Please wait…")).toBeNull();
  });

  it("uses no colour outside the theme, with an action form open", async () => {
    const { container } = await open();
    fireEvent.click(within(caseOf()).getByRole("button", { name: "Issue a decision" }));
    expect(container.innerHTML).not.toMatch(/(slate|rose|emerald|sky|amber|red|green|blue|violet)-\d/);
  });
});
