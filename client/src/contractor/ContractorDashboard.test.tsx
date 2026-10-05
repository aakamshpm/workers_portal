import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Complaint, ContractBalance, Offer, Person } from "../shared/types";

/**
 * My workers (design C1) on a 320px phone.
 *
 * What these tests guarantee:
 * - the page leads with the money still owed, in one panel, before the two
 *   counts (principle 11: wage proof first);
 * - the two forms are closed until he asks for one, so the list of his
 *   workers is near the top instead of four screens down;
 * - the worker list names each job by worker and site alone, because a native
 *   list cuts a longer option; the daily rate appears in the preview;
 * - in the preview, a sign and its amount never separate across two lines
 *   ("+" at the end of one line, "₹5,100" at the start of the next);
 * - an offer can be sent only to a worker the lookup found;
 * - the labour office's question is answered in the same page, and the answer
 *   button stays off until there is something to send;
 * - nothing uses a colour outside the theme.
 *
 * The API module is mocked. No test reaches the server, so no SMS is sent.
 */

vi.mock("../shared/api", () => ({
  api: {
    balances: vi.fn(),
    offers: vi.fn(),
    complaints: vi.fn(),
    disagreements: vi.fn(),
    findWorkers: vi.fn(),
    sendOffer: vi.fn(),
    logWork: vi.fn(),
    employerReply: vi.fn(),
  },
}));

import { api } from "../shared/api";
import ContractorDashboard from "./ContractorDashboard";

const BAL = {
  offerId: "o1", status: "ACCEPTED",
  worker: { id: "w", name: "Bijoy Das" }, contractor: { id: "c", name: "Ramesh Pillai", company: "Ramesh Builders" },
  dailyRate: 850, workType: "Steel binding", siteName: "Kakkanad Phase 2", startDate: "2026-07-06T00:00:00.000Z",
  expectedDays: 30, extraTerms: null, acceptedAt: "2026-07-04T00:00:00.000Z", acceptedVia: "SMS",
  daysWorked: 23, earned: 19550, paid: 16000, balance: 3550, daysConfirmed: 17.5, daysWaiting: 5.5, daysDisputed: 0,
  earnedConfirmed: 14875, paidConfirmed: 16000, paidWaiting: 0, paidDisputed: 0, awaitingConfirmation: 1,
  disputedRecords: 0, periodCount: 4, paymentCount: 2, lastPaymentOn: null, openComplaints: 0,
} as ContractBalance;

const PENDING = {
  id: "of2", status: "PENDING", dailyRate: 900, workType: "Mason", siteName: "Kaloor Metro",
  startDate: "2026-10-05T00:00:00.000Z", expectedDays: 24, extraTerms: null,
  createdAt: "2026-10-01T00:00:00.000Z", respondedAt: null, respondedVia: null, declineReason: null,
  worker: { id: "w2", name: "Manish Murmu" }, contractor: { id: "c", name: "Ramesh Pillai" }, ref: null,
} as Offer;

const COMPLAINT = {
  id: "k1", category: "UNPAID", description: "I think two days are missing from my payment.",
  language: "en", claimedAmount: 1600, status: "AWAITING_EMPLOYER", outcome: null, outcomeNote: null,
  closedAt: null, createdAt: "2026-08-02T00:00:00.000Z", offerId: "o1",
  raisedBy: { id: "w3", name: "Sanjay Kumar" },
  actions: [{ kind: "ASK_EMPLOYER", note: "Please check your register." }], contract: null,
} as unknown as Complaint;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.balances).mockResolvedValue([BAL]);
  vi.mocked(api.offers).mockResolvedValue([PENDING]);
  vi.mocked(api.complaints).mockResolvedValue([COMPLAINT]);
  vi.mocked(api.disagreements).mockResolvedValue([]);
  vi.mocked(api.findWorkers).mockResolvedValue([]);
});

async function open() {
  const view = render(<ContractorDashboard onGoToPayment={() => {}} />);
  await screen.findByText("Your workers");
  return view;
}

