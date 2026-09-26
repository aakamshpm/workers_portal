import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type { AuthUser, Complaint, DisputedRecord, TrackRecord } from "../shared/types";
import {
  Button,
  Card,
  ComplaintBadge,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  formatDateTime,
  formatDays,
  formatRupees,
  InfoNote,
  inputClass,
  PhoneLink,
  SuccessNote,
} from "../shared/components/ui";

/**
 * Case types as an officer would name them in a file note. The worker sees the
 * same six categories in his own words on the complaint page; these are the
 * official equivalents.
 */
const CATEGORY_LABEL: Record<string, string> = {
  UNPAID: "Wages not paid",
  UNDERPAID: "Wages underpaid",
  RATE_DISPUTE: "Agreed rate disputed",
  DAYS_DISPUTE: "Days worked disputed",
  CONDITIONS: "Working or living conditions",
  OTHER: "Other",
};

/** The case history, worded as an officer would record it. */
const ACTION_LABEL: Record<string, string> = {
  ASK_EMPLOYER: "You requested an explanation from the contractor",
  EMPLOYER_REPLY: "The contractor responded",
  CALLED_WORKER: "You called the worker",
  CALLED_EMPLOYER: "You called the contractor",
  MESSAGED_WORKER: "You sent the worker a message",
  DECIDED: "You issued a decision",
  ESCALATED: "Escalated",
};

/**
 * The labour officer's desk.
 *
 * Two queues, because complaints arrive two ways. A written complaint is one. The
 * other is a record the worker rejected without filing anything: that
 * disagreement is already in the data, and making the officer wait for a formal
 * complaint would waste the signal.
 */
