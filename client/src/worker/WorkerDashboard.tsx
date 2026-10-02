import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../shared/api";
import type { AuthUser, AwaitingItem, ContractBalance, Disagreement, Offer } from "../shared/types";
import BalanceCard from "../shared/components/BalanceCard";
import { useT } from "../shared/i18n";
import DisagreementList from "../shared/components/DisagreementList";
import Icon from "../shared/components/Icon";
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

  const owedId = useId();

  if (loading) return <EmptyState>{t("pleaseWait")}</EmptyState>;

  const totalOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);

  return (
    <div className="flex flex-col gap-space-lg">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      {/* The number he came for, first and largest (design W1). */}
      {totalOwed > 0 && (
        <section
          aria-labelledby={owedId}
          className="flex flex-col gap-space-xs rounded-xl bg-primary px-space-lg py-space-lg text-on-primary shadow-sm"
        >
          <p id={owedId} className="font-body-lg-medium text-body-lg-medium">
            {t("owedHeadline", { name: user.name, count: balances.length })}
          </p>
          <p className="font-headline-lg text-[40px] leading-[48px] tabular-nums">{formatRupees(totalOwed)}</p>
        </section>
      )}

      {offers.length > 0 && (
        <Card
          title={t("offerTitle")}
          description={t("offerDescription")}
        >
          <ul className="divide-y divide-outline-variant">
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
          <ul className="divide-y divide-outline-variant">
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

      <div className="flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">{t("yourWork")}</h2>
        {balances.length === 0 ? (
          <Card>
            <EmptyState>{t("noJobYet")}</EmptyState>
          </Card>
        ) : (
          <div className="flex flex-col gap-space-md">
            {balances.map((b) => (
              <BalanceCard
                key={b.offerId}
                balance={b}
                viewer="WORKER"
                footer={
                  <div className="flex flex-col gap-space-sm">
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {t(
                        !b.acceptedVia ? "saidYesOn" : b.acceptedVia === "SMS" ? "saidYesBySms" : "saidYesByApp",
                        { date: b.acceptedAt ? formatDate(b.acceptedAt) : "—" },
                      )}
                      {b.openComplaints > 0 && ` · ${t("openComplaints", { count: b.openComplaints })}`}
                    </p>
                    {onFileComplaint && b.openComplaints === 0 && (
                      <Button variant="secondary" icon="support_agent" full onClick={onFileComplaint}>
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
    <li className="flex flex-col gap-space-md px-space-lg py-space-md">
      <div className="flex items-start justify-between gap-space-md">
        <div className="min-w-0">
          <p className="font-body-lg-bold text-body-lg-bold break-words text-on-surface">
            {t("offerAt", { work: offer.workType, site: offer.siteName })}
          </p>
          <p className="font-label-md text-label-md break-words text-on-surface-variant">
            {offer.contractor.name}
            {offer.contractor.company ? ` · ${offer.contractor.company}` : ""}
          </p>
        </div>
        {/* The agreed pay, which locks when he says yes. */}
        <p className="shrink-0 rounded-lg bg-secondary-container px-space-sm py-space-xs text-right text-on-secondary-container">
          <span className="block font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap">
            {formatRupees(offer.dailyRate)}
          </span>
          <span className="block font-label-sm text-label-sm">{t("aDay")}</span>
        </p>
      </div>

      <p className="flex items-start gap-space-sm font-label-md text-label-md text-on-surface-variant">
        <Icon name="calendar_month" size={18} className="mt-0.5 shrink-0" />
        {t("offerMeta", { date: formatDate(offer.startDate), days: offer.expectedDays })}
      </p>
      {offer.extraTerms && (
        <p className="font-label-md text-label-md break-words text-on-surface">{t("alsoPromised", { terms: offer.extraTerms })}</p>
      )}

      <p className="flex items-start gap-space-sm rounded-lg bg-surface-container-low px-space-md py-space-sm font-body-lg text-body-lg text-on-surface">
        <Icon name="payments" className="mt-0.5 shrink-0 text-primary" />
        {t("offerTotal", {
          days: offer.expectedDays,
          amount: formatRupees(offer.dailyRate * offer.expectedDays),
        })}
      </p>

      {!refusing ? (
        <div className="flex flex-col gap-space-sm">
          <Button variant="primary" size="page" icon="check_circle" busy={busy} onClick={() => void respond("ACCEPT")}>
            {busy ? t("sending") : t("yesTakeWork")}
          </Button>
          <Button variant="secondary" full disabled={busy} onClick={() => setRefusing(true)}>
            {t("noDontWant")}
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-space-sm">
            <OfferBadge status={offer.status} />
            {offer.ref && (
              <span className="flex items-center gap-space-xs font-label-md text-label-md text-on-surface-variant">
                <Icon name="sms" size={18} className="shrink-0" />
                {t("replyYesSms", { ref: offer.ref })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-space-sm">
          <Field label={t("whySayNo")}>
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-space-sm">
            <Button variant="danger" full busy={busy} onClick={() => void respond("DECLINE")}>
              {busy ? t("sending") : t("sendMyNo")}
            </Button>
            <Button variant="ghost" full onClick={() => setRefusing(false)}>
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
    <li className="flex flex-col gap-space-md px-space-lg py-space-md">
      <div className="flex items-start gap-space-md">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name={isWork ? "calendar_month" : "payments"} size={22} />
        </span>
        <div className="flex min-w-0 flex-col gap-space-xs">
          <p className="font-body-lg-bold text-body-lg-bold break-words text-on-surface">
            {isWork
              ? t("heSaysDays", { days: formatDays(item.days ?? 0) })
              : t("heSaysPaid", { amount: formatRupees(item.amount ?? 0) })}
          </p>
          <p className="font-label-md text-label-md break-words text-on-surface-variant">
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
          {/* What the days are worth, on its own line under the dates, so it
              never floats alone at the right edge of a narrow phone. */}
          {isWork && item.worth !== undefined && (
            <p className="font-label-md text-label-md text-on-surface">
              {t("worthLabel")}{" "}
              <span className="font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap">
                {formatRupees(item.worth)}
              </span>
            </p>
          )}
          {item.note && (
            <p className="font-label-md text-label-md break-words text-on-surface">{t("heWrote", { note: item.note })}</p>
          )}
        </div>
      </div>

      {!objecting ? (
        <div className="flex flex-col gap-space-sm">
          {/* The two answers side by side and the same size, so neither looks
              like the one he is expected to choose. Below 360px they stack,
              because each would be 124px wide and the Malayalam answer would
              take three lines. */}
          <div className="grid grid-cols-2 gap-space-sm max-[359px]:grid-cols-1">
            <Button variant="primary" full busy={busy} onClick={() => void decide("CONFIRM")}>
              {busy ? t("sending") : isWork ? t("yesCorrect") : t("yesGotMoney")}
            </Button>
            <Button variant="danger-tonal" full disabled={busy} onClick={() => setObjecting(true)}>
              {isWork ? t("noNotCorrect") : t("noDidNotGet")}
            </Button>
          </div>
          {item.ref && (
            <p className="flex items-center justify-center gap-space-xs text-center font-label-md text-label-md text-on-surface-variant">
              <Icon name="sms" size={18} className="shrink-0" />
              {t("replyOkWrongSms", { ref: item.ref })}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-space-md rounded-xl bg-error-container/40 p-space-md ring-1 ring-error-container">
          <Field
            label={isWork ? t("realDays") : t("realMoney")}
            hint={t("writeRightNumber")}
          >
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
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
          <div className="grid grid-cols-2 gap-space-sm">
            <Button variant="danger" full busy={busy} onClick={() => void decide("REJECT")}>
              {busy ? t("sending") : t("sendMyAnswer")}
            </Button>
            <Button variant="ghost" full onClick={() => setObjecting(false)}>
              {t("goBack")}
            </Button>
          </div>
          <InfoNote>{t("officeSeesBoth")}</InfoNote>
        </div>
      )}
    </li>
  );
}
