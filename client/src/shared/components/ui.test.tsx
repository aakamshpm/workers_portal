import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button, Card, ChoiceRow, EmptyState, Field, Note, PhoneLink, RecordTypeBadge, TextField, formatPhone } from "./ui";
import { I18nProvider, DICTIONARIES } from "../i18n";

/**
 * The primitives every screen is built from (ADR-0019).
 *
 * These are the pieces that repeat on all 29 screens, so each one's contract is
 * written here once. A page then composes them and never repeats their classes,
 * which is the whole point of the design system: a colour or a size changes in
 * theme.css, not in twenty files.
 *
 * Two kinds of assertion appear below, and the difference matters.
 *
 *   - Behaviour: what happens when a worker taps, what a screen reader
 *     announces, whether a disabled control can still fire. This is the usual
 *     kind of test and it is the majority of what follows.
 *   - Appearance: that a variant uses the token classes and never a colour of
 *     its own, and that a touch target is not below the floor. For a design
 *     system the class string is the behaviour, because it is the only thing
 *     standing between a worker outdoors and an unreadable button. Asserting on
 *     it is narrow but deliberate.
 */

describe("Button", () => {
  it("shows its label and does nothing until it is pressed", () => {
    const pressed = vi.fn();
    render(<Button onClick={pressed}>Send my answer</Button>);
    expect(screen.getByRole("button", { name: "Send my answer" })).toBeTruthy();
    expect(pressed).not.toHaveBeenCalled();
  });

  it("calls back when pressed", () => {
    const pressed = vi.fn();
    render(<Button onClick={pressed}>Next</Button>);
    screen.getByRole("button").click();
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("is a plain button unless the caller says it submits a form", () => {
    // Without this a button inside a form submits it, which on the sign-in page
    // would send a half-filled form when somebody taps "Forgot PIN".
    const { unmount } = render(<Button>Next</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
    unmount();
    render(<Button type="submit">Next</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  describe("when it is disabled", () => {
    it("cannot be pressed", () => {
      const pressed = vi.fn();
      render(
        <Button disabled onClick={pressed}>
          Next
        </Button>,
      );
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      expect(pressed).not.toHaveBeenCalled();
    });
  });

  describe("while the server is answering", () => {
    it("cannot be pressed a second time", () => {
      // A worker on a slow connection taps again when nothing happens. Without
      // this, the second tap sends the same record twice, and the ledger has no
      // way to remove the copy (principle 1).
      const pressed = vi.fn();
      render(
        <Button busy onClick={pressed}>
          Send
        </Button>,
      );
      const button = screen.getByRole("button") as HTMLButtonElement;
      button.click();
      expect(pressed).not.toHaveBeenCalled();
      expect(button.disabled).toBe(true);
    });

    it("says it is busy, so a screen reader announces the wait", () => {
      render(<Button busy>Send</Button>);
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
    });

    it("keeps its label, so the button never goes blank", () => {
      render(<Button busy>Send</Button>);
      expect(screen.getByRole("button", { name: /Send/ })).toBeTruthy();
    });

    it("shows a turning mark", () => {
      const { container } = render(<Button busy>Send</Button>);
      expect(container.querySelector("svg")!.getAttribute("class")).toContain("animate-spin");
    });

    it("says nothing about being busy when it is not", () => {
      render(<Button>Send</Button>);
      expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
    });
  });

  describe("its size", () => {
    it("is at least as tall as a finger can hit, by default", () => {
      const { container } = render(<Button>Next</Button>);
      expect(container.querySelector("button")!.className).toContain("min-h-[var(--size-control)]");
    });

    it("is the taller page button when it finishes a screen", () => {
      const { container } = render(<Button size="page">Send my answer</Button>);
      const cls = container.querySelector("button")!.className;
      expect(cls).toContain("min-h-[var(--size-button)]");
      // A button that finishes a screen fills the width, so a worker cannot
      // miss it and does not have to aim.
      expect(cls).toContain("w-full");
    });

    it("can be the officer's dense size, which is for a mouse", () => {
      const { container } = render(<Button size="dense">Open</Button>);
      expect(container.querySelector("button")!.className).toContain("min-h-[var(--size-control-sm)]");
    });
  });

  describe("its variants", () => {
    // Each variant is a decision about meaning, not only about colour.
    const CASES: [string, string][] = [
      // The action that finishes the screen. Filled, so it is the one thing the
      // eye lands on.
      ["primary", "bg-primary-container"],
      // An alternative the reader may take instead. Tonal, not filled, so two
      // buttons side by side are not equally loud.
      ["secondary", "bg-surface-container-high"],
      // Refusing an offer, or saying a row is wrong. These cannot be undone
      // (principle 1), so they look different from an ordinary action.
      ["danger", "bg-error"],
      // A link-like action inside a row. No fill at all.
      ["ghost", "text-primary"],
    ];

    it.each(CASES)("%s uses the theme's own colour", (variant, expected) => {
      const { container } = render(
        <Button variant={variant as "primary"}>Do it</Button>,
      );
      expect(container.querySelector("button")!.className).toContain(expected);
    });

    it("writes no colour of its own, in any variant", () => {
      for (const [variant] of CASES) {
        const { container } = render(<Button variant={variant as "primary"}>Do it</Button>);
        expect(container.innerHTML, variant).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    });
  });

  it("shows a keyboard ring, so a sighted keyboard user can see where he is", () => {
    const { container } = render(<Button>Next</Button>);
    expect(container.querySelector("button")!.className).toContain("focus-visible:");
  });

  it("can carry an icon beside the label", () => {
    render(<Button icon="send">Send offer</Button>);
    const button = screen.getByRole("button", { name: "Send offer" });
    // The icon is decoration here, because the label already says "Send".
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Card", () => {
  it("shows what is inside it", () => {
    render(<Card>A row of work</Card>);
    expect(screen.getByText("A row of work")).toBeTruthy();
  });

  it("is a section, so a screen reader can move between cards", () => {
    const { container } = render(<Card title="Money owed">x</Card>);
    const section = container.querySelector("section")!;
    // A section is only announced as a region when it has a name, which here is
    // its own title.
    expect(section.getAttribute("aria-labelledby")).toBe(
      section.querySelector("h2")!.getAttribute("id"),
    );
  });

  it("titles itself with a heading, not with bold text", () => {
    render(<Card title="Money owed">x</Card>);
    expect(screen.getByRole("heading", { name: "Money owed" }).tagName).toBe("H2");
  });

  it("can sit under another heading, at the level the page needs", () => {
    // A card inside a section that already has an h2 must not restart at h2, or
    // the heading order a screen reader reads out has a hole in it.
    render(
      <Card title="One job" level={3}>
        x
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "One job" }).tagName).toBe("H3");
  });

  it("has no region and no heading when it has no title", () => {
    const { container } = render(<Card>x</Card>);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("section")!.getAttribute("aria-labelledby")).toBeNull();
  });

  it("explains itself under the title when the caller gives a description", () => {
    render(
      <Card title="Money owed" description="What the contractor still has to pay you.">
        x
      </Card>,
    );
    expect(screen.getByText("What the contractor still has to pay you.")).toBeTruthy();
  });

  it("holds an action in its header, such as a link to the full list", () => {
    render(
      <Card title="Records" actions={<Button size="dense">See all</Button>}>
        x
      </Card>,
    );
    expect(screen.getByRole("button", { name: "See all" })).toBeTruthy();
  });

  it("uses the card colour and the design's corner, not its own", () => {
    const { container } = render(<Card>x</Card>);
    const cls = container.querySelector("section")!.className;
    expect(cls).toContain("bg-surface-container-lowest");
    expect(cls).toContain("rounded-xl");
  });
});

describe("Note", () => {
  it("interrupts a screen reader when it is an error, because the action failed", () => {
    // `alert` is read as soon as it appears. A worker who has just tapped
    // "Send" has to be told the record did not go in, without having to look.
    render(<Note tone="error">Wrong PIN. Three tries left.</Note>);
    expect(screen.getByRole("alert").textContent).toContain("Wrong PIN. Three tries left.");
  });

  it("does not interrupt for a note that only explains", () => {
    const { container } = render(<Note tone="info">The contractor writes this row.</Note>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("announces a success quietly, after what the reader is doing", () => {
    // `status` waits for a pause; `alert` cuts in. A record that went in
    // successfully does not need to cut in.
    render(<Note tone="success">Your answer was sent.</Note>);
    expect(screen.getByRole("status").textContent).toContain("Your answer was sent.");
  });

  it("carries an icon that a screen reader does not read twice", () => {
    const { container } = render(<Note tone="warning">Never tell your PIN to anyone.</Note>);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  const TONES: [string, string][] = [
    ["error", "bg-error-container"],
    ["warning", "bg-surface-container-high"],
    ["info", "bg-surface-container-low"],
    ["success", "bg-secondary-container"],
  ];

  it.each(TONES)("%s uses the theme's own colour", (tone, expected) => {
    const { container } = render(<Note tone={tone as "info"}>x</Note>);
    expect(container.firstElementChild!.className).toContain(expected);
  });

  it("does not rely on colour alone to say which kind of note it is", () => {
    // A worker who cannot tell red from green still has the icon and the words.
    for (const [tone] of TONES) {
      const { container } = render(<Note tone={tone as "info"}>x</Note>);
      expect(container.querySelector("svg"), tone).not.toBeNull();
    }
  });
});

describe("TextField", () => {
  it("joins its label to its box, so tapping the words opens the keyboard", () => {
    render(<TextField label="Your name" value="" onChange={() => {}} />);
    const box = screen.getByLabelText("Your name");
    expect(box.tagName).toBe("INPUT");
  });

  it("reports what was typed", () => {
    const typed = vi.fn();
    render(<TextField label="Your name" value="" onChange={typed} />);
    // fireEvent.change, not a raw dispatch: React keeps its own copy of the
    // value, and a plain event on a box whose value was set by hand is dropped
    // as "no change".
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bijoy Das" } });
    expect(typed).toHaveBeenCalledWith("Bijoy Das");
  });

  it("opens the number keypad for a number, not the letter keyboard", () => {
    // ADR-0019: the phone's own keypad, not a drawn one. A worker entering a
    // phone number should never have to find the "123" key first.
    render(<TextField label="Phone number" numeric value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Phone number").getAttribute("inputMode")).toBe("numeric");
  });

  it("explains itself under the box when the caller gives a hint", () => {
    render(<TextField label="Phone number" hint="Ten digits" value="" onChange={() => {}} />);
    const box = screen.getByLabelText("Phone number");
    const hint = screen.getByText("Ten digits");
    // Tied by id, so a screen reader reads the hint as part of the field rather
    // than as a stray line of text somewhere on the page.
    expect(box.getAttribute("aria-describedby")).toBe(hint.getAttribute("id"));
  });

  describe("when the value is wrong", () => {
    it("says so next to the box, and marks the box itself", () => {
      render(
        <TextField
          label="Phone number"
          value="988"
          error="Enter all ten digits."
          onChange={() => {}}
        />,
      );
      const box = screen.getByLabelText("Phone number");
      expect(box.getAttribute("aria-invalid")).toBe("true");
      expect(box.getAttribute("aria-describedby")).toBe(
        screen.getByText("Enter all ten digits.").getAttribute("id"),
      );
    });

    it("does not mark the box when there is no error", () => {
      render(<TextField label="Phone number" value="" onChange={() => {}} />);
      expect(screen.getByLabelText("Phone number").getAttribute("aria-invalid")).toBeNull();
    });
  });

  it("can hide its label when the page heading already asks the question", () => {
    // The name screen asks "Your name" as its heading. Printing the same words
    // again above the box is noise, but a screen reader still needs the label
    // on the box itself, so it is hidden from sight only.
    render(<TextField label="Your name" hideLabel value="" onChange={() => {}} />);
    const box = screen.getByLabelText("Your name");
    const label = document.querySelector(`label[for="${box.id}"]`)!;
    expect(label.className).toContain("sr-only");
  });

  it("shows a fixed prefix beside the box, outside what is typed", () => {
    render(<TextField label="Phone number" prefix="+91" value="" onChange={() => {}} />);
    expect(screen.getByText("+91")).toBeTruthy();
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).value).toBe("");
  });

  it("has an edge a reader can see on a white card and on the page", () => {
    // WCAG 1.4.11: the boundary of a control needs 3:1. `outline` reaches it on
    // both surfaces (theme.test.ts), and `outline-variant` does not.
    const { container } = render(<TextField label="Your name" value="" onChange={() => {}} />);
    // Split on spaces and compare whole classes: a word-boundary regex also
    // matches `ring-outline-variant`, because "-" ends a word.
    const classes = container.querySelector("input")!.className.split(/\s+/);
    expect(classes).toContain("ring-outline");
    expect(classes).not.toContain("ring-outline-variant");
  });

  it("is tall enough to hit", () => {
    const { container } = render(<TextField label="Your name" value="" onChange={() => {}} />);
    expect(container.querySelector("input")!.className).toContain("min-h-[var(--size-control)]");
  });

  it("writes no colour of its own", () => {
    const { container } = render(
      <TextField label="Your name" value="" error="Wrong" onChange={() => {}} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Field", () => {
  it("labels whatever control the caller puts inside it", () => {
    // Some controls are not a text box: a date, a select, a row of digit boxes.
    render(
      <Field label="How many days">
        <select>
          <option>1</option>
        </select>
      </Field>,
    );
    expect(screen.getByLabelText("How many days").tagName).toBe("SELECT");
  });
});

describe("EmptyState", () => {
  it("says what is missing, and what to do about it", () => {
    render(
      <EmptyState icon="receipt_long" title="No work yet">
        When a contractor offers you work, it appears here.
      </EmptyState>,
    );
    expect(screen.getByText("No work yet")).toBeTruthy();
    expect(screen.getByText("When a contractor offers you work, it appears here.")).toBeTruthy();
  });

  it("is not read as an error, because nothing has gone wrong", () => {
    const { container } = render(<EmptyState title="No work yet">x</EmptyState>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("ChoiceRow", () => {
  // One row in a list of answers, such as the home states. Tapping the row is
  // the answer, so there is no separate "Next" to find afterwards.
  it("is a button named only by its label, so the answer is read as it is", () => {
    render(<ChoiceRow label="Assam" onChoose={() => {}} />);
    expect(screen.getByRole("button", { name: "Assam" })).toBeTruthy();
  });

  it("answers when tapped", () => {
    const chose = vi.fn();
    render(<ChoiceRow label="Assam" onChoose={chose} />);
    screen.getByRole("button").click();
    expect(chose).toHaveBeenCalledOnce();
  });

  it("says when it is the chosen one", () => {
    render(<ChoiceRow label="Assam" selected onChoose={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("is taller than an ordinary control, because it is the whole answer", () => {
    const { container } = render(<ChoiceRow label="Assam" onChoose={() => {}} />);
    const cls = container.querySelector("button")!.className;
    expect(cls).toContain("min-h-16");
    expect(cls).toContain("w-full");
  });

  it("cannot be chosen twice while the answer is being sent", () => {
    const chose = vi.fn();
    render(<ChoiceRow label="Assam" disabled onChoose={chose} />);
    screen.getByRole("button").click();
    expect(chose).not.toHaveBeenCalled();
  });
});

describe("formatPhone", () => {
  // A phone number that breaks over two lines reads as two numbers, and a
  // worker copying it onto paper writes down half of it.
  it("joins the two halves with a space that never breaks", () => {
    expect(formatPhone("9123456780")).toBe("91234\u00a056780");
  });

  it("leaves anything that is not 10 digits as it was", () => {
    expect(formatPhone("0484234567")).toBe("04842\u00a034567");
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("PhoneLink", () => {
  it("dials the number with the country code", () => {
    render(<PhoneLink phone="9000010001" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("tel:+919000010001");
  });

  it("is tall enough for a finger and never breaks over two lines", () => {
    render(<PhoneLink phone="9000010001" />);
    const cls = screen.getByRole("link").className;
    expect(cls).toContain("min-h-[var(--size-touch)]");
    expect(cls).toContain("whitespace-nowrap");
  });

  it("writes no colour outside the theme", () => {
    const { container } = render(<PhoneLink phone="9000010001" />);
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-/);
  });
});

describe("RecordTypeBadge", () => {
  it("is in the worker's language in his app", () => {
    render(
      <I18nProvider initial="ml">
        <RecordTypeBadge type="WORK" />
      </I18nProvider>,
    );
    expect(screen.getByText(DICTIONARIES.ml.recWork)).toBeTruthy();
  });

  it("keeps the longer English label in the contractor and officer apps", () => {
    render(<RecordTypeBadge type="ACCEPT" />);
    expect(screen.getByText("Worker said yes")).toBeTruthy();
  });

  it("writes no colour outside the theme", () => {
    const { container } = render(<RecordTypeBadge type="DISPUTE" />);
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-|indigo-|lime-|teal-/);
  });
});
