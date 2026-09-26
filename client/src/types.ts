export type Role = "CONTRACTOR" | "WORKER" | "AUTHORITY";

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  language?: string | null;
  homeState?: string | null;
  company?: string | null;
}

/**
 * One row on the login screen's "accounts to try" list.
 *
 * Distinct from AuthUser because this is never a signed-in session - it is a
 * directory entry, and `selfRegistered` only makes sense in that context. A
 * seeded account (false) uses the shared PIN 1234 and can sign in with one
 * click. A worker who registered himself (true) chose his own PIN, so his row
 * is shown to save hunting for the phone number, but clicking it still asks
 * for the PIN rather than pretending to sign him in.
 */
export interface DirectoryAccount extends AuthUser {
  selfRegistered: boolean;
}

export interface Person {
  id: string;
  name: string;
  phone?: string;
  homeState?: string | null;
  language?: string | null;
  company?: string | null;
}

export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";

export interface Offer {
  id: string;
  status: OfferStatus;
  dailyRate: number;
  workType: string;
  siteName: string;
  startDate: string;
  expectedDays: number;
  extraTerms: string | null;
  createdAt: string;
  respondedAt: string | null;
  respondedVia: string | null;
  declineReason: string | null;
  worker: Person;
  contractor: Person;
  ref: string | null;
}

/**
 * The money on one contract.
 *
 * Note the split fields. The total is what the contractor recorded; the
 * confirmed figures are what the worker has agreed to. Showing only the total
 * would present one side's claim as a fact.
 */
export interface ContractBalance {
  offerId: string;
  status: string;
  worker: Person;
  contractor: Person;

  dailyRate: number;
  workType: string;
  siteName: string;
  startDate: string;
  expectedDays: number;
  extraTerms: string | null;

  acceptedAt: string | null;
  acceptedVia: string | null;

  daysWorked: number;
  earned: number;
  paid: number;
  balance: number;

  daysConfirmed: number;
  daysWaiting: number;
  daysDisputed: number;
  earnedConfirmed: number;

  paidConfirmed: number;
  paidWaiting: number;
  paidDisputed: number;

  awaitingConfirmation: number;
  disputedRecords: number;

  periodCount: number;
  paymentCount: number;
  lastPaymentOn: string | null;
  openComplaints: number;
}

/** A work or payment record waiting for the worker to answer. */
export interface AwaitingItem {
  kind: "WORK" | "PAYMENT";
  id: string;
  offerId: string;
  siteName: string;
  contractorName: string;
  company: string | null;
  recordedAt: string;
  ref: string | null;
  note: string | null;
  // WORK only
  days?: number;
  fromDate?: string;
  toDate?: string;
  worth?: number;
  // PAYMENT only
  amount?: number;
  paidOn?: string;
  method?: string;
}

export type RecordType =
  | "OFFER"
  | "ACCEPT"
  | "WORK"
  | "PAYMENT"
  | "CONFIRM"
  | "DISPUTE"
  | "EMPLOYER_NOTE";

export interface LedgerEntry {
  id: string;
  chainIndex: number;
  recordType: RecordType;
  recordId: string;
  workerId: string;
  summary: string;
  createdAt: string;
  previousHash: string;
  currentHash: string;
}

export interface LedgerResponse {
  genesisHash: string;
  entries: LedgerEntry[];
}

export interface ChainFailure {
  chainIndex: number;
  entryId: string;
  recordType: string;
  summary: string;
  problem: "HASH_MISMATCH" | "BROKEN_LINK" | "INDEX_GAP" | "RECORD_MISSING";
  expected: string;
  found: string;
  detail: string;
  changedFields?: { field: string; original: string; current: string }[];
}

export interface VerificationResult {
  valid: boolean;
  entriesChecked: number;
  failures: ChainFailure[];
  checkedAt: string;
}

export interface SmsMessage {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  /**
   * The same message in English. Null when `body` is already English, so a null
   * here means there is nothing to translate rather than that a translation is
   * missing.
   */
  bodyEn: string | null;
  language: string;
  kind: string;
  reference: string | null;
  createdAt: string;
}

// --- discovery (docs/contracts/discovery.md) --------------------------------

/**
 * What GET /me and POST /toggle both return. The location is a chosen town
 * (ADR-0011), never the phone's exact position.
 */
export interface DiscoveryProfile {
  looking: boolean;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  preferredWorkType: string | null;
}

/** A Kerala town, from Photon or from the district-town fallback (ADR-0010). */
export interface Place {
  name: string;
  /** Taluk or district, to tell two towns with the same name apart. */
  area: string | null;
  latitude: number;
  longitude: number;
}

export type PlaceSource = "photon" | "fallback";

export interface NearbyContractor {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  preferredWorkType: string | null;
  distanceKm: number;
}

/** A business on the public map. Not a job, and the page must say so. */
export interface NearbyBusiness {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  distanceKm: number;
  source: "public_listing";
}

export interface NearbyWork {
  contractors: NearbyContractor[];
  businesses: NearbyBusiness[];
}

