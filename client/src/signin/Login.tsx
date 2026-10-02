import { useEffect, useState } from "react";
import { api, storeSession } from "../shared/api";
import type { AuthUser } from "../shared/types";
import DigitBoxes from "../shared/components/DigitBoxes";
import AppHeader from "../shared/components/AppHeader";
import Icon from "../shared/components/Icon";
import {
  LanguagePicker,
  isLanguage,
  useT,
  type Language,
} from "../shared/i18n";
import type { MessageKey } from "../shared/i18n/en";
import { Button, ChoiceRow, Note, TextField, formatPhone } from "../shared/components/ui";

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

  /**
   * The one question each screen asks, as its only h1 (ADR-0019). A screen
   * reader user who jumps to the first heading hears what the screen wants.
   * The phone screen's question is the flow itself: "Sign in", "New worker".
   */
  const question: Record<Step, string> = {
    phone: title[flow],
    pin: t("typePin"),
    code: t("codeSent", { phone: formatPhone(digitsOf(phone)) }),
    name: t("yourName"),
    state: t("whichState"),
    newPin: t("choosePin"),
    newPinAgain: t("typePinAgain"),
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <AppHeader title={t("appTitle")}>
        <LanguagePicker />
      </AppHeader>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-space-xl px-margin pt-space-xl pb-space-2xl">
        <div className="flex flex-col gap-space-xs">
          {/* After the phone screen, the flow's name sits above the question,
              so a worker halfway through "Forgot PIN" still knows where he is. */}
          {step !== "phone" && (
            <p className="font-label-md text-label-md text-primary">{title[flow]}</p>
          )}
          <h1 className="font-headline-md text-headline-md text-on-surface">{question[step]}</h1>
        </div>

        {error && <Note tone="error">{error}</Note>}

        {step === "phone" && (
          <form
            className="flex flex-col gap-space-lg"
            onSubmit={(e) => {
              e.preventDefault();
              submitPhone();
            }}
          >
            <TextField
              label={t("phoneNumber")}
              prefix="+91"
              type="tel"
              numeric
              autoComplete="tel-national"
              autoFocus
              value={phone}
              onChange={setPhone}
              placeholder={t("phonePlaceholder")}
            />
            <Button type="submit" size="page" busy={busy}>
              {busy ? t("sending") : t("next")}
              {!busy && <Icon name="arrow_forward" />}
            </Button>
          </form>
        )}

        {step === "pin" && (
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
        )}

        {step === "code" && (
          <DigitBoxes
            label={t("codeLabel")}
            length={6}
            value={code}
            onChange={setCode}
            onComplete={() => setStep(flow === "register" ? "name" : "newPin")}
            autoFocus
          />
        )}

        {step === "name" && (
          <form
            className="flex flex-col gap-space-lg"
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
            {/* The heading already asks "Your name", so the label is for a
                screen reader only. */}
            <TextField
              label={t("yourName")}
              hideLabel
              autoComplete="name"
              autoFocus
              value={name}
              onChange={setName}
            />
            <Button type="submit" size="page">
              {t("next")}
              <Icon name="arrow_forward" />
            </Button>
          </form>
        )}

        {step === "state" && (
          <ul className="flex flex-col gap-space-sm">
            {states.map((s) => (
              <li key={s.state}>
                <ChoiceRow
                  label={STATE_KEY[s.state] ? t(STATE_KEY[s.state]!) : s.state}
                  selected={homeState === s.state}
                  onChoose={() => {
                    setHomeState(s.state);
                    if (isLanguage(s.language)) onHomeStateLanguage?.(s.language);
                    setStep("newPin");
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {step === "newPin" && (
          <div className="flex flex-col gap-space-lg">
            <DigitBoxes
              label={t("pinLabel")}
              length={4}
              value={newPin}
              onChange={setNewPin}
              onComplete={() => setStep("newPinAgain")}
              secret
              autoFocus
            />
            <Note tone="warning">{t("neverTellPin")}</Note>
          </div>
        )}

        {step === "newPinAgain" && (
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
        )}

        {/* The digit boxes are disabled while the server answers, and without
            this line they look broken. */}
        {busy && step !== "phone" && (
          <p
            role="status"
            className="flex items-center justify-center gap-space-sm font-body-lg-medium text-body-lg-medium text-primary"
          >
            <Icon name="progress_activity" spin />
            {t("pleaseWait")}
          </p>
        )}

        {step !== "phone" && (
          <div className="flex justify-center">
            <Button variant="ghost" icon="arrow_back" onClick={() => start(flow)}>
              {t("startAgain")}
            </Button>
          </div>
        )}

        {/* The other flows are offered only before the phone is given. After
            that, "Start again" is the only way out, so the screen still asks
            one thing. */}
        {step === "phone" && (
        <div className="flex flex-col gap-space-sm border-t border-outline-variant pt-space-lg">
          {flow !== "register" && (
            <Button variant="secondary" size="page" onClick={() => start("register")}>
              {t("makeAccount")}
            </Button>
          )}
          {flow !== "reset" && (
            <Button variant="ghost" onClick={() => start("reset")}>
              {t("forgotPin")}
            </Button>
          )}
          {flow !== "signin" && (
            <Button variant="ghost" onClick={() => start("signin")}>
              {t("havePin")}
            </Button>
          )}
          <Note tone="info">{t("staffNote")}</Note>
        </div>
        )}
      </main>
    </div>
  );
}
