import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../shared/api";
import type {
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
  Field,
  formatDate,
  formatDays,
  formatRupees,
  inputClass,
  Note,
  OfferBadge,
} from "../shared/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

/** Which of the two forms is open. One at a time, so his workers stay near the top of a phone. */
type FormName = "offer" | "work" | null;

/**
 * What the contractor sees (design C1).
 *
 * The order follows the working week: the money still owed first, then the two
 * things he does most (offer work, write down the week's work), then anything
 * the labour office has asked about. Payment lives on its own page, because
 * attaching proof to a cash handover is a two-person action that needs room to
 * explain itself.
 *
 * The two forms are closed until he asks for one. Open together they pushed the
 * list of his workers four screens down a phone.
 */
export default function ContractorDashboard({
  onGoToPayment,
}: {
  onGoToPayment?: (offerId: string) => void;
}) {
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [form, setForm] = useState<FormName>(null);
  const owedId = useId();

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

  /** A form was sent: close it, so the message below the buttons is what he sees. */
  function finished(msg: string) {
    setForm(null);
    done(msg);
  }

  function toggle(name: Exclude<FormName, null>) {
    setFlash("");
    setForm(form === name ? null : name);
  }

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  const pending = offers.filter((o) => o.status === "PENDING");
  const owed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);
  const needsAnswer = complaints.filter((c) => c.status === "AWAITING_EMPLOYER");

  return (
    <div className="flex flex-col gap-space-lg">
      {/* The number he came for, first and largest (design C1). */}
      <section
        aria-labelledby={owedId}
        className="flex flex-col gap-space-xs rounded-xl bg-primary px-space-lg py-space-lg text-on-primary shadow-sm"
      >
        <p id={owedId} className="font-body-lg-medium text-body-lg-medium">
          Wages outstanding
        </p>
        <p className="font-headline-lg text-[40px] leading-[48px] tabular-nums">{formatRupees(owed)}</p>
      </section>

      <div className="grid grid-cols-2 gap-space-sm">
        <Stat label="Workers hired" value={String(balances.length)} />
        <Stat label="Awaiting a reply" value={String(pending.length)} />
      </div>

      {needsAnswer.length > 0 && (
        <Card
          title="The labour office has asked you to respond"
          description="Your answer is added to the complaint."
        >
          <ul className="divide-y divide-outline-variant">
            {needsAnswer.map((c) => (
              <EmployerReplyRow key={c.id} complaint={c} onDone={done} onError={setError} />
            ))}
          </ul>
        </Card>
      )}

      {/* Placed above the forms, because a rejection is the most urgent
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

      {error && <Note tone="error">{error}</Note>}
      {flash && <Note tone="success">{flash}</Note>}

      <div
        className={`grid gap-space-sm ${balances.length > 0 ? "grid-cols-2 max-[399px]:grid-cols-1" : ""}`}
      >
        <Button
          full
          icon="person_add"
          variant={form === "offer" ? "secondary" : "primary"}
          expanded={form === "offer"}
          onClick={() => toggle("offer")}
        >
          {form === "offer" ? "Cancel" : "Offer work"}
        </Button>
        {balances.length > 0 && (
          <Button
            full
            icon="work"
            variant="secondary"
            expanded={form === "work"}
            onClick={() => toggle("work")}
          >
            {form === "work" ? "Cancel" : "Write down work"}
          </Button>
        )}
      </div>

      {form === "offer" && <SendOfferForm onDone={finished} onError={setError} />}
      {form === "work" && <LogWorkForm balances={balances} onDone={finished} onError={setError} />}

      {pending.length > 0 && (
        <Card
          title="Offers awaiting a reply"
          description="Work and payments cannot be recorded against a contract until the worker accepts it."
        >
          <ul className="divide-y divide-outline-variant">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-col items-start gap-space-sm px-space-lg py-space-md">
                <div>
                  <p className="font-body-lg-medium text-body-lg-medium text-on-surface">
                    {o.worker.name} · {o.siteName}
                  </p>
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    {formatRupees(o.dailyRate)} a day · {o.expectedDays} days · you sent this on{" "}
                    {formatDate(o.createdAt)}
                  </p>
                </div>
                <OfferBadge status={o.status} viewer="CONTRACTOR" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby={`${owedId}-workers`} className="flex flex-col gap-space-md">
        <h2 id={`${owedId}-workers`} className="font-headline-sm text-headline-sm text-on-surface">
          Your workers
        </h2>
        {balances.length === 0 ? (
          <Card>
            <EmptyState>
              No worker has taken a job from you yet. Offer work above, and the worker gets it as a
              message on his phone.
            </EmptyState>
          </Card>
        ) : (
          <div className="flex flex-col gap-space-md">
            {balances.map((b) => (
              <BalanceCard
                key={b.offerId}
                balance={b}
                viewer="CONTRACTOR"
                footer={
                  <div className="flex flex-col gap-space-md sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      Work written down {b.periodCount} time{b.periodCount === 1 ? "" : "s"} ·{" "}
                      {b.paymentCount} payment{b.paymentCount === 1 ? "" : "s"}
                      {b.lastPaymentOn ? ` · you last paid him on ${formatDate(b.lastPaymentOn)}` : ""}
                    </p>
                    {onGoToPayment && (
                      <Button onClick={() => onGoToPayment(b.offerId)}>Pay this worker</Button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>

      {complaints.length > 0 && (
        <Card title="Complaints made against you">
          <ul className="divide-y divide-outline-variant">
            {complaints.map((c) => (
              <li key={c.id} className="flex flex-col items-start gap-space-xs px-space-lg py-space-md">
                <p className="font-body-lg text-body-lg text-on-surface">
                  {c.raisedBy.name}
                  {c.claimedAmount ? ` · says he is owed ${formatRupees(c.claimedAmount)}` : ""}
                </p>
                <ComplaintBadge status={c.status} />
                <p className="font-label-md text-label-md text-on-surface-variant">{c.description}</p>
                {c.outcomeNote && (
                  <p className="font-label-md text-label-md text-on-surface-variant">
                    The labour office said: {c.outcomeNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest px-space-lg py-space-md shadow-sm">
      <p className="font-label-md text-label-md text-on-surface-variant">{label}</p>
      <p className="font-stat-callout text-stat-callout tabular-nums text-on-surface">{value}</p>
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
    >
      <form
        className="flex flex-col gap-space-md px-space-lg py-space-md"
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
            placeholder="10-digit phone number"
            required
          />
        </Field>

        <div className="grid gap-space-md sm:grid-cols-2">
          <Field label="Pay for one day (₹)">
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
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
              inputMode="numeric"
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
          <p className="rounded-xl bg-surface-container-low px-space-md py-space-sm font-body-lg text-body-lg text-on-surface-variant">
            At {formatRupees(Number(dailyRate))} a day for {expectedDays} days, the full contract
            comes to about{" "}
            <span className="font-body-lg-bold text-body-lg-bold whitespace-nowrap tabular-nums text-on-surface">
              {formatRupees(total)}
            </span>
            .
          </p>
        )}

        <Note tone="info">After the worker says yes, this daily pay cannot be changed.</Note>

        <Button type="submit" full disabled={busy || !found}>
          {busy ? "Sending…" : "Send the offer"}
        </Button>
      </form>
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
        className="flex flex-col gap-space-md px-space-lg py-space-md"
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
                {b.worker.name} · {b.siteName}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-space-md sm:grid-cols-3">
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
              inputMode="decimal"
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
          <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container-low px-space-md py-space-md font-label-md text-label-md text-on-surface-variant">
            <p className="font-body-lg-medium text-body-lg-medium text-on-surface">After this record:</p>
            <dl className="flex flex-col gap-space-xs">
              <Line
                term={`Already recorded: ${formatDays(chosen.daysWorked)} days, earned`}
                amount={formatRupees(chosen.earned)}
              />
              <Line
                strong
                term={`This record: ${formatDays(Number(days))} days at ${formatRupees(chosen.dailyRate)} a day`}
                amount={`+\u00a0${formatRupees(chosen.dailyRate * Number(days))}`}
              />
              <Line
                total
                term={`${chosen.worker.name} will have earned ${formatDays(chosen.daysWorked + Number(days))} days in total`}
                amount={formatRupees(chosen.earned + chosen.dailyRate * Number(days))}
              />
              <Line term="Paid so far" amount={`\u2212\u00a0${formatRupees(chosen.paid)}`} />
              <Line
                total
                strong
                term="Will be outstanding"
                amount={formatRupees(
                  Math.max(0, chosen.earned + chosen.dailyRate * Number(days) - chosen.paid),
                )}
              />
            </dl>
          </div>
        )}

        <Button type="submit" full disabled={busy || !offerId}>
          {busy ? "Saving…" : "Record this work"}
        </Button>
      </form>
    </Card>
  );
}

/**
 * One line of the "After this record" sum: words on the left, the figure on the
 * right. The figure is one unit (its sign stays with it) and never shrinks, so
 * the words wrap instead, and "+" is never left at the end of one line with
 * its amount at the start of the next.
 */
function Line({
  term,
  amount,
  strong = false,
  total = false,
}: {
  term: string;
  amount: string;
  strong?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-space-md ${
        total ? "border-t border-outline-variant pt-space-xs" : ""
      } ${strong ? "text-on-surface" : ""}`}
    >
      <dt>{term}</dt>
      <dd className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? "font-semibold" : ""}`}>{amount}</dd>
    </div>
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
    <li className="flex flex-col gap-space-sm px-space-lg py-space-md">
      <p className="font-body-lg-medium text-body-lg-medium text-on-surface">
        {complaint.raisedBy.name}
        {complaint.claimedAmount
          ? ` says you owe him ${formatRupees(complaint.claimedAmount)}`
          : ""}
      </p>
      <p className="font-label-md text-label-md text-on-surface-variant">{complaint.description}</p>
      {ask && <Note tone="info">The labour office asks: {ask.note}</Note>}
      <Field label="What is your answer?">
        <textarea
          className={inputClass}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Your answer"
          required
        />
      </Field>
      <Button full disabled={busy || note.trim().length < 3} onClick={() => void submit()}>
        {busy ? "Sending…" : "Send my answer"}
      </Button>
    </li>
  );
}
