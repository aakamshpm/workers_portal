import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type {
  AuthUser,
  Complaint,
  ContractBalance,
  Disagreement,
  Offer,
  Person,
} from "../shared/types";
import BalanceCard from "../shared/components/BalanceCard";
import DisagreementList from "../shared/components/DisagreementList";
import {
  Button,
  Card,
  ComplaintBadge,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  formatDays,
  formatRupees,
  InfoNote,
  inputClass,
  OfferBadge,
  SuccessNote,
} from "../shared/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * What the contractor sees.
 *
 * The order follows the working week: hire someone, record the week's work, then
 * deal with anything the labour office has asked about. Payment lives on its own
 * page, because attaching proof to a cash handover is a two-person action that
 * needs room to explain itself.
 */
export default function ContractorDashboard({
  user,
  onGoToPayment,
}: {
  user: AuthUser;
  onGoToPayment?: (offerId: string) => void;
}) {
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [b, o, c, r] = await Promise.all([
        api.balances(),
        api.offers(),
        api.complaints(),
        api.disagreements(),
      ]);
      setBalances(b);
      setOffers(o);
      setComplaints(c);
      setDisagreements(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your workers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function done(msg: string) {
    setFlash(msg);
    void load();
  }

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  const pending = offers.filter((o) => o.status === "PENDING");
  const owed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);
  const needsAnswer = complaints.filter((c) => c.status === "AWAITING_EMPLOYER");

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Workers hired" value={String(balances.length)} />
        <Stat label="Awaiting a reply" value={String(pending.length)} />
        <Stat
          label="Wages outstanding"
          value={formatRupees(owed)}
          tone={owed > 0 ? "text-rose-700" : "text-emerald-700"}
        />
      </div>

      {needsAnswer.length > 0 && (
        <Card
          title="The labour office has asked you to respond"
          description="Reply in your own words. Your answer is filed with the complaint. Nothing is decided automatically because of it."
        >
          <ul className="divide-y divide-slate-200">
            {needsAnswer.map((c) => (
              <EmployerReplyRow key={c.id} complaint={c} onDone={done} onError={setError} />
            ))}
          </ul>
        </Card>
      )}

      {/* Placed above the offer form, because a rejection is the most urgent
        * thing on this page: the worker has said something on his record is
        * wrong, and until the contractor answers, the file carries only one
        * account. */}
      {disagreements.length > 0 && (
        <DisagreementList
          items={disagreements}
          viewer="CONTRACTOR"
          onDone={done}
          onError={setError}
        />
      )}

      <SendOfferForm onDone={done} onError={setError} />

      <LogWorkForm balances={balances} onDone={done} onError={setError} />

      {pending.length > 0 && (
        <Card
          title="Offers awaiting a reply"
          description="Work and payments cannot be recorded against a contract until the worker accepts it."
        >
          <ul className="divide-y divide-slate-200">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {o.worker.name} · {o.siteName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatRupees(o.dailyRate)} a day · {o.expectedDays} days · you sent this on{" "}
                    {formatDate(o.createdAt)}
                  </p>
                </div>
                <OfferBadge status={o.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Your workers</h2>
        {balances.length === 0 ? (
          <Card>
            <EmptyState>
              No worker has taken a job from you yet. Offer work above, and the worker gets it as a
              message on his phone.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {balances.map((b) => (
              <BalanceCard
                key={b.offerId}
                balance={b}
                viewer="CONTRACTOR"
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Work written down {b.periodCount} time{b.periodCount === 1 ? "" : "s"} ·{" "}
                      {b.paymentCount} payment{b.paymentCount === 1 ? "" : "s"}
                      {b.lastPaymentOn ? ` · you last paid him on ${formatDate(b.lastPaymentOn)}` : ""}
                    </p>
                    {onGoToPayment && (
                      <Button size="sm" onClick={() => onGoToPayment(b.offerId)}>
                        Pay this worker
                      </Button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        )}
      </div>

      {complaints.length > 0 && (
        <Card title="Complaints made against you">
          <ul className="divide-y divide-slate-200">
            {complaints.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-900">
                    {c.raisedBy.name}
                    {c.claimedAmount ? ` · says he is owed ${formatRupees(c.claimedAmount)}` : ""}
                  </p>
                  <ComplaintBadge status={c.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{c.description}</p>
                {c.outcomeNote && (
                  <p className="mt-1 text-xs text-slate-500">
                    The labour office said: {c.outcomeNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-xs text-slate-400">Signed in as {user.name}</p>
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

/**
 * Send a formal offer.
 *
 * The worker is found by phone number, because that is the only identifier a
 * contractor reliably has. The total is shown live so the person typing the rate
 * sees what they are committing to before the worker does.
 */
function SendOfferForm({
  onDone,
  onError,
}: {
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [dailyRate, setDailyRate] = useState("");
  const [workType, setWorkType] = useState("");
  const [siteName, setSiteName] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [expectedDays, setExpectedDays] = useState("24");
  const [extraTerms, setExtraTerms] = useState("");
  const [busy, setBusy] = useState(false);

  // Look the worker up as the number is typed. Ten digits is a complete Indian
  // mobile number, so there is nothing to gain by searching earlier.
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setFound(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api
      .findWorkers(digits)
      .then((list) => {
        if (!cancelled) setFound(list[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setFound(null);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [phone]);

  async function submit() {
    setBusy(true);
    try {
      const offer = await api.sendOffer({
        workerPhone: phone,
        dailyRate: Number(dailyRate),
        workType,
        siteName,
        startDate,
        expectedDays: Number(expectedDays),
        extraTerms: extraTerms || undefined,
      });
      onDone(
        `Sent to ${offer.worker.name}. He can send YES from his phone, or press the button on his own page.`,
      );
      setOpen(false);
      setPhone("");
      setDailyRate("");
      setWorkType("");
      setSiteName("");
      setExtraTerms("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const total = Number(dailyRate) * Number(expectedDays);

  return (
    <Card
      title="Offer work to a worker"
      description="Enter the daily rate you agreed verbally. The worker receives it on his phone and must accept it before any work can be recorded."
      actions={
        <Button variant={open ? "ghost" : "primary"} size="sm" onClick={() => setOpen(!open)}>
          {open ? "Cancel" : "Offer work"}
        </Button>
      }
    >
      {open && (
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Worker's phone number"
            hint={
              searching
                ? "Looking…"
                : found
                  ? `Found: ${found.name}${found.homeState ? ` from ${found.homeState}` : ""}`
                  : phone.replace(/\D/g, "").length >= 10
                    ? "No worker has this number. Ask him to make an account first."
                    : "Type all ten numbers."
            }
          >
            <input
              className={inputClass}
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98800 30004"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pay for one day (₹)">
              <input
                className={inputClass}
                type="number"
                min="1"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
                placeholder="750"
                required
              />
            </Field>
            <Field label="Expected number of days">
              <input
                className={inputClass}
                type="number"
                min="1"
                value={expectedDays}
                onChange={(e) => setExpectedDays(e.target.value)}
                required
              />
            </Field>
            <Field label="Type of work">
              <input
                className={inputClass}
                value={workType}
                onChange={(e) => setWorkType(e.target.value)}
                placeholder="Plywood press operator"
                required
              />
            </Field>
            <Field label="Work site">
              <input
                className={inputClass}
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Perumbavoor unit"
                required
              />
            </Field>
            <Field label="Start date">
              <input
                className={inputClass}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>
            <Field
              label="Anything else you promised (optional)"
              hint="Food, accommodation, overtime rate."
            >
              <input
                className={inputClass}
                value={extraTerms}
                onChange={(e) => setExtraTerms(e.target.value)}
                placeholder="Place to stay, 2 meals a day"
              />
            </Field>
          </div>

          {total > 0 && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              At {formatRupees(Number(dailyRate))} a day for {expectedDays} days, the full contract
              comes to about{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRupees(total)}
              </span>
              .
            </div>
          )}

          <InfoNote>
            Once the worker accepts, this daily rate is fixed. No screen in this system can change
            it. A mistake has to be corrected by adding a new record, not by editing this one.
          </InfoNote>

          <Button type="submit" disabled={busy || !found}>
            {busy ? "Sending…" : "Send the offer"}
          </Button>
        </form>
      )}
    </Card>
  );
}

/**
 * Log a period of work.
 *
 * A period, not a day, because a contractor pays weekly and thinks in weeks.
 * Half days are allowed since site registers use them.
 */
function LogWorkForm({
  balances,
  onDone,
  onError,
}: {
  balances: ContractBalance[];
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [offerId, setOfferId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(today());
  const [days, setDays] = useState("6");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const chosen = balances.find((b) => b.offerId === offerId);

  if (balances.length === 0) return null;

  async function submit() {
    setBusy(true);
    try {
      await api.logWork({
        offerId,
        fromDate,
        toDate,
        days: Number(days),
        note: note || undefined,
      });
      onDone(
        `Written down. ${chosen?.worker.name} has been asked if it is correct. Until he answers, it stays marked as not checked.`,
      );
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Write down work done"
      description="One record covers a week, or any run of days. The worker is then asked to confirm it."
    >
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Worker">
          <select
            className={inputClass}
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            required
          >
            <option value="">Choose a worker…</option>
            {balances.map((b) => (
              <option key={b.offerId} value={b.offerId}>
                {b.worker.name} · {b.siteName} · {formatRupees(b.dailyRate)} a day
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <input
              className={inputClass}
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </Field>
          <Field label="To">
            <input
              className={inputClass}
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Days worked" hint="Half days are allowed, for example 5.5">
            <input
              className={inputClass}
              type="number"
              step="0.5"
              min="0.5"
              max="31"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Note (optional)">
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="No work on Sunday"
          />
        </Field>

        {/* A preview of what this new line would do.
         *
         * It shows the before figure, the new line, and the after figure. Without
         * the before figure a contractor can read the added amount as if it were
         * the worker's whole balance, which is a real mistake: the two numbers
         * look similar and mean completely different things.
         */}
        {chosen && Number(days) > 0 && (
          <div className="space-y-1.5 rounded-md bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <p className="font-medium text-slate-800">
              This adds a new record. Nothing already saved is changed.
            </p>
            <dl className="space-y-0.5">
              <div className="flex justify-between gap-3">
                <dt>
                  Already recorded: {formatDays(chosen.daysWorked)} days, earned
                </dt>
                <dd className="tabular-nums">{formatRupees(chosen.earned)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-slate-900">
                <dt>
                  This record: {formatDays(Number(days))} days at{" "}
                  {formatRupees(chosen.dailyRate)} a day
                </dt>
                <dd className="font-semibold tabular-nums">
                  + {formatRupees(chosen.dailyRate * Number(days))}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-1 font-medium text-slate-900">
                <dt>
                  {chosen.worker.name} will have earned{" "}
                  {formatDays(chosen.daysWorked + Number(days))} days in total
                </dt>
                <dd className="tabular-nums">
                  {formatRupees(chosen.earned + chosen.dailyRate * Number(days))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Paid so far</dt>
                <dd className="tabular-nums">− {formatRupees(chosen.paid)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-1 font-semibold text-slate-900">
                <dt>Will be outstanding</dt>
                <dd className="tabular-nums">
                  {formatRupees(
                    Math.max(0, chosen.earned + chosen.dailyRate * Number(days) - chosen.paid),
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <Button type="submit" disabled={busy || !offerId}>
          {busy ? "Saving…" : "Record this work"}
        </Button>
      </form>
    </Card>
  );
}

function EmployerReplyRow({
  complaint,
  onDone,
  onError,
}: {
  complaint: Complaint;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = complaint.actions.filter((a) => a.kind === "ASK_EMPLOYER").at(-1);

  async function submit() {
    setBusy(true);
    try {
      await api.employerReply(complaint.id, note);
      onDone("Your answer has been written down and sent to the labour office.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send your answer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <p className="text-sm font-medium text-slate-900">
        {complaint.raisedBy.name}
        {complaint.claimedAmount
          ? ` says you owe him ${formatRupees(complaint.claimedAmount)}`
          : ""}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">{complaint.description}</p>
      {ask && (
        <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
          The labour office asks: {ask.note}
        </p>
      )}
      <div className="mt-2 space-y-2">
        <Field label="What is your answer?">
          <textarea
            className={inputClass}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The payment is late because the site owner has not given me the money yet. I will pay him on Friday."
            required
          />
        </Field>
        <Button size="sm" disabled={busy || note.trim().length < 3} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send my answer"}
        </Button>
      </div>
    </li>
  );
}
