import type {
  Account,
  AuthUser,
  AwaitingItem,
  Complaint,
  ContractBalance,
  Disagreement,
  DiscoveryProfile,
  DisputedRecord,
  LedgerResponse,
  NearbyWork,
  Offer,
  Place,
  PlaceSource,
  PaymentRow,
  PendingCode,
  Person,
  TrackRecord,
  VerificationResult,
} from "./types";
import { SIGN_IN } from "./apps";
import { leaveTo } from "./leave";

// One key for all three apps. They share an origin, so signing in once at "/"
// is enough for whichever app the role opens.
const TOKEN_KEY = "wage-ledger-token";
const USER_KEY = "wage-ledger-user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * A failed request, with a fixed `code` the page can translate (ADR-0020).
 *
 * `code` is the server's own code when it sent one (docs/contracts/auth.md),
 * or one of these, set here:
 *   - NETWORK: the request never reached the server (no internet, the phone
 *     is offline, the server's machine is off);
 *   - SERVER: something answered, but not with the server's JSON, such as a
 *     proxy's error page while the API is down;
 *   - SESSION_ENDED: a signed-in request was refused because the session is
 *     no longer valid;
 *   - UNKNOWN: the server refused without a code. Most routes outside
 *     sign-in do not send codes yet, and their English message is kept in
 *     `message`, which the staff apps show as it is.
 *
 * `details` holds any other field the server sent, such as `minutesLeft`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thin wrapper over fetch. Attaches the token and turns every failure into an
 * ApiError, so every caller needs one try/catch.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch throws only when no answer came back at all. Its own message,
    // "Failed to fetch", means nothing to a worker.
    throw new ApiError("No internet connection.", "NETWORK", 0);
  }

  // Read as text first: a proxy in front of a stopped API answers with HTML
  // or with nothing, and JSON.parse would throw "Unexpected token '<'".
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }

  // A 401 means "your session ended" only for a request that carried a
  // session. A sign-in request has none, and its 401 is a wrong PIN, which
  // the page has to show instead of reloading itself (ADR-0020).
  if (res.status === 401 && token) {
    clearSession();
    leaveTo(SIGN_IN);
    throw new ApiError("Your session ended. Please sign in again.", "SESSION_ENDED", 401);
  }

  if (!res.ok) {
    if (body === null || typeof body.error !== "string") {
      throw new ApiError(`The server is not answering (${res.status}).`, "SERVER", res.status);
    }
    const { error, code, ...details } = body;
    throw new ApiError(error, typeof code === "string" ? code : "UNKNOWN", res.status, details);
  }

  return body as T;
}