export default function AuthorityDashboard({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<"complaints" | "disputes">("complaints");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [disputes, setDisputes] = useState<DisputedRecord[]>([]);
  // Reviewed disagreements are fetched separately, so the working queue stays
  // short while a past decision remains findable.
  const [reviewed, setReviewed] = useState<DisputedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [c, d, r] = await Promise.all([
        api.complaints(),
        api.disputedRecords(),
        api.disputedRecords(true),
      ]);
      setComplaints(c);
      setDisputes(d);
      setReviewed(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the caseload. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  const open = complaints.filter(
    (c) => c.status === "OPEN" || c.status === "AWAITING_EMPLOYER" || c.status === "ESCALATED",
  );
  const closed = complaints.filter(
    (c) => c.status === "RESOLVED" || c.status === "REJECTED" || c.status === "CLOSED_UNPROVEN",
  );

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open cases" value={String(open.length)} tone="text-amber-700" />
        <Stat label="Disputes waiting" value={String(disputes.length)} tone="text-rose-700" />
        <Stat label="Closed" value={String(closed.length)} />
      </div>

      <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
        {(
          [
            { id: "complaints", label: `Complaints (${open.length})` },
            { id: "disputes", label: `Disputes (${disputes.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
              tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "complaints" ? (
        <>
          {open.length === 0 ? (
            <Card>
              <EmptyState>No complaints are awaiting your review.</EmptyState>
            </Card>
          ) : (
            <div className="space-y-4">
              {open.map((c) => (
                <ComplaintCase
                  key={c.id}
                  complaint={c}
                  officer={user}
                  onDone={(msg) => {
                    setFlash(msg);
                    void load();
                  }}
                  onError={setError}
                />
              ))}
            </div>
          )}

          {closed.length > 0 && (
            <Card title="Cases you have closed">
              <ul className="divide-y divide-slate-200">
                {closed.map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-900">
                        {c.raisedBy.name} · {CATEGORY_LABEL[c.category] ?? c.category}
                        {c.claimedAmount ? ` · asked for ${formatRupees(c.claimedAmount)}` : ""}
                      </p>
                      <ComplaintBadge status={c.status} audience="official" />
                    </div>
                    {c.outcomeNote && (
                      <p className="mt-1 text-xs text-slate-600">{c.outcomeNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card
            title={`Needing your attention (${disputes.length})`}
            description="No complaint was filed for these. The worker was asked to confirm a record and rejected it, so the disagreement is already on file."
          >
            {disputes.length === 0 ? (
              <EmptyState>Nothing is waiting for you here.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-200">
                {disputes.map((d) => (
                  <DisputeRow
                    key={`${d.kind}-${d.id}`}
                    d={d}
                    onDone={(msg) => {
                      setFlash(msg);
                      void load();
                    }}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </Card>

          {/* Kept on the page rather than hidden, because "has my office already
            * dealt with this contractor" is the question this whole feature
            * exists to answer. */}
          {reviewed.length > 0 && (
            <Card
              title={`Already dealt with (${reviewed.length})`}
              description="These still show that the two sides disagreed. They are off the list above because an officer has looked at them and said why."
            >
              <ul className="divide-y divide-slate-200">
                {reviewed.map((d) => (
                  <DisputeRow
                    key={`${d.kind}-${d.id}`}
                    d={d}
                    onDone={(msg) => {
                      setFlash(msg);
                      void load();
                    }}
                    onError={setError}
                  />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

/** One complaint, its evidence, and every action the officer can take on it. */
function ComplaintCase({
  complaint: c,
  officer,
  onDone,
  onError,
}: {
  complaint: Complaint;
  officer: AuthUser;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [action, setAction] = useState<"" | "ask" | "contact" | "decide" | "escalate">("");
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState("");
  const [contactKind, setContactKind] =
    useState<"CALLED_WORKER" | "CALLED_EMPLOYER" | "MESSAGED_WORKER">("CALLED_EMPLOYER");
  const [outcome, setOutcome] = useState<"UPHELD" | "REJECTED" | "SETTLED" | "UNPROVEN">("UPHELD");
  const [escalateTo, setEscalateTo] = useState<"LABOUR_COMMISSIONER" | "POLICE">(
    "LABOUR_COMMISSIONER",
  );

  const b = c.contract;

  async function loadTrack() {
    try {
      setTrack(await api.trackRecord(c.offerId));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load their history. Please try again.");
    }
  }

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      onDone(msg);
      setAction("");
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {c.raisedBy.name}
              {c.raisedBy.homeState ? ` · ${c.raisedBy.homeState}` : ""}
              {" · "}
              {CATEGORY_LABEL[c.category] ?? c.category}
            </p>
            <p className="text-xs text-slate-500">
              Sent {formatDate(c.createdAt)} · written in {c.language.toUpperCase()} · his number is{" "}
              {c.raisedBy.phone && <PhoneLink phone={c.raisedBy.phone} />}
            </p>
          </div>
          <div className="text-right">
            <ComplaintBadge status={c.status} audience="official" />
            {c.claimedAmount !== null && (
              <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                he asks for {formatRupees(c.claimedAmount)}
              </p>
            )}
          </div>
        </div>

        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {c.description}
        </p>
      </div>

      {/* The contract's own figures. Without these the officer is judging a
          claim against nothing. */}
      {b && (
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            What the records show
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Item label="Agreed daily rate" value={formatRupees(b.dailyRate)} />
            <Item label="Days recorded" value={formatDays(b.daysWorked)} />
            <Item label="Wages earned" value={formatRupees(b.earned)} />
            <Item label="Wages paid" value={formatRupees(b.paid)} />
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p
              className={`text-sm font-semibold tabular-nums ${
                b.balance > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {b.balance > 0
                ? `${formatRupees(b.balance)} outstanding`
                : b.balance < 0
                  ? `Overpaid by ${formatRupees(-b.balance)}`
                  : "Nothing outstanding"}
            </p>
            <span className="text-xs text-slate-400">
              {b.contractor.name}
              {b.contractor.company ? ` · ${b.contractor.company}` : ""}
              {b.contractor.phone && (
                <>
                  {" · "}
                  <PhoneLink phone={b.contractor.phone} />
                </>
              )}
            </span>
          </div>

          {c.claimedAmount !== null && Math.abs(c.claimedAmount - b.balance) > 1 && (
            <InfoNote>
              The worker claims {formatRupees(c.claimedAmount)}, but the records come to{" "}
              {formatRupees(b.balance)}, a difference of{" "}
              {formatRupees(Math.abs(c.claimedAmount - b.balance))}. Put this to him before you
              decide.
            </InfoNote>
          )}

          {b.awaitingConfirmation > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {b.awaitingConfirmation} record{b.awaitingConfirmation === 1 ? "" : "s"} on this
              contract {b.awaitingConfirmation === 1 ? "was" : "were"} never confirmed by the
              worker, so {b.awaitingConfirmation === 1 ? "it rests" : "they rest"} on the
              contractor's word alone.
            </p>
          )}
          {b.paidDisputed > 0 && (
            <p className="mt-1 text-xs text-rose-700">
              The worker disputes {formatRupees(b.paidDisputed)} of the payments recorded here.
            </p>
          )}
        </div>
      )}

      {/* What has happened on the case so far. */}
      {c.actions.length > 0 && (
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Case history
          </p>
          <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
            {c.actions.map((a) => (
              <li key={a.id} className="text-xs">
                <span className="font-medium text-slate-800">{ACTION_LABEL[a.kind] ?? a.kind}</span>
                {a.escalatedTo && (
                  <span className="text-violet-700">
                    {" → "}
                    {a.escalatedTo === "POLICE" ? "Police" : "Labour Commissioner"}
                  </span>
                )}
                <span className="text-slate-400">
                  {" · "}
                  {a.author.name} · {formatDate(a.createdAt)}
                </span>
                {a.note && <p className="mt-0.5 text-slate-600">{a.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Track record, loaded on demand. Not shown by default because it is
          behaviour history, not evidence about this case. */}
      <div className="border-b border-slate-200 px-5 py-3">
        {!track ? (
          <Button variant="secondary" size="sm" onClick={() => void loadTrack()}>
            Show the history of both parties
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs">
                <p className="font-medium text-slate-800">{track.worker.name}</p>
                <p className="mt-1 text-slate-600">
                  Confirmed {track.worker.history.workRecordsConfirmed} work records and disputed{" "}
                  {track.worker.history.workRecordsDisputed}. Filed{" "}
                  {track.worker.history.complaintsFiled} complaints:{" "}
                  {track.worker.history.complaintsUpheld} upheld,{" "}
                  {track.worker.history.complaintsRejected} rejected, and{" "}
                  {track.worker.history.complaintsUnproven} closed unproven.
                </p>
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs">
                <p className="font-medium text-slate-800">{track.contractor.name}</p>
                <p className="mt-1 text-slate-600">
                  Recorded {track.contractor.history.paymentsTotal} payments:{" "}
                  {track.contractor.history.paymentsWithBankTrail} with a bank trail,{" "}
                  {track.contractor.history.paymentsWithCode} with a handover code, and{" "}
                  {track.contractor.history.paymentsNoProof} with no supporting proof. Workers
                  dispute {track.contractor.history.paymentsDisputed} of them.
                </p>
              </div>
            </div>
            <InfoNote>{track.caution}</InfoNote>
          </div>
        )}
      </div>

      {/* Actions. */}
      <div className="px-5 py-4">
        {action === "" ? (
          <div className="flex flex-wrap gap-2">
            {c.status !== "AWAITING_EMPLOYER" && (
              <Button size="sm" variant="secondary" onClick={() => setAction("ask")}>
                Request an explanation
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setAction("contact")}>
              Record a call
            </Button>
            <Button size="sm" onClick={() => setAction("decide")}>
              Issue a decision
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAction("escalate")}>
              Forward to a higher office
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {action === "ask" && (
              <>
                <Field
                  label="What do you want to ask the contractor?"
                  hint="Most of these cases come from careless record-keeping rather than theft. Requesting an explanation first is usually faster than issuing a decision."
                >
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Please explain why 15 days of work show no payment, and tell me when you will pay him."
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={busy || note.trim().length < 5}
                  onClick={() =>
                    void run(
                      () => api.askEmployer(c.id, note),
                      "Request sent to the contractor.",
                    )
                  }
                >
                  {busy ? "Sending…" : "Send the request"}
                </Button>
              </>
            )}

            {action === "contact" && (
              <>
                <Field label="Who did you contact?">
                  <select
                    className={inputClass}
                    value={contactKind}
                    onChange={(e) =>
                      setContactKind(
                        e.target.value as "CALLED_WORKER" | "CALLED_EMPLOYER" | "MESSAGED_WORKER",
                      )
                    }
                  >
                    <option value="CALLED_EMPLOYER">I called the contractor</option>
                    <option value="CALLED_WORKER">I called the worker</option>
                    <option value="MESSAGED_WORKER">I sent the worker a message</option>
                  </select>
                </Field>
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  This system does not place calls. Dial{" "}
                  {contactKind === "CALLED_WORKER"
                    ? c.raisedBy.phone && <PhoneLink phone={c.raisedBy.phone} />
                    : b?.contractor.phone && <PhoneLink phone={b.contractor.phone} />}{" "}
                  yourself, then record here what was said.
                </div>
                <Field label="What was said on the call?">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Spoke to the contractor. He accepts the worker completed 15 days and undertakes to pay on Friday."
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={busy || note.trim().length < 3}
                  onClick={() =>
                    void run(
                      () => api.contact(c.id, contactKind, note),
                      "Added to the case file.",
                    )
                  }
                >
                  {busy ? "Saving…" : "Add to the case file"}
                </Button>
              </>
            )}

            {action === "decide" && (
              <>
                <Field label="What is your decision?">
                  <select
                    className={inputClass}
                    value={outcome}
                    onChange={(e) =>
                      setOutcome(e.target.value as "UPHELD" | "REJECTED" | "SETTLED" | "UNPROVEN")
                    }
                  >
                    <option value="UPHELD">Upheld, wages are due to the worker</option>
                    <option value="SETTLED">Upheld and settled, the contractor has since paid</option>
                    <option value="REJECTED">Rejected, the records do not support the claim</option>
                    <option value="UNPROVEN">Unproven, neither side can be established</option>
                  </select>
                </Field>

                {outcome === "UNPROVEN" && (
                  <InfoNote>
                    Use this where cash changed hands with no code, no bank reference and no
                    witness. The disagreement and the absence of proof are both recorded, and
                    neither party is called dishonest without evidence.
                  </InfoNote>
                )}
                {outcome === "SETTLED" && (
                  <InfoNote>
                    This is not the same as rejecting the claim. The worker was right and the
                    contractor paid after you intervened. Recording it as rejected would understate
                    the worker's case in his own history.
                  </InfoNote>
                )}

                <Field label="Reason for the decision" hint="The worker receives this as a message on his phone, so keep it clear enough for him to read.">
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="15 days at ₹700 a day are recorded and the worker confirmed them. No payment is recorded against this contract. ₹10,500 is due."
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    void run(() => api.decide(c.id, outcome, note), "Decision recorded, and the worker has been notified.")
                  }
                >
                  {busy ? "Saving…" : "Record the decision"}
                </Button>
              </>
            )}

            {action === "escalate" && (
              <>
                <Field label="Which office should this be forwarded to?">
                  <select
                    className={inputClass}
                    value={escalateTo}
                    onChange={(e) =>
                      setEscalateTo(e.target.value as "LABOUR_COMMISSIONER" | "POLICE")
                    }
                  >
                    <option value="LABOUR_COMMISSIONER">
                      Labour Commissioner, for recovery of wages
                    </option>
                    <option value="POLICE">Police, where a criminal offence is involved</option>
                  </select>
                </Field>
                <InfoNote>
                  Unpaid wages are a labour matter, and the Labour Commissioner has the power to
                  order recovery. Forward to the police only where something beyond non-payment is
                  involved, such as confinement, threats, or documents being withheld.
                </InfoNote>
                <Field label="Grounds for forwarding">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="The contractor failed to respond to two requests. The records show ₹10,500 due."
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={busy || note.trim().length < 10}
                  onClick={() =>
                    void run(() => api.escalate(c.id, escalateTo, note), "Forwarded, with your grounds recorded.")
                  }
                >
                  {busy ? "Sending…" : "Forward the case"}
                </Button>
              </>
            )}

            <Button variant="ghost" size="sm" onClick={() => setAction("")}>
              Cancel
            </Button>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">Reviewing officer: {officer.name}</p>
      </div>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

/** Plain words for each reason a disagreement was taken off the list. */
const REVIEW_REASON: Record<string, string> = {
  SETTLED_OUTSIDE: "Settled between the two of them",
  DECIDED: "Already decided on a complaint",
  NO_ACTION: "Looked at, no action taken",
  UNPROVABLE: "Nothing can prove it either way",
};

/**
 * One disputed record.
 *
 * Used for both lists on the disputes tab. Which list it is in is decided by
 * `d.review`, so the two lists cannot drift apart in wording or behaviour: an
 * unreviewed record offers the review form, a reviewed one shows the officer's
 * note and a way to put it back.
 */
function DisputeRow({
  d,
  onDone,
  onError,
}: {
  d: DisputedRecord;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<
    "SETTLED_OUTSIDE" | "DECIDED" | "NO_ACTION" | "UNPROVABLE"
  >("SETTLED_OUTSIDE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await api.reviewDispute({ kind: d.kind, id: d.id, reason, note });
      onDone(r.message);
      setOpen(false);
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      const r = await api.reopenDispute(d.kind, d.id);
      onDone(r.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not reopen it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {d.worker.name} · {d.siteName}
          </p>
          <p className="text-xs text-slate-500">
            {d.kind === "WORK" ? "Days of work" : "Payment"} {d.period} · {d.contractor.name}
            {d.contractor.company ? ` (${d.contractor.company})` : ""}
          </p>
        </div>
        {d.gapValue !== null && (
          <div className="text-right">
            <p className="text-xs text-slate-500">Amount in dispute</p>
            <p className="text-sm font-semibold tabular-nums text-rose-700">
              {formatRupees(Math.abs(d.gapValue))}
            </p>
          </div>
        )}
      </div>

      {/* Shown before the two figures, because if a complaint on this contract
        * was already decided, that changes how the officer should read
        * everything below it. */}
      {d.relatedComplaint && !d.review && (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs ring-1 ring-inset ring-amber-200">
          <p className="font-medium text-amber-900">
            A complaint on this same contract was already closed
            {d.relatedComplaint.closedAt ? ` on ${formatDate(d.relatedComplaint.closedAt)}` : ""}
            {d.relatedComplaint.outcome ? ` as ${d.relatedComplaint.outcome.toLowerCase()}` : ""}.
          </p>
          {d.relatedComplaint.note && (
            <p className="mt-0.5 text-amber-800">{d.relatedComplaint.note}</p>
          )}
          <p className="mt-0.5 text-amber-800">
            This disagreement may be the same matter. Check before contacting anyone again.
          </p>
        </div>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">The contractor recorded</p>
          <p className="text-sm font-medium text-slate-900">{d.contractorSays}</p>
        </div>
        <div className="rounded-md bg-rose-50 px-3 py-2 ring-1 ring-inset ring-rose-200">
          <p className="text-xs text-rose-700">The worker states</p>
          <p className="text-sm font-medium text-rose-900">{d.workerSays}</p>
        </div>
      </div>

      {d.note && <p className="mt-2 text-xs text-slate-600">The worker added: {d.note}</p>}

      {d.employerStatement ? (
        <div className="mt-2 rounded-md bg-sky-50 px-3 py-2 ring-1 ring-inset ring-sky-200">
          <p className="text-xs text-sky-800">
            The contractor's account, given {formatDate(d.employerStatement.at)}
          </p>
          <p className="mt-0.5 text-sm text-sky-900">{d.employerStatement.note}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-700">
          The contractor has not given his account of this. That is not the same as agreeing with
          the worker.
        </p>
      )}

      <p className="mt-1.5 text-xs text-slate-400">
        Disputed on {d.at ? formatDateTime(d.at) : "—"}
        {d.via ? `, by ${d.via === "SMS" ? "text message" : "the app"}` : ""} · contact{" "}
        {d.worker.phone && <PhoneLink phone={d.worker.phone} />}
      </p>

      {d.review ? (
        <div className="mt-3 rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-700">
            {REVIEW_REASON[d.review.reason] ?? d.review.reason} · {d.review.officer.name} ·{" "}
            {formatDate(d.review.at)}
          </p>
          <p className="mt-0.5 text-sm text-slate-700">{d.review.note}</p>
          <div className="mt-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reopen()}>
              {busy ? "Working…" : "Put back on my list"}
            </Button>
          </div>
        </div>
      ) : open ? (
        <div className="mt-3 space-y-2">
          <Field label="Why does this need no more attention?">
            <select
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              <option value="SETTLED_OUTSIDE">
                The two of them settled it themselves
              </option>
              <option value="DECIDED">I already decided this on a complaint</option>
              <option value="UNPROVABLE">Nothing can prove it either way</option>
              <option value="NO_ACTION">Looked at it, taking no action</option>
            </select>
          </Field>
          <Field
            label="What did you find?"
            hint="Write it for the officer who opens this next year and remembers nothing about it."
          >
            <textarea
              className={inputClass}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Called both on 30 Aug. Contractor paid Rs 2,100 in cash at this office, worker confirms he received it. Nothing further to do."
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || note.trim().length < 10} onClick={() => void save()}>
              {busy ? "Saving…" : "Take off my list"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            No more action needed
          </Button>
        </div>
      )}
    </li>
  );
}
