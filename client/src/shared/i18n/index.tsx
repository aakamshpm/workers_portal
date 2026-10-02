import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey, type Messages } from "./en";
import { hi } from "./hi";
import { bn } from "./bn";
import { ml } from "./ml";
import { or } from "./or";
import Icon from "../components/Icon";

/**
 * Worker text in five languages. ADR-0015.
 *
 * No library: one typed dictionary per language. `en.ts` is the source, and
 * every other file has the type `Messages`, so tsc fails when a key is missing
 * or extra. The codes are the same as `User.language` and the SMS messages.
 */

export type Language = "en" | "hi" | "bn" | "ml" | "or";

/** Each language named in its own script, so a worker finds his without reading English. */
export const LANGUAGES: { code: Language; name: string }[] = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी" },
  { code: "bn", name: "বাংলা" },
  { code: "ml", name: "മലയാളം" },
  { code: "or", name: "ଓଡ଼ିଆ" },
];

export const DICTIONARIES: Record<Language, Messages> = { en, hi, bn, ml, or };

/** Home states as the server names them, and the key of each name in the dictionaries. */
export const STATE_KEY: Record<string, MessageKey> = {
  "West Bengal": "stateWestBengal",
  Bihar: "stateBihar",
  "Uttar Pradesh": "stateUttarPradesh",
  Jharkhand: "stateJharkhand",
  Assam: "stateAssam",
  Odisha: "stateOdisha",
  Kerala: "stateKerala",
};

/** A home state in the reader's language, or as the server wrote it when it has no translation. */
export function stateName(t: T, state: string): string {
  const key = STATE_KEY[state];
  return key ? t(key) : state;
}

export function isLanguage(code: unknown): code is Language {
  return typeof code === "string" && code in DICTIONARIES;
}

export type Vars = Record<string, string | number>;

/** One text in one language, with {placeholders} filled in. Falls back to English. */
export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  const dict = isLanguage(language) ? DICTIONARIES[language] : en;
  const text = dict[key] || en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : text;
}

export type T = (key: MessageKey, vars?: Vars) => string;

interface I18n {
  language: Language;
  t: T;
  /** Absent outside a provider: the contractor and officer apps have no choice. */
  setLanguage?: (language: Language) => void;
}

// Outside a provider everything is English. The contractor and officer apps
// use the same shared components and never mount a provider.
const Context = createContext<I18n>({ language: "en", t: (key, vars) => translate("en", key, vars) });

export function useT(): I18n {
  return useContext(Context);
}

/**
 * Chooses the language for everything inside it, and tells the browser, so a
 * screen reader reads the page with the right voice.
 */
export function I18nProvider({
  initial,
  language: controlled,
  onChange,
  children,
}: {
  /** The first language, when the provider keeps the choice itself. */
  initial?: string | null;
  /** Set by a parent that keeps the choice itself, as the sign-in page does. */
  language?: Language;
  /** Called after the reader picks a language, to save the choice. */
  onChange?: (language: Language) => void;
  children: ReactNode;
}) {
  const [own, setOwn] = useState<Language>(isLanguage(initial) ? initial : "en");
  const language = controlled ?? own;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(
    (next: Language) => {
      if (controlled === undefined) setOwn(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  const value = useMemo<I18n>(
    () => ({ language, setLanguage, t: (key, vars) => translate(language, key, vars) }),
    [language, setLanguage],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The language list. Shown only inside a provider.
 *
 * A globe and the current language's name, each in its own script, so a
 * worker who cannot read the current language still knows what the control
 * is. The real <select> lies over the whole pill, transparent, so a tap
 * anywhere on it opens the phone's own list and the keyboard reaches it.
 *
 * `compact` is the signed-in worker header, which also holds his account
 * button. On a phone narrower than 420px it shows the globe alone, because
 * "പണിക്കൂലി കണക്ക്" with "മലയാളം" beside it does not fit a 360px screen.
 * The list itself is unchanged.
 */
export function LanguagePicker({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { language, setLanguage, t } = useT();
  if (!setLanguage) return null;
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]!;
  return (
    <div
      className={`relative inline-flex min-h-[var(--size-touch)] min-w-[var(--size-touch)] shrink-0 items-center justify-center gap-space-xs rounded-full bg-surface-container px-space-md text-on-surface focus-within:ring-2 focus-within:ring-primary ${
        compact ? "max-[419px]:px-0" : ""
      } ${className}`}
    >
      <Icon name="language" className="shrink-0 text-primary" />
      <span
        aria-hidden="true"
        lang={current.code}
        className={`font-label-md text-label-md whitespace-nowrap text-on-surface ${compact ? "max-[419px]:hidden" : ""}`}
      >
        {current.name}
      </span>
      <select
        aria-label={t("language")}
        value={language}
        onChange={(e) => {
          if (isLanguage(e.target.value)) setLanguage(e.target.value);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
