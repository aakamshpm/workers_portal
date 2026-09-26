import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type { AuthUser, AwaitingItem, ContractBalance, Disagreement, Offer } from "../shared/types";
import BalanceCard from "../shared/components/BalanceCard";
import { useT } from "../shared/i18n";
import DisagreementList from "../shared/components/DisagreementList";
import {
  Button,
  Card,
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

/**
 * What the worker sees.
 *
 * Ordered by what needs an answer, not by what is newest. Job offers first,
 * because terms lock on acceptance. Then records the contractor wrote that the
 * worker has not checked, because an unanswered work record is how an
 * understated week becomes permanent. The money comes last: it is the reason the
 * worker is here, but it is a consequence of the two lists above.
 */
export default function WorkerDashboard({
  user,
  onFileComplaint,
}: {
  user: AuthUser;
  onFileComplaint?: () => void;
}) {
  const { t } = useT();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [awaiting, setAwaiting] = useState<AwaitingItem[]>([]);
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [o, a, b, d] = await Promise.all([
        api.offers("PENDING"),
        api.awaiting(),
        api.balances(),
        api.disagreements(),
      ]);
      setOffers(o);
      setAwaiting(a);
      setBalances(b);
      setDisagreements(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoadWork"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>{t("pleaseWait")}</EmptyState>;

  const totalOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      {totalOwed > 0 && (
        <div className="rounded-lg bg-slate-900 px-5 py-4 text-white">
          <p className="text-xs text-slate-300">
            {t("owedHeadline", { name: user.name, count: balances.length })}
          </p>
          <p className="text-3xl font-semibold tabular-nums">{formatRupees(totalOwed)}</p>
        </div>
      )}

      {offers.length > 0 && (
        <Card
          title={t("offerTitle")}
          description={t("offerDescription")}
        >
          <ul className="divide-y divide-slate-200">
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
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

      <Card
        title={t("checkTitle")}
        description={t("checkDescription")}
      >
        {awaiting.length === 0 ? (
          <EmptyState>{t("nothingWaiting")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {awaiting.map((item) => (
              <AwaitingRow
                key={`${item.kind}-${item.id}`}
                item={item}
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

      {disagreements.length > 0 && (
        <DisagreementList
          items={disagreements}
          viewer="WORKER"
          onDone={(msg) => {
            setFlash(msg);
            void load();
          }}
          onError={setError}
        />
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">{t("yourWork")}</h2>
        {balances.length === 0 ? (
          <Card>
            <EmptyState>{t("noJobYet")}</EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {balances.map((b) => (
              <BalanceCard
                key={b.offerId}
                balance={b}
                viewer="WORKER"
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {t(
                        !b.acceptedVia ? "saidYesOn" : b.acceptedVia === "SMS" ? "saidYesBySms" : "saidYesByApp",
                        { date: b.acceptedAt ? formatDate(b.acceptedAt) : "—" },
                      )}
                      {b.openComplaints > 0 && ` · ${t("openComplaints", { count: b.openComplaints })}`}
                    </p>
                    {onFileComplaint && b.openComplaints === 0 && (
                      <Button variant="secondary" size="sm" onClick={onFileComplaint}>
                        {t("askOfficeHelp")}
                      </Button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One pending job offer, with accept and refuse. */
function OfferRow({
  offer,
  onDone,
  onError,
}: {
  offer: Offer;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  async function respond(decision: "ACCEPT" | "DECLINE") {
    setBusy(true);
    try {
      await api.respondToOffer(offer.id, decision, reason || undefined);
      onDone(
        decision === "ACCEPT"
          ? t("acceptedFlash", { amount: formatRupees(offer.dailyRate), site: offer.siteName })
          : t("declinedFlash"),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : t("errorSendAnswer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {t("offerAt", { work: offer.workType, site: offer.siteName })}
          </p>
          <p className="text-xs text-slate-500">
            {offer.contractor.name}
            {offer.contractor.company ? ` · ${offer.contractor.company}` : ""} ·{" "}
            {t("offerMeta", { date: formatDate(offer.startDate), days: offer.expectedDays })}
          </p>
          {offer.extraTerms && (
            <p className="mt-1 text-xs text-slate-600">{t("alsoPromised", { terms: offer.extraTerms })}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {formatRupees(offer.dailyRate)}
          </p>
          <p className="text-xs text-slate-500">{t("aDay")}</p>
        </div>
      </div>

      <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {t("offerTotal", {
          days: offer.expectedDays,
          amount: formatRupees(offer.dailyRate * offer.expectedDays),
        })}
      </div>

      {!refusing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" disabled={busy} onClick={() => void respond("ACCEPT")}>
            {busy ? t("sending") : t("yesTakeWork")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRefusing(true)}>
            {t("noDontWant")}
          </Button>
          <OfferBadge status={offer.status} />
          {offer.ref && (
            <span className="text-xs text-slate-400">
              {t("replyYesSms", { ref: offer.ref })}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label={t("whySayNo")}>
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void respond("DECLINE")}>
              {busy ? t("sending") : t("sendMyNo")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
              {t("goBack")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * One record needing OK or WRONG.
 *
 * Rejecting asks for the worker's own figure. "That is wrong" alone leaves the
 * labour officer with a disagreement and no shape to it; "he wrote 3 days, I
 * worked 6" gives them a specific gap worth a specific amount.
 */
function AwaitingRow({
  item,
  onDone,
  onError,
}: {
  item: AwaitingItem;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [objecting, setObjecting] = useState(false);
  const [workerValue, setWorkerValue] = useState("");
  const [note, setNote] = useState("");

  const isWork = item.kind === "WORK";

  async function decide(decision: "CONFIRM" | "REJECT") {
    setBusy(true);
    try {
      await api.confirmRecord({
        kind: item.kind,
        id: item.id,
        decision,
        workerValue: workerValue ? Number(workerValue) : undefined,
        note: note || undefined,
      });
      onDone(
        decision === "CONFIRM"
          ? t("confirmedFlash")
          : t("rejectedFlash"),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : t("errorSendAnswer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {isWork
              ? t("heSaysDays", { days: formatDays(item.days ?? 0) })
              : t("heSaysPaid", { amount: formatRupees(item.amount ?? 0) })}
          </p>
          <p className="text-xs text-slate-500">
            {isWork
              ? t("dateRange", { from: formatDate(item.fromDate!), to: formatDate(item.toDate!) })
              : t("paidOnBy", {
                  date: formatDate(item.paidOn!),
                  method: item.method === "CASH" ? t("methodCash") : (item.method ?? ""),
                })}
            {" · "}
            {item.contractorName}
            {item.company ? ` (${item.company})` : ""} · {item.siteName}
          </p>
          {item.note && <p className="mt-1 text-xs text-slate-600">{t("heWrote", { note: item.note })}</p>}
        </div>
        {isWork && item.worth !== undefined && (
          <div className="text-right">
            <p className="text-xs text-slate-500">{t("worthLabel")}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900">
              {formatRupees(item.worth)}
            </p>
          </div>
        )}
      </div>

      {!objecting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" disabled={busy} onClick={() => void decide("CONFIRM")}>
            {busy ? t("sending") : isWork ? t("yesCorrect") : t("yesGotMoney")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setObjecting(true)}>
            {isWork ? t("noNotCorrect") : t("noDidNotGet")}
          </Button>
          {item.ref && (
            <span className="text-xs text-slate-400">
              {t("replyOkWrongSms", { ref: item.ref })}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-md bg-rose-50 p-3 ring-1 ring-inset ring-rose-200">
          <Field
            label={isWork ? t("realDays") : t("realMoney")}
            hint={t("writeRightNumber")}
          >
            <input
              className={inputClass}
              type="number"
              step={isWork ? "0.5" : "1"}
              min="0"
              value={workerValue}
              onChange={(e) => setWorkerValue(e.target.value)}
              placeholder={isWork ? "6" : "0"}
            />
          </Field>
          <Field label={t("addAnything")}>
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void decide("REJECT")}>
              {busy ? t("sending") : t("sendMyAnswer")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setObjecting(false)}>
              {t("goBack")}
            </Button>
          </div>
          <InfoNote>{t("officeSeesBoth")}</InfoNote>
        </div>
      )}
    </li>
  );
}
