import type { ReactNode } from "react";
import Icon from "./Icon";

/**
 * The bar at the top of every screen (ADR-0019).
 *
 * The app name is plain text, not a heading. Each screen asks one question and
 * that question is its only `h1`, so a screen reader user who jumps to the
 * first heading hears what the screen wants, not the app's name again.
 *
 * `children` sits at the end of the bar: the language list on the sign-in page,
 * and the reader's name and "Sign out" inside an app.
 */
export default function AppHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-[var(--size-header)] max-w-7xl items-center justify-between gap-space-md px-margin">
        <p className="flex items-center gap-space-sm font-headline-sm text-headline-sm text-primary">
          <Icon name="receipt_long" size={24} />
          {title}
        </p>
        {children && <div className="flex items-center gap-space-sm">{children}</div>}
      </div>
    </header>
  );
}