describe("My workers on a phone", () => {
  it("leads with the money still owed, in one panel, before the two counts", async () => {
    await open();
    const panel = screen.getByRole("region", { name: "Wages outstanding" });
    expect(panel.textContent).toContain("₹3,550");
    expect(panel.className).toContain("bg-primary");
    // The panel comes before the counts in the page.
    const hired = screen.getByText("Workers hired");
    expect(panel.compareDocumentPosition(hired) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hired.parentElement!.textContent).toContain("1");
    expect(screen.getByText("Awaiting a reply").parentElement!.textContent).toContain("1");
  });

  it("keeps both forms closed until he asks for one", async () => {
    await open();
    expect(screen.queryByPlaceholderText("10-digit phone number")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();

    const offer = screen.getByRole("button", { name: "Offer work" });
    const write = screen.getByRole("button", { name: "Write down work" });
    expect(offer.getAttribute("aria-expanded")).toBe("false");
    expect(write.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(offer);
    expect(screen.getByPlaceholderText("10-digit phone number")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-expanded")).toBe("true");

    // One form at a time, so the list of workers stays near the top of the phone.
    fireEvent.click(write);
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByPlaceholderText("10-digit phone number")).toBeNull();
    expect(screen.getByRole("button", { name: "Offer work" })).toBeTruthy();
  });

  it("closes a form again with Cancel", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Offer work" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("10-digit phone number")).toBeNull();
  });
});

describe("Write down work done", () => {
  async function openWork() {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Write down work" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "o1" } });
  }

  it("names each job by worker and site, and puts the daily rate in the preview", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Write down work" }));
    const options = within(screen.getByRole("combobox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Choose a worker…", "Bijoy Das · Kakkanad Phase 2"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "o1" } });
    expect(screen.getByText(/This record: 6 days at ₹850 a day/)).toBeTruthy();
  });

  it("shows the figure before and after, and keeps each sign with its amount", async () => {
    await openWork();
    expect(screen.getByText(/Already recorded: 23 days/)).toBeTruthy();
    // getByText folds a no-break space into a plain one, so compare the raw text.
    const amount = (text: string) =>
      Array.from(document.querySelectorAll("dd")).find((d) => d.textContent === text)!;
    const added = amount("+\u00a0₹5,100");
    const paid = amount("−\u00a0₹16,000");
    expect(added).toBeTruthy();
    expect(paid).toBeTruthy();
    // A sign that could end one line while its amount starts the next reads as two different numbers.
    expect(added.className).toContain("whitespace-nowrap");
    expect(paid.className).toContain("whitespace-nowrap");
    const after = screen.getByText("Will be outstanding").parentElement!;
    expect(after.textContent).toContain("₹8,650");
  });

  it("sends the record with the dates and days he typed", async () => {
    vi.mocked(api.logWork).mockResolvedValue(undefined as never);
    await openWork();
    const [from] = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=date]"));
    fireEvent.change(from!, { target: { value: "2026-08-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Record this work" }));
    await waitFor(() =>
      expect(api.logWork).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: "o1", fromDate: "2026-08-03", days: 6 }),
      ),
    );
    await screen.findByText(/Bijoy Das has been asked if it is correct/);
  });
});

describe("Offer work", () => {
  const WORKER = { id: "w", name: "Bijoy Das", homeState: "West Bengal" } as Person;

  async function openOffer() {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Offer work" }));
  }

  it("cannot be sent until the lookup finds the worker", async () => {
    await openOffer();
    const send = screen.getByRole("button", { name: "Send the offer" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    vi.mocked(api.findWorkers).mockResolvedValue([WORKER]);
    fireEvent.change(screen.getByPlaceholderText("10-digit phone number"), { target: { value: "9880030001" } });
    await screen.findByText("Found: Bijoy Das from West Bengal");
    expect((send as HTMLButtonElement).disabled).toBe(false);
    expect(api.findWorkers).toHaveBeenCalledWith("9880030001");
  });

  it("says plainly when no worker has the number", async () => {
    await openOffer();
    fireEvent.change(screen.getByPlaceholderText("10-digit phone number"), { target: { value: "9880099999" } });
    await screen.findByText("No worker has this number. Ask him to make an account first.");
  });

  it("shows the full contract value as he types the rate", async () => {
    await openOffer();
    fireEvent.change(screen.getByPlaceholderText("750"), { target: { value: "900" } });
    const line = screen.getByText(/the full contract comes to about/);
    expect(line.textContent).toContain("₹21,600");
    // The amount is one unit, so it never breaks across two lines.
    expect(line.querySelector(".whitespace-nowrap")!.textContent).toBe("₹21,600");
  });
});

describe("Answering the labour office", () => {
  it("shows the question, and keeps the answer button off until there is an answer", async () => {
    vi.mocked(api.employerReply).mockResolvedValue(undefined as never);
    await open();
    const card = screen.getByRole("region", { name: "The labour office has asked you to respond" });
    expect(within(card).getByText(/Please check your register/)).toBeTruthy();
    const send = within(card).getByRole("button", { name: "Send my answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "The register shows 12 days." } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(api.employerReply).toHaveBeenCalledWith("k1", "The register shows 12 days."));
  });
});

describe("the rest of the page", () => {
  it("lists offers awaiting a reply with the badge under the text", async () => {
    await open();
    const card = screen.getByRole("region", { name: "Offers awaiting a reply" });
    const row = within(card).getByText(/Manish Murmu · Kaloor Metro/).closest("li")!;
    expect(row.textContent).toContain("₹900 a day");
    const badge = within(row).getByText("Waiting for the worker");
    // Under the text, not pushed to the far edge where it reads as a separate item.
    expect(badge.parentElement!.className).not.toContain("justify-between");
    expect(row.className).toContain("flex-col");
  });

  it("uses no colour outside the theme, with a form open", async () => {
    const { container } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Write down work" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "o1" } });
    expect(container.innerHTML).not.toMatch(/(slate|rose|emerald|sky|amber|red|green|blue)-\d/);
  });
});
