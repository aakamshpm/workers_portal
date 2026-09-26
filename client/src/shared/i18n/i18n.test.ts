import { describe, expect, it } from "vitest";
import { en, type MessageKey } from "./en";
import { DICTIONARIES, LANGUAGES, isLanguage, translate } from "./index";

/**
 * Worker text in five languages. ADR-0015.
 *
 * What these tests guarantee:
 * - every language has exactly the English keys, so no screen shows a raw key
 *   or a blank (tsc also checks this, these tests check it at run time);
 * - every translation keeps the same {placeholders}, so a name, an amount or
 *   a date is never lost from a sentence;
 * - SMS reply words (YES, NO, OK, WRONG) stay in English inside every
 *   translation, because the server reads only those words in a reply;
 * - the files are really translated, not copies of English;
 * - each language is named in its own script, so a worker who reads no
 *   English still finds his language in the list;
 * - an unknown language or a missing key falls back to English.
 *
 * The translated text is never printed by these tests. Failures name the key only.
 */

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const smsWords = (s: string) => [...s.matchAll(/\b(YES|NO|OK|WRONG)\b/g)].map((m) => m[1]).sort();
const keys = Object.keys(en) as MessageKey[];

describe.each(LANGUAGES.filter((l) => l.code !== "en"))("$code", ({ code }) => {
  const dict = DICTIONARIES[code] as Record<string, string>;

  it("has exactly the English keys", () => {
    const missing = keys.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("keeps every placeholder", () => {
    const wrong = keys.filter((k) => placeholders(dict[k] ?? "").join() !== placeholders(en[k]).join());
    expect(wrong).toEqual([]);
  });

  it("keeps the SMS reply words in English", () => {
    const wrong = keys.filter((k) => {
      const want = smsWords(en[k]);
      return want.length > 0 && smsWords(dict[k] ?? "").join() !== want.join();
    });
    expect(wrong).toEqual([]);
  });

  it("has no empty text", () => {
    expect(keys.filter((k) => !(dict[k] ?? "").trim())).toEqual([]);
  });

  it("is really translated, not a copy of the English", () => {
    const copied = keys.filter((k) => /[a-z]{3}/.test(en[k]) && dict[k] === en[k]);
    expect(copied.length).toBeLessThan(keys.length * 0.1);
  });
});

describe("the language list", () => {
  it("has the five SMS languages, English first", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "hi", "bn", "ml", "or"]);
  });

  it("names each language in its own script", () => {
    for (const l of LANGUAGES.filter((l) => l.code !== "en")) {
      expect(l.name, l.code).toMatch(/[^\u0000-\u007f]/);
    }
  });

  it("knows which codes are languages", () => {
    expect(isLanguage("bn")).toBe(true);
    expect(isLanguage("ta")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe("translate", () => {
  it("fills in placeholders", () => {
    expect(translate("en", "codeSent", { phone: "9845687924" })).toContain("9845687924");
  });

  it("uses English for an unknown language", () => {
    expect(translate("ta" as never, "signIn")).toBe(en.signIn);
  });
});
