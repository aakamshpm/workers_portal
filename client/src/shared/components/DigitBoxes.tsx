import { useEffect, useRef } from "react";
import { useT } from "../i18n";

/**
 * A row of one-digit boxes, for a PIN or an SMS code.
 *
 * Built for a worker who is not comfortable with technology:
 *   - one large box per digit, so he can see how many digits are left;
 *   - the number keypad opens, not the letter keyboard;
 *   - the cursor moves to the next box by itself, and Backspace on an empty
 *     box goes back one;
 *   - pasting or an SMS autofill of the whole code fills every box;
 *   - `onComplete` fires when the last box is filled, so there is no extra
 *     "Continue" button to find.
 *
 * Each box has its own label ("PIN digit 1 of 4"), because a screen reader
 * reads a box on its own, and a box with no label reads as nothing.
 */
export default function DigitBoxes({
  label,
  length,
  value,
  onChange,
  onComplete,
  secret = false,
  autoFocus = false,
  disabled = false,
}: {
  /** "PIN", "Code", "PIN again". Each box is labelled "<label> digit N of M", in the reader's language. */
  label: string;
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  /** Hide the digits, for a PIN. A one-time code is shown. */
  secret?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const { t } = useT();

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus();
  }, [autoFocus]);

  function set(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  function typed(i: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;

    // More than one digit arrives when the phone pastes or autofills the whole
    // code into one box. Spread it across the boxes from this one onwards.
    const chars = value.padEnd(length, " ").split("");
    for (let k = 0; k < digits.length && i + k < length; k++) chars[i + k] = digits[k]!;
    const next = chars.join("").replace(/\s+$/, "");
    set(next);

    const focusAt = Math.min(i + digits.length, length - 1);
    boxes.current[focusAt]?.focus();
  }

  function keyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Backspace") return;
    e.preventDefault();
    const chars = value.split("");
    if (chars[i]) {
      chars.splice(i, 1);
      onChange(chars.join(""));
    } else if (i > 0) {
      chars.splice(i - 1, 1);
      onChange(chars.join(""));
      boxes.current[i - 1]?.focus();
    }
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label={label}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          aria-label={t("digitOf", { label, n: i + 1, total: length })}
          type={secret ? "password" : "text"}
          inputMode="numeric"
          autoComplete={i === 0 && !secret ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={value[i] ?? ""}
          onChange={(e) => typed(i, e.target.value)}
          onKeyDown={(e) => keyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className="size-12 rounded-lg border-0 text-center text-xl font-semibold text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-none disabled:bg-slate-100"
        />
      ))}
    </div>
  );
}
