import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AwaitingItem, Offer } from "../shared/types";

/**
 * Worker home page in the worker's language. ADR-0015.
 *
 * What these tests guarantee:
 * - the offer, its buttons and its status badge are in the worker's language,
 *   because this is the screen where he locks the daily pay;
 * - the SMS reply hint keeps YES and the 4-digit reference unchanged, because
 *   the server reads only those words in a reply;
 * - the "please check" row and its OK / WRONG hint are in his language;
 * - the money and the day count are the real figures, not lost in translation.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../shared/api", () => ({
  api: {
    offers: vi.fn(),
    awaiting: vi.fn(),
    balances: vi.fn(),
    disagreements: vi.fn(),
    respondToOffer: vi.fn(),
    confirmRecord: vi.fn(),
  },
}));

import { api } from "../shared/api";
import { DICTIONARIES, I18nProvider, translate } from "../shared/i18n";
import { en } from "../shared/i18n/en";
import WorkerDashboard from "./WorkerDashboard";

const mocked = vi.mocked(api);
const bn = DICTIONARIES.bn;

const OFFER: Offer = {
  id: "o1",
  status: "PENDING",
  dailyRate: 900,
  workType: "Mason",
  siteName: "Aluva site",
  startDate: "2026-10-01T00:00:00.000Z",
  expectedDays: 20,
  extraTerms: null,
  createdAt: "2026-09-26T00:00:00.000Z",
  respondedAt: null,
  respondedVia: null,
  declineReason: null,
  worker: { id: "w", name: "Ramu" },
  contractor: { id: "c", name: "Joseph", company: "JV Builders" },
  ref: "4821",
};

const WORK: AwaitingItem = {
  kind: "WORK",
  id: "wp1",
  offerId: "o0",
  siteName: "Kakkanad site",
  contractorName: "Joseph",
  company: null,
  recordedAt: "2026-09-25T00:00:00.000Z",
  ref: "7314",
  note: null,
  days: 6,
  fromDate: "2026-09-19T00:00:00.000Z",
  toDate: "2026-09-24T00:00:00.000Z",
  worth: 5400,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.offers.mockResolvedValue([OFFER]);
  mocked.awaiting.mockResolvedValue([WORK]);
  mocked.balances.mockResolvedValue([]);
  mocked.disagreements.mockResolvedValue([]);
});

function renderIn(language: "bn" | "en") {
  render(
    <I18nProvider initial={language}>
      <WorkerDashboard user={{ id: "w", name: "Ramu", phone: "9845687924", role: "WORKER" }} />
    </I18nProvider>,
  );
}

describe("worker home in Bengali", () => {
  it("shows the offer, its buttons and its badge in Bengali", async () => {
    renderIn("bn");
    expect(await screen.findByText(bn.offerTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.yesTakeWork })).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.noDontWant })).toBeTruthy();
    expect(screen.getByText(bn.offerPending)).toBeTruthy();
    expect(screen.queryByText(/Yes, I will take this work/)).toBeNull();
  });

  it("keeps YES and the reference in the SMS hint", async () => {
    renderIn("bn");
    const hint = await screen.findByText(translate("bn", "replyYesSms", { ref: "4821" }));
    expect(hint.textContent).toMatch(/\bYES 4821\b/);
  });

  it("shows the real total pay for the offer", async () => {
    renderIn("bn");
    await screen.findByText(bn.offerTitle);
    expect(document.body.textContent).toContain("₹18,000");
  });

  it("shows the work row to check, with OK and WRONG kept, in Bengali", async () => {
    renderIn("bn");
    expect(await screen.findByText(translate("bn", "heSaysDays", { days: "6" }))).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.yesCorrect })).toBeTruthy();
    const hint = screen.getByText(translate("bn", "replyOkWrongSms", { ref: "7314" }));
    expect(hint.textContent).toMatch(/\bOK 7314\b/);
    expect(hint.textContent).toMatch(/\bWRONG 7314\b/);
  });

  it("asks for his own number in Bengali when he says the days are wrong", async () => {
    renderIn("bn");
    fireEvent.click(await screen.findByRole("button", { name: bn.noNotCorrect }));
    // The field's label element also holds the hint, so match the question as a part.
    expect(screen.getByLabelText(bn.realDays, { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.sendMyAnswer })).toBeTruthy();
  });
});

describe("worker home in English", () => {
  it("still reads as before", async () => {
    renderIn("en");
    expect(await screen.findByRole("button", { name: "Yes, I will take this work" })).toBeTruthy();
    expect(screen.getByText("He says you worked this many days: 6")).toBeTruthy();
  });
});

/**
 * The look of the worker home on a phone (design W1, ADR-0019).
 *
 * What these tests guarantee: the money he is owed sits in the design's
 * primary panel, not the old black one; the two answers to a record are the
 * same width and fill the row, so the longer one never sits alone on a
 * second line; and nothing on the page uses a colour outside the theme.
 */
describe("worker home on a phone", () => {
  const BAL = {
    offerId: "o0", status: "ACCEPTED",
    worker: { id: "w", name: "Ramu" }, contractor: { id: "c", name: "Joseph", company: null },
    dailyRate: 900, workType: "Mason", siteName: "Kakkanad site", startDate: "2026-09-01T00:00:00.000Z",
    expectedDays: 20, extraTerms: null, acceptedAt: "2026-09-01T00:00:00.000Z", acceptedVia: "SMS",
    daysWorked: 6, earned: 5400, paid: 0, balance: 5400, daysConfirmed: 0, daysWaiting: 6, daysDisputed: 0,
    earnedConfirmed: 0, paidConfirmed: 0, paidWaiting: 0, paidDisputed: 0, awaitingConfirmation: 1,
    disputedRecords: 0, periodCount: 1, paymentCount: 0, lastPaymentOn: null, openComplaints: 0,
  };

  it("shows what he is owed in the design's primary panel", async () => {
    mocked.balances.mockResolvedValue([BAL] as never);
    renderIn("en");
    const owed = await screen.findByRole("region", { name: /still owed/i });
    expect(owed.className).toContain("bg-primary");
    expect(owed.textContent).toContain("₹5,400");
  });

  it("gives both answers to a record the same width, side by side", async () => {
    renderIn("en");
    const yes = await screen.findByRole("button", { name: "Yes, that is correct" });
    const no = screen.getByRole("button", { name: "No, that is not correct" });
    expect(yes.parentElement).toBe(no.parentElement);
    expect(yes.parentElement!.className).toContain("grid-cols-2");
    for (const b of [yes, no]) expect(b.className).toContain("w-full");
  });

  it("writes no colour outside the theme", async () => {
    mocked.balances.mockResolvedValue([BAL] as never);
    const { container } = render(
      <I18nProvider initial="en">
        <WorkerDashboard user={{ id: "w", name: "Ramu", phone: "9845687924", role: "WORKER" }} />
      </I18nProvider>,
    );
    await screen.findByText(en.offerTitle);
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-/);
  });
});
