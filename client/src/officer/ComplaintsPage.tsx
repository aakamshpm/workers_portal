import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../shared/api";
import type { AuthUser, Complaint, TrackRecord } from "../shared/types";
import {
  Button,
  Card,
  ComplaintBadge,
  EmptyState,
  Field,
  formatDate,
  formatDays,
  formatRupees,
  inputClass,
  Note,
  PhoneLink,
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
  ASKED_EMPLOYER: "You requested an explanation from the contractor",
  EMPLOYER_REPLY: "The contractor responded",
  CALLED_WORKER: "You called the worker",
  CALLED_EMPLOYER: "You called the contractor",
  MESSAGED_WORKER: "You sent the worker a message",
  DECIDED: "You issued a decision",
  ESCALATED: "Escalated",
};

/** The language a complaint was written in, named, because "OR" reads as a word. */
const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ml: "Malayalam",
  or: "Odia",
};

/**
 * The labour officer's complaints (design O1, ADR-0021).
 *
 * Written complaints only. The other way a matter reaches the office, a record
 * the worker rejected without writing anything, has its own page, and its count
 * is a link here, so an officer who opens this page still sees it is waiting.
 */
export default function ComplaintsPage({ user }: { user: AuthUser }) {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [disputesWaiting, setDisputesWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [c, d] = await Promise.all([api.complaints(), api.disputedRecords()]);
      setComplaints(c);
      setDisputesWaiting(d.length);
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
    <div className="flex max-w-5xl flex-col gap-space-lg">
      <header className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg text-on-surface">Complaints</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Complaints the workers wrote, with what the records show for each.
        </p>
      </header>

      {error && <Note tone="error">{error}</Note>}
      {flash && <Note tone="success">{flash}</Note>}

      <div className="grid gap-space-md sm:grid-cols-3">
        <Stat label="Open cases" value={String(open.length)} />
        <Stat
          label="Disputes waiting"
          value={String(disputesWaiting)}
          tone={disputesWaiting > 0 ? "text-error" : "text-on-surface"}
          to="/disputes"
        />
        <Stat label="Closed" value={String(closed.length)} />
      </div>

      {open.length === 0 ? (
        <Card>
          <EmptyState>No complaints are awaiting your review.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-space-lg">
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
          <ul className="divide-y divide-outline-variant">
            {closed.map((c) => (
              <li key={c.id} className="flex flex-col items-start gap-space-xs px-space-lg py-space-md">
                <p className="font-body-lg text-body-lg text-on-surface">
                  {c.raisedBy.name} · {CATEGORY_LABEL[c.category] ?? c.category}
                  {c.claimedAmount ? ` · asked for ${formatRupees(c.claimedAmount)}` : ""}
                </p>
                <ComplaintBadge status={c.status} audience="official" />
                {c.outcomeNote && (
                  <p className="font-label-md text-label-md text-on-surface-variant">{c.outcomeNote}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** One count. With `to`, the whole box is a link to the page the count is about. */
function Stat({
  label,
  value,
  tone = "text-on-surface",
  to,
}: {
  label: string;
  value: string;
  tone?: string;
  to?: string;
}) {
  const box = "block rounded-xl bg-surface-container-lowest px-space-lg py-space-md shadow-sm";
  const inner = (
    <>
      <p className="font-label-md text-label-md text-on-surface-variant">{label}</p>
      <p className={`font-stat-callout text-stat-callout tabular-nums ${tone}`}>{value}</p>
      {to && <span className="font-label-md text-label-md text-primary">Open the list</span>}
    </>
  );
  return to ? (
    <Link
      to={to}
      className={`${box} transition hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
    >
      {inner}
    </Link>
  ) : (
    <div className={box}>{inner}</div>
  );
}

/** A small section of a case, with its own heading so the card reads in order. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-space-sm border-b border-outline-variant px-space-lg py-space-md">
      <h3 className="font-label-md text-label-md tracking-wide text-on-surface-variant uppercase">
        {title}
      </h3>
      {children}
    </section>
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
  const headingId = useId();
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
    <article aria-labelledby={headingId} className="rounded-xl bg-surface-container-lowest shadow-sm">
      <div className="flex flex-col gap-space-md border-b border-outline-variant px-space-lg py-space-md">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-0">
            <h2 id={headingId} className="font-headline-sm text-headline-sm text-on-surface">
              {c.raisedBy.name}
              {c.raisedBy.homeState ? ` · ${c.raisedBy.homeState}` : ""}
              {" · "}
              {CATEGORY_LABEL[c.category] ?? c.category}
            </h2>
            <p className="font-label-md text-label-md text-on-surface-variant">
              Sent {formatDate(c.createdAt)} · written in{" "}
              {LANGUAGE_NAME[c.language] ?? c.language.toUpperCase()} · his number is{" "}
              {c.raisedBy.phone && <PhoneLink phone={c.raisedBy.phone} />}
            </p>
          </div>
          <div className="flex flex-col items-start gap-space-xs sm:items-end">
            <ComplaintBadge status={c.status} audience="official" />
            {c.claimedAmount !== null && (
              <p className="font-body-lg-bold text-body-lg-bold whitespace-nowrap tabular-nums text-on-surface">
                he asks for {formatRupees(c.claimedAmount)}
              </p>
            )}
          </div>
        </div>

        <p className="rounded-xl bg-surface-container-low px-space-md py-space-sm font-body-lg text-body-lg text-on-surface">
          {c.description}
        </p>
      </div>

      {/* The contract's own figures. Without these the officer is judging a
          claim against nothing. */}
      {b && (
        <Section title="What the records show">
          <dl className="grid grid-cols-2 gap-x-space-lg gap-y-space-md lg:grid-cols-4">
            <Item label="Agreed daily rate" value={formatRupees(b.dailyRate)} />
            <Item label="Days recorded" value={formatDays(b.daysWorked)} />
            <Item label="Wages earned" value={formatRupees(b.earned)} />
            <Item label="Wages paid" value={formatRupees(b.paid)} />
          </dl>

          <div className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs">
            <p
              className={`font-headline-sm text-headline-sm whitespace-nowrap tabular-nums ${
                b.balance > 0 ? "text-error" : "text-primary"
              }`}
            >
              {b.balance > 0
                ? `${formatRupees(b.balance)} outstanding`
                : b.balance < 0
                  ? `Overpaid by ${formatRupees(-b.balance)}`
                  : "Nothing outstanding"}
            </p>
            <span className="font-label-md text-label-md text-on-surface-variant">
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
            <Note tone="info">
              {`The worker claims ${formatRupees(c.claimedAmount)}, but the records come to ${formatRupees(b.balance)}, a difference of ${formatRupees(Math.abs(c.claimedAmount - b.balance))}. Put this to him before you decide.`}
            </Note>
          )}

          {b.awaitingConfirmation > 0 && (
            <Note tone="warning">
              {`${b.awaitingConfirmation} record${b.awaitingConfirmation === 1 ? "" : "s"} on this contract ${b.awaitingConfirmation === 1 ? "was" : "were"} never confirmed by the worker, so ${b.awaitingConfirmation === 1 ? "it rests" : "they rest"} on the contractor's word alone.`}
            </Note>
          )}
          {b.paidDisputed > 0 && (
            <p className="font-body-lg text-body-lg text-error">
              The worker disputes {formatRupees(b.paidDisputed)} of the payments recorded here.
            </p>
          )}
        </Section>
      )}

      {/* What has happened on the case so far. */}
      {c.actions.length > 0 && (
        <Section title="Case history">
          <ol className="flex flex-col gap-space-sm border-l-2 border-outline-variant pl-space-md">
            {c.actions.map((a) => (
              <li key={a.id} className="font-label-md text-label-md">
                <span className="font-body-lg-medium text-body-lg-medium text-on-surface">
                  {ACTION_LABEL[a.kind] ?? a.kind}
                </span>
                {a.escalatedTo && (
                  <span className="text-tertiary">
                    {" → "}
                    {a.escalatedTo === "POLICE" ? "Police" : "Labour Commissioner"}
                  </span>
                )}
                <span className="text-on-surface-variant">
                  {" · "}
                  {a.author.name} · {formatDate(a.createdAt)}
                </span>
                {a.note && <p className="mt-space-xs text-on-surface-variant">{a.note}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Track record, loaded on demand. Not shown by default because it is
          behaviour history, not evidence about this case. */}
      <div className="flex flex-col gap-space-sm border-b border-outline-variant px-space-lg py-space-md">
        {!track ? (
          <div>
            <Button variant="secondary" size="dense" onClick={() => void loadTrack()}>
              Show the history of both parties
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-space-md sm:grid-cols-2">
              <div className="rounded-xl bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant">
                <p className="font-body-lg-medium text-body-lg-medium text-on-surface">{track.worker.name}</p>
                <p className="mt-space-xs">
                  Confirmed {track.worker.history.workRecordsConfirmed} work records and disputed{" "}
                  {track.worker.history.workRecordsDisputed}. Filed{" "}
                  {track.worker.history.complaintsFiled} complaints:{" "}
                  {track.worker.history.complaintsUpheld} upheld,{" "}
                  {track.worker.history.complaintsRejected} rejected, and{" "}
                  {track.worker.history.complaintsUnproven} closed unproven.
                </p>
              </div>
              <div className="rounded-xl bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant">
                <p className="font-body-lg-medium text-body-lg-medium text-on-surface">{track.contractor.name}</p>
                <p className="mt-space-xs">
                  Recorded {track.contractor.history.paymentsTotal} payments:{" "}
                  {track.contractor.history.paymentsWithBankTrail} with a bank trail,{" "}
                  {track.contractor.history.paymentsWithCode} with a handover code, and{" "}
                  {track.contractor.history.paymentsNoProof} with no supporting proof. Workers
                  dispute {track.contractor.history.paymentsDisputed} of them.
                </p>
              </div>
            </div>
            <Note tone="info">{track.caution}</Note>
          </>
        )}
      </div>

      {/* Actions. */}
      <div className="flex flex-col gap-space-md px-space-lg py-space-md">
        {action === "" ? (
          <div className="flex flex-wrap gap-space-sm">
            {c.status !== "AWAITING_EMPLOYER" && (
              <Button size="dense" variant="secondary" onClick={() => setAction("ask")}>
                Request an explanation
              </Button>
            )}
            <Button size="dense" variant="secondary" onClick={() => setAction("contact")}>
              Record a call
            </Button>
            <Button size="dense" onClick={() => setAction("decide")}>
              Issue a decision
            </Button>
            <Button size="dense" variant="secondary" onClick={() => setAction("escalate")}>
              Forward to a higher office
            </Button>
          </div>
        ) : (
          <div className="flex max-w-2xl flex-col gap-space-md">
            {action === "ask" && (
              <>
                <Field label="What do you want to ask the contractor?">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Please explain why 15 days of work show no payment, and tell me when you will pay him."
                  />
                </Field>
                <div>
                  <Button
                    size="dense"
                    disabled={busy || note.trim().length < 5}
                    onClick={() =>
                      void run(() => api.askEmployer(c.id, note), "Request sent to the contractor.")
                    }
                  >
                    {busy ? "Sending…" : "Send the request"}
                  </Button>
                </div>
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
                <p className="rounded-xl bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface-variant">
                  Call{" "}
                  {contactKind === "CALLED_WORKER"
                    ? c.raisedBy.phone && <PhoneLink phone={c.raisedBy.phone} />
                    : b?.contractor.phone && <PhoneLink phone={b.contractor.phone} />}{" "}
                  then write what was said.
                </p>
                <Field label="What was said on the call?">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Spoke to the contractor. He accepts the worker completed 15 days and undertakes to pay on Friday."
                  />
                </Field>
                <div>
                  <Button
                    size="dense"
                    disabled={busy || note.trim().length < 3}
                    onClick={() =>
                      void run(() => api.contact(c.id, contactKind, note), "Added to the case file.")
                    }
                  >
                    {busy ? "Saving…" : "Add to the case file"}
                  </Button>
                </div>
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
                  <Note tone="info">Use when there is no code, no bank number and no witness.</Note>
                )}
                {outcome === "SETTLED" && (
                  <Note tone="info">Use when the worker was right and the contractor has now paid.</Note>
                )}

                <Field
                  label="Reason for the decision"
                  hint="The worker receives this as a message on his phone, so keep it clear enough for him to read."
                >
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="15 days at ₹700 a day are recorded and the worker confirmed them. No payment is recorded against this contract. ₹10,500 is due."
                  />
                </Field>
                <div>
                  <Button
                    size="dense"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(
                        () => api.decide(c.id, outcome, note),
                        "Decision recorded, and the worker has been notified.",
                      )
                    }
                  >
                    {busy ? "Saving…" : "Record the decision"}
                  </Button>
                </div>
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
                <Note tone="info">
                  Unpaid wages are a labour matter, and the Labour Commissioner has the power to
                  order recovery. Forward to the police only where something beyond non-payment is
                  involved, such as confinement, threats, or documents being withheld.
                </Note>
                <Field label="Grounds for forwarding">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="The contractor failed to respond to two requests. The records show ₹10,500 due."
                  />
                </Field>
                <div>
                  <Button
                    size="dense"
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void run(
                        () => api.escalate(c.id, escalateTo, note),
                        "Forwarded, with your grounds recorded.",
                      )
                    }
                  >
                    {busy ? "Sending…" : "Forward the case"}
                  </Button>
                </div>
              </>
            )}

            <div>
              <Button variant="ghost" size="dense" onClick={() => setAction("")}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="font-label-md text-label-md text-on-surface-variant">
          Reviewing officer: {officer.name}
        </p>
      </div>
    </article>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-label-md text-label-md text-on-surface-variant">{label}</dt>
      <dd className="font-body-lg-bold text-body-lg-bold whitespace-nowrap tabular-nums text-on-surface">
        {value}
      </dd>
    </div>
  );
}
