import { useEffect, useState } from "react";
import { api, storeSession } from "../shared/api";
import type { AuthUser } from "../shared/types";
import DigitBoxes from "../shared/components/DigitBoxes";
import {
  LanguagePicker,
  isLanguage,
  useT,
  type Language,
} from "../shared/i18n";
import type { MessageKey } from "../shared/i18n/en";
import { Button, ErrorNote, inputClass } from "../shared/components/ui";

/**
 * Sign in, register, and forgot PIN. ADR-0013, ADR-0014.
 *
 * One question per screen, because a worker who is not comfortable with
 * technology should never face a form with five boxes. Each screen asks one
 * thing, with one large input and one button.
 *
 *   Sign in:     phone → PIN
 *   New worker:  phone → SMS code → name → home state → PIN → PIN again
 *   Forgot PIN:  phone → SMS code → new PIN → new PIN again
 *
 * The phone is always first, because it is the account. The SMS code comes
 * before the name for a new worker, so nobody gives details for a number he
 * does not hold.
 */

type Flow = "signin" | "register" | "reset";
type Step =
  "phone" | "pin" | "code" | "name" | "state" | "newPin" | "newPinAgain";

const FIRST_AFTER_PHONE: Record<Flow, Step> = {
  signin: "pin",
  register: "code",
  reset: "code",
};

function digitsOf(s: string) {
  return s.replace(/\D/g, "").slice(-10);
}