export const api = {
  // --- signing in ----------------------------------------------------------
  login: (phone: string, pin: string) =>
    request<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, pin }),
    }),

  // --- phone codes, registration, forgot PIN (docs/contracts/auth.md) -----

  /**
   * Ask for a one-time code by SMS. The answer is the same whether or not the
   * number has an account, so it never tells anyone who is registered.
   */
  sendPhoneCode: (input: { phone: string; purpose: "REGISTER" | "RESET_PIN"; language?: string }) =>
    request<{ sent: boolean; expiresInMinutes: number }>("/api/auth/code", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  register: (input: {
    phone: string;
    code: string;
    name: string;
    homeState: string;
    pin: string;
    language?: string;
  }) =>
    request<{ token: string; user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  resetPin: (input: { phone: string; code: string; pin: string }) =>
    request<{ token: string; user: AuthUser }>("/api/auth/reset-pin", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Saves the signed-in user's language. The answer has a new token with it. ADR-0015. */
  setLanguage: (language: string) =>
    request<{ token: string; user: AuthUser }>("/api/auth/language", {
      method: "PATCH",
      body: JSON.stringify({ language }),
    }),

  // --- accounts made by the labour office (officer only) ------------------

  accounts: () => request<{ accounts: Account[] }>("/api/accounts").then((r) => r.accounts),

  /** Creates the account with no PIN. The owner sets it with "Forgot PIN". */
  createAccount: (input: {
    role: "CONTRACTOR" | "AUTHORITY";
    name: string;
    phone: string;
    company?: string;
  }) =>
    request<Account>("/api/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  states: () => request<{ state: string; language: string }[]>("/api/auth/states"),


  // --- offers and contracts ------------------------------------------------
  offers: (status?: string) =>
    request<Offer[]>(`/api/offers${status ? `?status=${status}` : ""}`),

  balances: () => request<ContractBalance[]>("/api/offers/balances"),

  findWorkers: (phone: string) =>
    request<Person[]>(`/api/offers/workers?phone=${encodeURIComponent(phone)}`),

  sendOffer: (input: {
    workerPhone: string;
    dailyRate: number;
    workType: string;
    siteName: string;
    startDate: string;
    expectedDays: number;
    extraTerms?: string;
  }) => request<Offer>("/api/offers", { method: "POST", body: JSON.stringify(input) }),

  respondToOffer: (id: string, decision: "ACCEPT" | "DECLINE", reason?: string) =>
    request(`/api/offers/${id}/respond`, {
      method: "PATCH",
      body: JSON.stringify({ decision, reason }),
    }),

  logWork: (input: {
    offerId: string;
    fromDate: string;
    toDate: string;
    days: number;
    note?: string;
  }) => request("/api/offers/work", { method: "POST", body: JSON.stringify(input) }),

  // --- worker confirmation -------------------------------------------------
  awaiting: () => request<AwaitingItem[]>("/api/offers/awaiting"),

  confirmRecord: (input: {
    kind: "WORK" | "PAYMENT";
    id: string;
    decision: "CONFIRM" | "REJECT";
    workerValue?: number;
    note?: string;
  }) => request("/api/offers/confirm", { method: "POST", body: JSON.stringify(input) }),

  // --- the contractor's side of a rejection --------------------------------

  /**
   * Records the worker rejected, on your own contracts.
   *
   * One call for both roles. The server scopes it by who is asking, and returns
   * the same fields either way, so the two parties can never be shown different
   * versions of the same disagreement.
   */
  disagreements: () => request<Disagreement[]>("/api/offers/disagreements"),

  /**
   * The contractor's written answer to one of those records.
   *
   * This changes no figure and does not clear the disagreement. It puts his
   * account on the file so the officer reads two statements instead of one.
   */
  writeStatement: (input: { kind: "WORK" | "PAYMENT"; id: string; note: string }) =>
    request<{ recorded: boolean; ref: string; message: string }>("/api/offers/statement", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // --- payments ------------------------------------------------------------

  /**
   * Record a payment with no proof attached.
   *
   * Separate from the two routes below because this one carries only the
   * contractor's word. The worker is texted and asked to confirm, so it can rise
   * to "confirmed later", but it starts as the weakest kind of record.
   */
  recordPayment: (input: {
    offerId: string;
    amount: number;
    paidOn: string;
    method: "CASH" | "UPI" | "BANK";
    note?: string;
  }) =>
    request<{ balance: ContractBalance; ref: string }>("/api/offers/payment", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  paymentHistory: (offerId?: string) =>
    request<PaymentRow[]>(`/api/payments/history${offerId ? `?offerId=${offerId}` : ""}`),

  requestCode: (offerId: string, amount: number) =>
    request<{
      sent: boolean;
      workerName: string;
      workerPhone: string;
      amount: number;
      expiresAt: string;
      expiresInMinutes: number;
      message: string;
    }>("/api/payments/code", { method: "POST", body: JSON.stringify({ offerId, amount }) }),

  pendingCode: () => request<PendingCode | null>("/api/payments/pending-code"),

  confirmCode: (input: { offerId: string; code: string; paidOn: string; note?: string }) =>
    request<{
      recorded: boolean;
      proofType: string;
      amount: number;
      workerName: string;
      ref: string;
      balance: ContractBalance;
      message: string;
    }>("/api/payments/confirm-code", { method: "POST", body: JSON.stringify(input) }),

  recordTransfer: (input: {
    offerId: string;
    amount: number;
    paidOn: string;
    method: "UPI" | "BANK";
    reference: string;
    note?: string;
  }) => request("/api/payments/reference", { method: "POST", body: JSON.stringify(input) }),

  // --- nearby search (docs/contracts/discovery.md) -------------------------

  /** Your own saved visibility, so the page opens where you left it. */
  discoveryMe: () => request<DiscoveryProfile>("/api/discovery/me"),

  /** Turn visibility on or off. The location is a chosen town, never a GPS reading. */
  discoveryToggle: (input: {
    looking: boolean;
    latitude?: number;
    longitude?: number;
    locationName?: string;
    preferredWorkType?: string;
  }) =>
    request<DiscoveryProfile>("/api/discovery/toggle", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Kerala towns matching what the worker typed. The server asks Photon. */
  searchPlaces: (q: string) =>
    request<{ places: Place[]; source: PlaceSource }>(
      `/api/discovery/places?q=${encodeURIComponent(q)}`,
    ),

  /** The town nearest a one-time "Use my location" reading. */
  nearestPlace: (lat: number, lng: number) =>
    request<{ place: Place | null; source: PlaceSource }>(
      `/api/discovery/places/nearest?lat=${lat}&lng=${lng}`,
    ),

  /** Worker only. Contractors hiring nearby, plus public business listings. */
  nearbyWork: (lat: number, lng: number, radiusKm = 25) =>
    request<NearbyWork>(`/api/discovery/nearby-work?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`),

  // --- complaints ----------------------------------------------------------
  complaintCategories: () =>
    request<{ id: string; label: string }[]>("/api/complaints/categories"),

  complaints: (status?: string) =>
    request<Complaint[]>(`/api/complaints${status ? `?status=${status}` : ""}`),

  /**
   * Disagreements needing the officer's attention. `reviewed` asks for the ones
   * her office has already closed, which is how a past decision stays findable.
   */
  disputedRecords: (reviewed = false) =>
    request<DisputedRecord[]>(
      `/api/complaints/disputed-records${reviewed ? "?reviewed=1" : ""}`,
    ),

  /** Mark a disagreement as no longer needing attention, with a reason. */
  reviewDispute: (input: {
    kind: "WORK" | "PAYMENT";
    id: string;
    reason: "SETTLED_OUTSIDE" | "DECIDED" | "NO_ACTION" | "UNPROVABLE";
    note: string;
  }) =>
    request<{ reviewed: boolean; message: string }>("/api/complaints/dispute-review", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Put it back on the list. Removes the note, changes no sealed figure. */
  reopenDispute: (kind: "WORK" | "PAYMENT", id: string) =>
    request<{ reopened: boolean; message: string }>(
      `/api/complaints/dispute-review?kind=${kind}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  trackRecord: (offerId: string) => request<TrackRecord>(`/api/complaints/track-record/${offerId}`),

  fileComplaint: (input: {
    offerId: string;
    category: string;
    description: string;
    language?: string;
    claimedAmount?: number;
  }) => request<Complaint>("/api/complaints", { method: "POST", body: JSON.stringify(input) }),

  askEmployer: (id: string, note: string) =>
    request<Complaint>(`/api/complaints/${id}/ask-employer`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  employerReply: (id: string, note: string) =>
    request<Complaint>(`/api/complaints/${id}/employer-reply`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  contact: (
    id: string,
    kind: "CALLED_WORKER" | "CALLED_EMPLOYER" | "MESSAGED_WORKER",
    note: string,
  ) =>
    request<Complaint>(`/api/complaints/${id}/contact`, {
      method: "POST",
      body: JSON.stringify({ kind, note }),
    }),

  decide: (
    id: string,
    outcome: "UPHELD" | "REJECTED" | "SETTLED" | "UNPROVEN",
    note: string,
  ) =>
    request<Complaint>(`/api/complaints/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ outcome, note }),
    }),

  escalate: (id: string, to: "LABOUR_COMMISSIONER" | "POLICE", note: string) =>
    request<Complaint>(`/api/complaints/${id}/escalate`, {
      method: "POST",
      body: JSON.stringify({ to, note }),
    }),

  // --- records -------------------------------------------------------------
  ledger: (workerId?: string) =>
    request<LedgerResponse>(`/api/ledger${workerId ? `?workerId=${workerId}` : ""}`),

  verify: () => request<VerificationResult>("/api/ledger/verify", { method: "POST" }),
};
