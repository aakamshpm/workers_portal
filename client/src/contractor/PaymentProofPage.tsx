import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type { ContractBalance, PaymentRow, PendingCode } from "../shared/types";
import {
  Button,
  Card,
  ConfirmBadge,
  EmptyState,
  ErrorNote,
  EvidenceBadge,
  Field,
  formatDate,
  formatRupees,
  InfoNote,
  inputClass,
  SuccessNote,
} from "../shared/components/ui";

const today = () => new Date().toISOString().slice(0, 10);

type Method = "CASH_CODE" | "CASH_PLAIN" | "TRANSFER";

/**
 * Recording a payment, with or without proof.
 *
 * Its own page because the cash handover is a two-person action that takes three
 * steps and needs explaining on screen. The three methods are kept visibly
 * separate rather than hidden behind one dropdown, because they produce evidence
 * of genuinely different strength and the contractor should see that when
 * choosing.
 */
export default function PaymentProofPage({
  initialOfferId,
}: {
  initialOfferId?: string;
}) {
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [history, setHistory] = useState<PaymentRow[]>([]);
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [offerId, setOfferId] = useState(initialOfferId ?? "");
  const [method, setMethod] = useState<Method>("CASH_CODE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [b, h, p] = await Promise.all([
        api.balances(),
        api.paymentHistory(),
        api.pendingCode(),
      ]);
      setBalances(b);
      setHistory(h);
      setPending(p);
      // A handover already in progress decides which contract is on screen. This
      // is what makes the flow survive a page refresh mid-payment.
      if (p) {
        setOfferId(p.offerId);
        setMethod("CASH_CODE");
      } else if (!offerId && b.length > 0) {
        setOfferId(initialOfferId ?? b[0].offerId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the payments. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [initialOfferId, offerId]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function done(msg: string) {
    setFlash(msg);
    void load();
  }

  if (loading) return <EmptyState>Please wait…</EmptyState>;
  if (balances.length === 0) {
    return (
      <Card>
        <EmptyState>
          No worker has taken a job from you yet, so there is nobody to pay. Offer work first.
        </EmptyState>
      </Card>
    );
  }

  const chosen = balances.find((b) => b.offerId === offerId);

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      <Card
        title="Pay a worker"
        description="Choose how you paid."
      >
        <div className="space-y-4 px-5 py-4">
          <Field label="Worker being paid">
            <select
              className={inputClass}
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              disabled={!!pending}
            >
              {balances.map((b) => (
                <option key={b.offerId} value={b.offerId}>
                  {b.worker.name} · {b.siteName} · you owe {formatRupees(Math.max(0, b.balance))}
                </option>
              ))}
            </select>
          </Field>

          {chosen && chosen.balance > 0 && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {chosen.worker.name} has earned {formatRupees(chosen.earned)} and been paid{" "}
              {formatRupees(chosen.paid)}, leaving{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRupees(chosen.balance)}
              </span>{" "}
              outstanding.
            </div>
          )}

          {pending ? (
            <InfoNote>
              A code for {formatRupees(pending.amount)} is already active on{" "}
              {pending.worker?.name ?? "the worker"}'s phone. Complete that payment first, or wait
              for the code to expire.
            </InfoNote>
          ) : (
            <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1 text-xs">
              {(
                [
                  { id: "CASH_CODE", label: "Cash, with a code" },
                  { id: "TRANSFER", label: "UPI or bank" },
                  { id: "CASH_PLAIN", label: "Cash, no proof" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
                    method === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {offerId &&
            (method === "CASH_CODE" ? (
              <CashCodeFlow
                offerId={offerId}
                pending={pending}
                onDone={done}
                onError={setError}
              />
            ) : method === "TRANSFER" ? (
              <TransferForm offerId={offerId} onDone={done} onError={setError} />
            ) : (
              <PlainCashForm offerId={offerId} onDone={done} onError={setError} />
            ))}
        </div>
      </Card>

      <Card
        title="Payments already recorded"
        description="The label shows what proof each payment has."
      >
        {history.length === 0 ? (
          <EmptyState>No payments recorded yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {formatRupees(p.amount)}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      to {p.worker.name} · in {p.method === "CASH" ? "cash" : p.method}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(p.paidOn)} · {p.siteName}
                    {p.proofReference ? ` · number ${p.proofReference}` : ""}
                  </p>
                  {p.confirmState === "DISPUTED" && (
                    <p className="mt-1 text-xs text-rose-700">
                      {p.worker.name} says he only got{" "}
                      {p.workerClaimsAmount !== null
                        ? formatRupees(p.workerClaimsAmount)
                        : "nothing"}
                      {p.disputeNote ? ` — "${p.disputeNote}"` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <EvidenceBadge evidence={p.evidence} />
                  <ConfirmBadge state={p.confirmState} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * The cash handover in two steps.
 *
 * Step 1 sends a 4-digit code to the worker's phone. Step 2 asks the contractor
 * to type back what the worker read out. The code never appears on the
 * contractor's screen, which is the whole point: typing it back is only possible
 * if the worker was standing there.
 *
 * This is deliberately not the worker's login PIN. A PIN typed into the
 * contractor's phone would let him sign in as the worker afterwards and confirm
 * his own records.
 */
function CashCodeFlow({
  offerId,
  pending,
  onDone,
  onError,
}: {
  offerId: string;
  pending: PendingCode | null;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ workerName: string; workerPhone: string } | null>(null);

  async function requestCode() {
    setBusy(true);
    try {
      const r = await api.requestCode(offerId, Number(amount));
      setSent({ workerName: r.workerName, workerPhone: r.workerPhone });
      onDone(
        `A 4-digit code has been sent to ${r.workerName}'s phone. Ask him to read it out to you. It expires in ${r.expiresInMinutes} minutes.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await api.confirmCode({ offerId, code, paidOn, note: note || undefined });
      onDone(
        `${formatRupees(r.amount)} recorded for ${r.workerName}.`,
      );
      setCode("");
      setAmount("");
      setSent(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "That code was not accepted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = pending ?? (sent ? { amount: Number(amount) } : null);

  return (
    <div className="space-y-3">
      {!waiting ? (
        <>
          <Field label="Amount you are paying (₹)">
            <input
              className={inputClass}
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="8000"
            />
          </Field>
          <InfoNote>The code goes to the worker's phone. Ask him to read it to you.</InfoNote>
          <Button disabled={busy || !amount} onClick={() => void requestCode()}>
            {busy ? "Sending…" : "Send code to the worker's phone"}
          </Button>
        </>
      ) : (
        <div className="space-y-3 rounded-md bg-sky-50 p-4 ring-1 ring-inset ring-sky-200">
          <p className="text-sm text-sky-900">
            The code for{" "}
            <span className="font-semibold tabular-nums">
              {formatRupees(pending?.amount ?? Number(amount))}
            </span>{" "}
            has been sent to {pending?.worker ? `${pending.worker.name}'s` : "the worker's"} phone.
            Hand over the money, then ask him to read the code out to you.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Enter the code the worker reads out">
              <input
                className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
                inputMode="numeric"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="0000"
              />
            </Field>
            <Field label="Date paid">
              <input
                className={inputClass}
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <Field label="Note (optional)">
              <input
                className={inputClass}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Pay for week 3"
              />
            </Field>
          </div>

          <Button variant="success" disabled={busy || code.length !== 4} onClick={() => void confirm()}>
            {busy ? "Verifying…" : "Verify code"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** UPI or bank transfer. The bank is the witness, so no code is needed. */
function TransferForm({
  offerId,
  onDone,
  onError,
}: {
  offerId: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [transferMethod, setTransferMethod] = useState<"UPI" | "BANK">("UPI");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.recordTransfer({
        offerId,
        amount: Number(amount),
        paidOn,
        method: transferMethod,
        reference,
        note: note || undefined,
      });
      onDone("Recorded.");
      setAmount("");
      setReference("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount sent (₹)">
          <input
            className={inputClass}
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Method">
          <select
            className={inputClass}
            value={transferMethod}
            onChange={(e) => setTransferMethod(e.target.value as "UPI" | "BANK")}
          >
            <option value="UPI">UPI</option>
            <option value="BANK">Bank</option>
          </select>
        </Field>
        <Field label="Transaction number" hint="Copy this from your UPI app or your bank message.">
          <input
            className={inputClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Reference number"
            required
          />
        </Field>
        <Field label="Date sent">
          <input
            className={inputClass}
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Final payment, work complete"
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Record this payment"}
      </Button>
    </form>
  );
}

/** Cash with nothing attached. Allowed, and labelled for what it is. */
function PlainCashForm({
  offerId,
  onDone,
  onError,
}: {
  offerId: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.recordPayment({
        offerId,
        amount: Number(amount),
        paidOn,
        method: "CASH",
        note: note || undefined,
      });
      onDone(
        "Recorded. The worker will be asked to confirm it.",
      );
      setAmount("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount paid (₹)">
          <input
            className={inputClass}
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Date paid">
          <input
            className={inputClass}
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Note (optional)">
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Advance for travel"
        />
      </Field>
      <InfoNote>The worker will be asked to confirm this payment.</InfoNote>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Record without proof"}
      </Button>
    </form>
  );
}