/** Home states as the server names them, and the key of each name in the dictionaries. */
const STATE_KEY: Record<string, MessageKey> = {
  "West Bengal": "stateWestBengal",
  Bihar: "stateBihar",
  "Uttar Pradesh": "stateUttarPradesh",
  Jharkhand: "stateJharkhand",
  Assam: "stateAssam",
  Odisha: "stateOdisha",
  Kerala: "stateKerala",
};

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export default function Login({
  onSignedIn,
  onHomeStateLanguage,
}: {
  onSignedIn: (user: AuthUser) => void;
  /** The language of the home state a new worker picks. The page uses it only if he chose none. */
  onHomeStateLanguage?: (language: Language) => void;
}) {
  const { t, language } = useT();
  const [flow, setFlow] = useState<Flow>("signin");
  const [step, setStep] = useState<Step>("phone");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [homeState, setHomeState] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinAgain, setNewPinAgain] = useState("");
  const [states, setStates] = useState<{ state: string; language: string }[]>(
    [],
  );

  useEffect(() => {
    if (flow === "register" && states.length === 0) {
      api
        .states()
        .then(setStates)
        .catch(() => setStates([]));
    }
  }, [flow, states.length]);

  /** Start one of the three flows from the beginning. */
  function start(next: Flow) {
    setFlow(next);
    setStep("phone");
    setError("");
    setPin("");
    setCode("");
    setNewPin("");
    setNewPinAgain("");
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  function submitPhone() {
    if (digitsOf(phone).length !== 10) {
      setError(t("phoneInvalid"));
      return;
    }
    if (flow === "signin") {
      setError("");
      setStep("pin");
      return;
    }
    void run(async () => {
      // The SMS comes in the language the page is in. For a reset the server
      // uses the account's own language instead.
      await api.sendPhoneCode({
        phone: digitsOf(phone),
        purpose: flow === "register" ? "REGISTER" : "RESET_PIN",
        language,
      });
      setStep(FIRST_AFTER_PHONE[flow]);
    }, t("errorSendCode"));
  }

  function signIn(fullPin: string) {
    void run(async () => {
      try {
        const { token, user } = await api.login(digitsOf(phone), fullPin);
        storeSession(token, user);
        onSignedIn(user);
      } catch (e) {
        setPin("");
        throw e;
      }
    }, t("errorSignIn"));
  }

  function finish(fullAgain: string) {
    if (fullAgain !== newPin) {
      setError(t("pinsDoNotMatch"));
      setNewPin("");
      setNewPinAgain("");
      setStep("newPin");
      return;
    }
    void run(async () => {
      const { token, user } =
        flow === "register"
          ? await api.register({
              phone: digitsOf(phone),
              code,
              name: name.trim(),
              homeState,
              pin: newPin,
              language,
            })
          : await api.resetPin({ phone: digitsOf(phone), code, pin: newPin });
      storeSession(token, user);
      onSignedIn(user);
    }, t("errorFinish"));
  }

  const title: Record<Flow, string> = {
    signin: t("signIn"),
    register: t("newWorker"),
    reset: t("setNewPin"),
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-sm items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-base font-semibold tracking-tight text-slate-900">
            {t("appTitle")}
          </h1>
          <LanguagePicker />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-10 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              {title[flow]}
            </h2>

            {error && <ErrorNote message={error} />}

            {step === "phone" && (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitPhone();
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    {t("phoneNumber")}
                  </span>
                  <input
                    className={`${inputClass} min-h-12 text-lg`}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t("phonePlaceholder")}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  {busy ? t("sending") : t("next")}
                </Button>
              </form>
            )}

            {step === "pin" && (
              <div className="space-y-4">
                <p className="text-center text-sm text-slate-600">
                  {t("typePin")}
                </p>
                <DigitBoxes
                  label={t("pinLabel")}
                  length={4}
                  value={pin}
                  onChange={setPin}
                  onComplete={signIn}
                  secret
                  autoFocus
                  disabled={busy}
                />
              </div>
            )}

            {step === "code" && (
              <div className="space-y-4">
                <p className="text-center text-sm text-slate-600">
                  {t("codeSent", { phone: digitsOf(phone) })}
                </p>
                <DigitBoxes
                  label={t("codeLabel")}
                  length={6}
                  value={code}
                  onChange={setCode}
                  onComplete={() =>
                    setStep(flow === "register" ? "name" : "newPin")
                  }
                  autoFocus
                />
              </div>
            )}

            {step === "name" && (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim().length < 2) {
                    setError(t("nameInvalid"));
                    return;
                  }
                  setError("");
                  setStep("state");
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    {t("yourName")}
                  </span>
                  <input
                    className={`${inputClass} min-h-12 text-lg`}
                    autoComplete="name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <Button type="submit">{t("next")}</Button>
              </form>
            )}

            {step === "state" && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{t("whichState")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {states.map((s) => (
                    <button
                      key={s.state}
                      type="button"
                      onClick={() => {
                        setHomeState(s.state);
                        if (isLanguage(s.language))
                          onHomeStateLanguage?.(s.language);
                        setStep("newPin");
                      }}
                      className="min-h-12 rounded-lg bg-white px-3 py-3 text-left text-base font-medium text-slate-800 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      {STATE_KEY[s.state] ? t(STATE_KEY[s.state]!) : s.state}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "newPin" && (
              <div className="space-y-4">
                <p className="text-center text-sm text-slate-600">
                  {t("choosePin")}
                </p>
                <DigitBoxes
                  label={t("pinLabel")}
                  length={4}
                  value={newPin}
                  onChange={setNewPin}
                  onComplete={() => setStep("newPinAgain")}
                  secret
                  autoFocus
                />
                <p className="text-center text-xs text-slate-500">
                  {t("neverTellPin")}
                </p>
              </div>
            )}

            {step === "newPinAgain" && (
              <div className="space-y-4">
                <p className="text-center text-sm text-slate-600">
                  {t("typePinAgain")}
                </p>
                <DigitBoxes
                  label={t("pinAgainLabel")}
                  length={4}
                  value={newPinAgain}
                  onChange={setNewPinAgain}
                  onComplete={finish}
                  secret
                  autoFocus
                  disabled={busy}
                />
              </div>
            )}

            {step !== "phone" && (
              <button
                type="button"
                onClick={() => start(flow)}
                className="block w-full text-center text-sm text-slate-500 underline"
              >
                {t("startAgain")}
              </button>
            )}
          </div>

          <div className="mt-5 flex flex-col items-center gap-2 text-sm">
            {flow !== "register" && (
              <button
                type="button"
                onClick={() => start("register")}
                className="font-medium text-sky-700 underline"
              >
                {t("makeAccount")}
              </button>
            )}
            {flow !== "reset" && (
              <button
                type="button"
                onClick={() => start("reset")}
                className="font-medium text-sky-700 underline"
              >
                {t("forgotPin")}
              </button>
            )}
            {flow !== "signin" && (
              <button
                type="button"
                onClick={() => start("signin")}
                className="font-medium text-sky-700 underline"
              >
                {t("havePin")}
              </button>
            )}
            <p className="mt-2 text-center text-xs text-slate-500">
              {t("staffNote")}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
