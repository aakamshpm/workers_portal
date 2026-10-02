import { ICONS } from "./icons";

export type IconName = keyof typeof ICONS & string;

/** Every icon in the set, sorted, so a caller can be checked against it. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * One icon, drawn inline (ADR-0019).
 *
 * The design uses the Material Symbols web font. This draws the same shapes
 * from path data held in the repository, for two reasons. A font from Google's
 * CDN is not in the cache when the app opens offline (ADR-0018), and while it
 * is missing the browser shows the icon's name as words, so a worker would read
 * "check_circle" in the middle of his wage record.
 *
 * ## Saying what an icon means, or saying nothing
 *
 * An icon is either decoration or information, and the two are announced
 * differently:
 *
 *   - Decoration sits beside text that already says the same thing, for example
 *     the small rupee mark next to "Money paid". Leave `label` out. The icon is
 *     then hidden from a screen reader, which would otherwise read the same
 *     thing twice.
 *   - Information is an icon that is the only thing carrying the meaning, for
 *     example the warning mark on a row the worker says is wrong. Pass `label`
 *     with the sentence a reader needs. It is announced as an image with that
 *     name.
 *
 * The label is a sentence for a person, so it comes from the language files
 * (ADR-0015) and never from the icon's own name.
 *
 * ## Colour and size
 *
 * The shape is filled with `currentColor`, so it takes the colour of the text
 * around it: `text-primary` on the parent colours the icon as well, and no
 * caller writes a colour of its own.
 */
export default function Icon({
  name,
  size = 20,
  filled = false,
  spin = false,
  label,
  className = "",
}: {
  name: IconName;
  /** Across, in px. 20 beside body text, 24 in a header, 18 inside a badge. */
  size?: number;
  /** The solid shape, which the design uses for a settled state. */
  filled?: boolean;
  /** Turn, while waiting for the server. */
  spin?: boolean;
  /** What the icon tells the reader. Leave out when nearby text says it. */
  label?: string;
  className?: string;
}) {
  const shape = ICONS[name];
  // `filled` is a request, not a promise: most icons have no solid variant, and
  // asking for one must not leave an empty square on the screen.
  const path = (filled && shape.filled) || shape.outlined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      // The icon is never a tab stop. Older browsers made SVG focusable, which
      // put an empty stop in the keyboard order between two real controls.
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      className={`${spin ? "animate-spin" : ""} ${className}`.trim()}
    >
      <path d={path} />
    </svg>
  );
}