export interface SmsInbox {
  simulated: boolean;
  phone: string;
  messages: SmsMessage[];
  awaitingReply: string[];
}

export type ComplaintStatus =
  | "OPEN"
  | "AWAITING_EMPLOYER"
  | "RESOLVED"
  | "REJECTED"
  | "ESCALATED"
  | "CLOSED_UNPROVEN";

export interface ComplaintAction {
  id: string;
  kind: string;
  note: string;
  escalatedTo: string | null;
  createdAt: string;
  author: { id: string; name: string; role: string };
}

export interface Complaint {
  id: string;
  category: string;
  description: string;
  language: string;
  claimedAmount: number | null;
  status: ComplaintStatus;
  outcome: string | null;
  outcomeNote: string | null;
  closedAt: string | null;
  createdAt: string;
  offerId: string;
  raisedBy: Person;
  actions: ComplaintAction[];
  contract: ContractBalance | null;
}

/** A record the worker rejected. Reaches the officer without a written complaint. */
/**
 * The contractor's sealed answer to a record his worker rejected.
 *
 * Null means he has not answered. That is not the same as agreeing, and the
 * officer's screen says so, because an unanswered rejection and an explained one
 * call for different handling.
 */
export interface EmployerStatement {
  note: string;
  at: string;
}

/**
 * A labour officer's record that a disagreement no longer needs attention.
 *
 * Null means nobody has looked at it yet, which is what keeps it in her queue.
 * This never changes the two figures the parties gave, and it is not part of the
 * hash chain: it is case handling, not evidence.
 */
export interface DisputeReview {
  reason: "SETTLED_OUTSIDE" | "DECIDED" | "NO_ACTION" | "UNPROVABLE";
  note: string;
  at: string;
  officer: { id: string; name: string };
}

/** A complaint on the same contract that has already been closed. */
export interface RelatedComplaint {
  status: string;
  outcome: string | null;
  note: string | null;
  closedAt: string | null;
}

export interface DisputedRecord {
  kind: "WORK" | "PAYMENT";
  id: string;
  offerId: string;
  siteName: string;
  worker: Person;
  contractor: Person;
  contractorSays: string;
  workerSays: string;
  gapValue: number | null;
  period: string;
  note: string | null;
  via: string | null;
  at: string | null;
  employerStatement: EmployerStatement | null;
  review: DisputeReview | null;
  relatedComplaint: RelatedComplaint | null;
}

/**
 * A record the worker rejected, as one of the two parties sees it.
 *
 * The same object is sent to the worker and to the contractor, with neutral field
 * names, because both of them must be shown the same facts. Only the wording on
 * screen differs by reader.
 */
export interface Disagreement {
  kind: "WORK" | "PAYMENT";
  id: string;
  offerId: string;
  siteName: string;
  worker: Person;
  contractor: Person;
  period: string;
  /** What the contractor recorded: days for WORK, rupees for PAYMENT. */
  contractorSays: string;
  /** What the worker says instead, or "no figure given" after an SMS rejection. */
  workerSays: string;
  /** Rupees the disagreement is worth. Null when the worker gave no figure. */
  gapValue: number | null;
  workerNote: string | null;
  at: string | null;
  via: string | null;
  employerStatement: EmployerStatement | null;
  /** Null until a labour officer has looked at it. */
  review: DisputeReview | null;
}

/** How strongly a payment can be shown to have happened. */
export type Evidence = "strong" | "good" | "weak" | "none" | "disputed";

export interface PaymentRow {
  id: string;
  offerId: string;
  siteName: string;
  worker: Person;
  contractor: Person;
  amount: number;
  paidOn: string;
  method: string;
  note: string | null;
  confirmState: "WAITING" | "CONFIRMED" | "DISPUTED";
  confirmedVia: string | null;
  workerClaimsAmount: number | null;
  disputeNote: string | null;
  proofType: "NONE" | "CODE" | "REFERENCE";
  proofReference: string | null;
  proofAt: string | null;
  evidence: Evidence;
}

export interface PendingCode {
  offerId: string;
  amount: number;
  expiresAt: string;
  workerId: string;
  worker: { name: string; phone: string } | null;
}

export interface TrackRecord {
  worker: Person & {
    history: {
      workRecordsConfirmed: number;
      workRecordsDisputed: number;
      workRecordsWaiting: number;
      paymentsConfirmed: number;
      paymentsDisputed: number;
      paymentsWaiting: number;
      complaintsFiled: number;
      complaintsUpheld: number;
      complaintsRejected: number;
      complaintsUnproven: number;
    };
  };
  contractor: Person & {
    history: {
      paymentsTotal: number;
      paymentsWithProof: number;
      paymentsWithBankTrail: number;
      paymentsWithCode: number;
      paymentsNoProof: number;
      paymentsDisputed: number;
      workRecordsDisputed: number;
      complaintsAgainst: number;
      complaintsUpheld: number;
      complaintsRejected: number;
      complaintsUnproven: number;
    };
  };
  caution: string;
}
