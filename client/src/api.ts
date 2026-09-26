import type {
  AuthUser,
  AwaitingItem,
  Complaint,
  ContractBalance,
  Disagreement,
  DirectoryAccount,
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
  SmsInbox,
  TrackRecord,
  VerificationResult,
} from "./types";

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
 * Thin wrapper over fetch. Attaches the token and turns a non-2xx response into a
 * thrown Error carrying the server's own message, so every caller needs one
 * try/catch and can show `err.message` directly.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    // Token expired or invalid. Drop it and go to the sign-in screen rather than
    // looping on failed requests. `replace` is used so the page that failed does
    // not stay in the browser's history and catch the Back button.
    clearSession();
    window.location.replace("/login");
    throw new Error("Your session ended. Please sign in again.");
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(body?.error ?? `Something went wrong (${res.status})`);
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

  register: (input: { name: string; phone: string; pin: string; homeState?: string }) =>
    request<{ token: string; user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  states: () => request<{ state: string; language: string }[]>("/api/auth/states"),

  demoAccounts: () => request<DirectoryAccount[]>("/api/auth/demo-accounts"),

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

  // --- SMS simulation ------------------------------------------------------
  sms: () => request<SmsInbox>("/api/sms"),

  smsReply: (body: string) =>
    request<{ understood: boolean; intent?: string; message?: string; ref?: string }>(
      "/api/sms/reply",
      { method: "POST", body: JSON.stringify({ body }) },
    ),

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
