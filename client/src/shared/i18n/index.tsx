import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey, type Messages } from "./en";
import { hi } from "./hi";
import { bn } from "./bn";
import { ml } from "./ml";
import { or } from "./or";

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
 * A globe icon and the word "Language" in the page's current language sit next
 * to the list, so a worker who cannot read the current language still knows
 * what the control is. Each option is in its own script.
 */
export function LanguagePicker({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useT();
  if (!setLanguage) return null;
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-slate-600 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
      <span className="sr-only">{t("language")}</span>
      <select
        aria-label={t("language")}
        value={language}
        onChange={(e) => {
          if (isLanguage(e.target.value)) setLanguage(e.target.value);
        }}
        className="min-h-10 rounded-md border-0 bg-white py-1.5 pr-8 pl-3 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
