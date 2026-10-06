import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AuthUser, Role } from "../shared/types";

/**
 * The sign-in page at "/". ADR-0012, ADR-0013, ADR-0014.
 *
 * What these tests guarantee:
 * - one question per screen: the phone number first, then only what that
 *   step needs;
 * - PIN and code are typed in separate boxes, one digit each, on the number
 *   keypad, and moving between boxes happens by itself;
 * - after sign-in each role goes to its own app;
 * - a new worker proves he holds the phone with the SMS code before he gives
 *   his name or chooses a PIN;
 * - "Forgot PIN" sets a new PIN only with the code;
 * - an already signed-in user goes straight to his app;
 * - nothing from the demo: no account list, no shared PIN, no seeded names.
 *
 * The API module is mocked. No test reaches the server or textbee.dev.
 */

// The real ApiError is kept, so the page reads the same `code` it gets in use.
vi.mock("../shared/api", async (original) => ({
  ApiError: (await original<typeof import("../shared/api")>()).ApiError,
  getStoredUser: vi.fn(),
  storeSession: vi.fn(),
  api: {
    login: vi.fn(),
    sendPhoneCode: vi.fn(),
    register: vi.fn(),
    resetPin: vi.fn(),
    states: vi.fn(),
  },
}));

vi.mock("../shared/leave", () => ({ leaveTo: vi.fn() }));

import { api, ApiError, getStoredUser, storeSession } from "../shared/api";
import { leaveTo } from "../shared/leave";
import SignInApp from "./App";
import { DICTIONARIES } from "../shared/i18n";

const mocked = vi.mocked(api);
const en = DICTIONARIES.en;
/** A refusal as the server sends it: English message, fixed code. */
const refused = (code: string, status = 400, details: Record<string, unknown> = {}) =>
  new ApiError("English text from the server", code, status, details);
const person = (role: Role): AuthUser => ({ id: `u-${role}`, name: role, phone: "9845687924", role });

beforeEach(() => {
  vi.resetAllMocks();
  // The reader chose English. Without a choice, picking Assam below would turn
  // the page into Bengali (tested in "language").
  localStorage.setItem("wage-ledger-language", "en");
  vi.mocked(getStoredUser).mockReturnValue(null);
  mocked.states.mockResolvedValue([
    { state: "West Bengal", language: "bn" },
    { state: "Assam", language: "bn" },
  ]);
  mocked.sendPhoneCode.mockResolvedValue({ sent: true, expiresInMinutes: 10 });
});

/**
 * Type digits into a row of one-digit boxes named "<label> digit 1", "digit 2", …
 * Waits for the boxes, because some steps appear only after a request answers.
 */
async function typeDigits(label: RegExp, digits: string) {
  const boxes = (await screen.findAllByLabelText(label)) as HTMLInputElement[];
  expect(boxes.length).toBe(digits.length);
  digits.split("").forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
}

function typePhone(phone: string) {
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
}

describe("sign in", () => {
  it("asks only for the phone number first", () => {
    render(<SignInApp />);
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy();
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it("shows four one-digit PIN boxes on the number keypad after the phone", () => {
    render(<SignInApp />);
    typePhone("9845687924");
    const boxes = screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[];
    expect(boxes).toHaveLength(4);
    for (const b of boxes) {
      expect(b.getAttribute("inputmode")).toBe("numeric");
      expect(b.maxLength).toBe(1);
      expect(b.value).toBe("");
    }
  });

  it("moves to the next box by itself after each digit", () => {
    render(<SignInApp />);
    typePhone("9845687924");
    const boxes = screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[];
    boxes[0]!.focus();
    fireEvent.change(boxes[0]!, { target: { value: "5" } });
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("does not accept a phone number that is not 10 digits", () => {
    render(<SignInApp />);
    typePhone("98456");
    expect(screen.getByRole("alert").textContent).toMatch(/10-digit/i);
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it.each([
    ["WORKER", "/worker/"],
    ["CONTRACTOR", "/contractor/"],
    ["AUTHORITY", "/officer/"],
  ] as const)("sends a %s to %s once the fourth digit is typed", async (role, app) => {
    mocked.login.mockResolvedValue({ token: "t", user: person(role) });
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "5739");
    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith(app));
    expect(mocked.login).toHaveBeenCalledWith("9845687924", "5739");
    expect(storeSession).toHaveBeenCalled();
  });

  it("shows the server's message and empties the PIN boxes when the PIN is wrong", async () => {
    mocked.login.mockRejectedValue(refused("WRONG_PIN", 401));
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "0000");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errWrongPin);
    for (const b of screen.getAllByLabelText(/pin digit/i) as HTMLInputElement[]) expect(b.value).toBe("");
  });

  it("sends someone already signed in straight to their app", () => {
    vi.mocked(getStoredUser).mockReturnValue(person("CONTRACTOR"));
    render(<SignInApp />);
    expect(leaveTo).toHaveBeenCalledWith("/contractor/");
  });
});

describe("new worker", () => {
  async function startRegistration() {
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "9845687924", purpose: "REGISTER" }),
      ),
    );
  }

  it("sends the SMS code first, before asking for anything else", async () => {
    await startRegistration();
    expect(await screen.findAllByLabelText(/code digit/i)).toHaveLength(6);
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
  });

  it("registers with the code, name, home state and a PIN typed twice, then opens the worker app", async () => {
    mocked.register.mockResolvedValue({ token: "t", user: person("WORKER") });
    await startRegistration();

    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));

    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");

    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/worker/"));
    expect(mocked.register).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "9845687924",
        code: "482913",
        name: "Ramu",
        homeState: "Assam",
        pin: "5739",
      }),
    );
  });

  it("asks again when the two PINs do not match, and does not register", async () => {
    await startRegistration();
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "1111");
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/i);
    expect(mocked.register).not.toHaveBeenCalled();
  });

  it("shows the server's message when the code is refused", async () => {
    mocked.register.mockRejectedValue(refused("CODE_WRONG"));
    await startRegistration();
    await typeDigits(/code digit/i, "000000");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errCodeWrong);
    expect(leaveTo).not.toHaveBeenCalled();
  });
});

describe("forgot PIN", () => {
  it("sets a new PIN with the SMS code, then opens the user's own app", async () => {
    mocked.resetPin.mockResolvedValue({ token: "t", user: person("CONTRACTOR") });
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /forgot pin/i }));
    typePhone("9000010001");
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "9000010001", purpose: "RESET_PIN" }),
      ),
    );

    await typeDigits(/code digit/i, "482913");
    await typeDigits(/pin digit/i, "8642");
    await typeDigits(/again digit/i, "8642");

    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/contractor/"));
    expect(mocked.resetPin).toHaveBeenCalledWith({ phone: "9000010001", code: "482913", pin: "8642" });
  });

  it("shows the server's wait message when a code was asked for too recently", async () => {
    mocked.sendPhoneCode.mockRejectedValue(refused("CODE_WAIT", 429));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /forgot pin/i }));
    typePhone("9000010001");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errCodeWait);
    expect(screen.queryAllByLabelText(/code digit/i)).toHaveLength(0);
  });
});

/**
 * ADR-0015: the sign-in page in the worker's language.
 *
 * - the language list is on every screen, named in each language's own script;
 * - the choice changes the page at once, tells the browser (<html lang>), and
 *   is kept for the next visit;
 * - a new worker who never touched the list gets the language of the home
 *   state he picks, for the rest of the page;
 * - the chosen language goes with the code request and the registration, so
 *   his SMS come in the language he read the page in.
 */
describe("language", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
  });

  const picker = () => screen.getByRole("combobox");
  const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** The one-digit boxes named `label`, in a dictionary's own "digit N of M" words. */
  const boxes = (lang: keyof typeof DICTIONARIES, label: string) =>
    new RegExp(
      "^" +
        esc(DICTIONARIES[lang].digitOf)
          .replace("\\{label\\}", esc(label))
          .replace("\\{n\\}", "\\d+")
          .replace("\\{total\\}", "\\d+") +
        "$",
    );

  it("is on every screen and changes the page at once", async () => {
    render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "bn" } });
    expect(document.documentElement.lang).toBe("bn");
    expect(screen.getByRole("button", { name: DICTIONARIES.bn.next })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(DICTIONARIES.bn.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: DICTIONARIES.bn.next }));
    expect(await screen.findAllByLabelText(boxes("bn", DICTIONARIES.bn.pinLabel))).toHaveLength(4);
    expect(picker()).toBeTruthy();
  });

  it("names each language in its own script", () => {
    render(<SignInApp />);
    const names = Array.from(picker().querySelectorAll("option")).map((o) => o.textContent);
    expect(names).toEqual(["English", "हिन्दी", "বাংলা", "മലയാളം", "ଓଡ଼ିଆ"]);
  });

  it("keeps the choice for the next visit", () => {
    const first = render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "or" } });
    first.unmount();
    render(<SignInApp />);
    expect((picker() as HTMLSelectElement).value).toBe("or");
    expect(screen.getByRole("button", { name: DICTIONARIES.or.next })).toBeTruthy();
  });

  it("sends the chosen language with the code request and the registration", async () => {
    mocked.register.mockResolvedValue({ token: "t", user: person("WORKER") });
    render(<SignInApp />);
    fireEvent.change(picker(), { target: { value: "hi" } });
    const hi = DICTIONARIES.hi;
    fireEvent.click(screen.getByRole("button", { name: hi.makeAccount }));
    fireEvent.change(screen.getByLabelText(hi.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: hi.next }));
    await vi.waitFor(() =>
      expect(mocked.sendPhoneCode).toHaveBeenCalledWith(expect.objectContaining({ language: "hi" })),
    );
    await typeDigits(boxes("hi", hi.codeLabel), "482913");
    fireEvent.change(await screen.findByLabelText(hi.yourName), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: hi.next }));
    // West Bengal would mean Bengali, but he chose Hindi himself, so Hindi stays.
    fireEvent.click(await screen.findByRole("button", { name: hi.stateWestBengal }));
    expect(document.documentElement.lang).toBe("hi");
    await typeDigits(boxes("hi", hi.pinLabel), "5739");
    await typeDigits(boxes("hi", hi.pinAgainLabel), "5739");
    await vi.waitFor(() =>
      expect(mocked.register).toHaveBeenCalledWith(expect.objectContaining({ language: "hi", homeState: "West Bengal" })),
    );
  });

  it("uses the home state's language when the worker never chose one", async () => {
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    expect(document.documentElement.lang).toBe("bn");
    expect(screen.getByText(DICTIONARIES.bn.choosePin)).toBeTruthy();
  });
});

/**
 * ADR-0019: the sign-in page on the design system.
 *
 * - each screen asks one question, and that question is the page's only h1,
 *   so a screen reader user hears what the screen wants first;
 * - the header carries the app name and the language list on every screen;
 * - "+91" sits beside the phone box but is not part of what is typed, so a
 *   worker types ten digits and the server receives ten digits;
 * - while the server checks a PIN, the page says it is waiting, because the
 *   boxes are disabled and otherwise look broken;
 * - nothing on the page claims a link to a government register, because
 *   there is none.
 */
describe("layout", () => {
  const heading = () => screen.getByRole("heading", { level: 1 });

  it("asks one question per screen, as the page heading", async () => {
    render(<SignInApp />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(heading().textContent).toBe(DICTIONARIES.en.signIn);
    typePhone("9845687924");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(heading().textContent).toBe(DICTIONARIES.en.typePin);
  });

  it("names the flow above the question once the phone is given", async () => {
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await screen.findAllByLabelText(/code digit/i);
    expect(heading().textContent).toContain("9845687924".slice(0, 5));
    expect(screen.getByText(DICTIONARIES.en.newWorker)).toBeTruthy();
  });

  it("keeps the app name and the language list in one header on every screen", () => {
    render(<SignInApp />);
    const banner = screen.getByRole("banner");
    expect(banner.textContent).toContain(DICTIONARIES.en.appTitle);
    expect(banner.querySelector("select")).not.toBeNull();
    typePhone("9845687924");
    expect(screen.getByRole("banner").querySelector("select")).not.toBeNull();
  });

  it("offers the other flows only on the phone screen", async () => {
    // Halfway through, the only way out is "Start again". A worker typing an
    // SMS code should not be offered "Forgot PIN?" for an account he is still
    // making.
    render(<SignInApp />);
    expect(screen.getByRole("button", { name: /forgot pin/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await screen.findAllByLabelText(/code digit/i);
    expect(screen.queryByRole("button", { name: /forgot pin/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /have a pin/i })).toBeNull();
    expect(screen.getByRole("button", { name: /start again/i })).toBeTruthy();
  });

  it("shows +91 beside the phone box, outside what is typed", () => {
    render(<SignInApp />);
    expect(screen.getByText("+91")).toBeTruthy();
    const box = screen.getByLabelText(/phone number/i) as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box.getAttribute("inputmode")).toBe("numeric");
  });

  it("says it is waiting while the server checks the PIN", async () => {
    mocked.login.mockReturnValue(new Promise(() => {}));
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "5739");
    expect((await screen.findByRole("status")).textContent).toContain(DICTIONARIES.en.pleaseWait);
  });

  it("claims no link to a government register or an identity check", async () => {
    render(<SignInApp />);
    const claims = /national|register of|government|aadhaar|e-shram|welfare board|verified/i;
    expect(document.body.textContent).not.toMatch(claims);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await screen.findAllByLabelText(/code digit/i);
    expect(document.body.textContent).not.toMatch(claims);
  });
});

/**
 * ADR-0020: the page tells the worker what really happened, in his language.
 *
 * - each error code from the server has the page's own sentence, in the
 *   reader's language, never the server's English;
 * - a number that does not fit the flow is told so on the phone screen, with
 *   the buttons for the right flow there;
 * - a wrong code at the last step goes back to the code boxes, and the name,
 *   state and PIN he already gave are kept, so he types only the code;
 * - when the state list cannot load, he is told, and can try again;
 * - a failure never leaves full boxes that he cannot type into again.
 */
describe("when something goes wrong", () => {
  it("tells a worker who already has an account, on the phone screen, with the way out", async () => {
    mocked.sendPhoneCode.mockRejectedValue(refused("PHONE_REGISTERED", 409));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errPhoneRegistered);
    expect(screen.queryAllByLabelText(/code digit/i)).toHaveLength(0);
    expect(screen.getByRole("button", { name: en.havePin })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.forgotPin })).toBeTruthy();
  });

  it("tells someone resetting a PIN that the number has no account", async () => {
    mocked.sendPhoneCode.mockRejectedValue(refused("PHONE_NOT_REGISTERED", 404));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /forgot pin/i }));
    typePhone("9845687924");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errPhoneNotRegistered);
    expect(screen.getByRole("button", { name: en.makeAccount })).toBeTruthy();
  });

  it("tells a number with no account so, and goes back to the number with the New worker button", async () => {
    mocked.login.mockRejectedValue(refused("PHONE_NOT_REGISTERED", 404));
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "0000");

    expect((await screen.findByRole("alert")).textContent).toBe(en.errPhoneNotRegistered);
    // Back on the phone step, not left on the PIN boxes with nothing to do.
    expect(screen.queryAllByLabelText(/pin digit/i)).toHaveLength(0);
    // The number stays in the box, so one wrong digit can be corrected.
    expect((screen.getByLabelText(/phone number/i) as HTMLInputElement).value).toBe("9845687924");
    expect(screen.getByRole("button", { name: en.makeAccount })).toBeTruthy();
  });

  it("says in the reader's language that the number has no account", async () => {
    localStorage.setItem("wage-ledger-language", "ml");
    mocked.login.mockRejectedValue(refused("PHONE_NOT_REGISTERED", 404));
    render(<SignInApp />);
    fireEvent.change(screen.getByLabelText(DICTIONARIES.ml.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: DICTIONARIES.ml.next }));
    await screen.findAllByRole("group");
    const pins = document.querySelectorAll('input[type="password"]');
    "0000".split("").forEach((d, i) => fireEvent.change(pins[i]!, { target: { value: d } }));
    expect((await screen.findByRole("alert")).textContent).toBe(DICTIONARIES.ml.errPhoneNotRegistered);
  });

  it("fills the visible screen of a phone, not the tallest one its browser could show", () => {
    // 100vh is the height with the address bar hidden. With the bar showing,
    // the foot of the page ("Forgot PIN?") was below the edge of the screen.
    const { container } = render(<SignInApp />);
    const page = container.firstElementChild!;
    expect(page.className).toContain("min-h-dvh");
    expect(page.className).not.toContain("min-h-screen");
  });

  it("shows the error in the reader's language, not the server's English", async () => {
    localStorage.setItem("wage-ledger-language", "ml");
    mocked.login.mockRejectedValue(refused("WRONG_PIN", 401));
    render(<SignInApp />);
    fireEvent.change(screen.getByLabelText(DICTIONARIES.ml.phoneNumber), { target: { value: "9845687924" } });
    fireEvent.click(screen.getByRole("button", { name: DICTIONARIES.ml.next }));
    const boxes = await screen.findAllByRole("group");
    expect(boxes.length).toBeGreaterThan(0);
    const pins = document.querySelectorAll('input[type="password"]');
    "0000".split("").forEach((d, i) => fireEvent.change(pins[i]!, { target: { value: d } }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(DICTIONARIES.ml.errWrongPin);
    expect(alert.textContent).not.toContain("English text from the server");
  });

  it("says how many minutes are left when the number is locked", async () => {
    mocked.login.mockRejectedValue(refused("PIN_LOCKED", 429, { minutesLeft: 7 }));
    render(<SignInApp />);
    typePhone("9845687924");
    await typeDigits(/pin digit/i, "0000");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errPinLocked.replace("{minutes}", "7"));
  });

  it("says there is no internet, rather than a technical message", async () => {
    mocked.sendPhoneCode.mockRejectedValue(new ApiError("No internet connection.", "NETWORK", 0));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errNetwork);
  });

  it("goes back to the code after a wrong code, and keeps everything else he typed", async () => {
    mocked.register
      .mockRejectedValueOnce(refused("CODE_WRONG"))
      .mockResolvedValueOnce({ token: "t", user: person("WORKER") });
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await typeDigits(/code digit/i, "111111");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");

    expect((await screen.findByRole("alert")).textContent).toBe(en.errCodeWrong);
    const codeBoxes = (await screen.findAllByLabelText(/code digit/i)) as HTMLInputElement[];
    for (const b of codeBoxes) expect(b.value).toBe("");

    await typeDigits(/code digit/i, "482913");
    await vi.waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/worker/"));
    expect(mocked.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "482913", name: "Ramu", homeState: "Assam", pin: "5739" }),
    );
    expect(mocked.sendPhoneCode).toHaveBeenCalledTimes(1);
  });

  it("empties the PIN boxes after another failure, so he can type again", async () => {
    mocked.register.mockRejectedValue(new ApiError("down", "SERVER", 502));
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Assam" }));
    await typeDigits(/pin digit/i, "5739");
    await typeDigits(/again digit/i, "5739");
    expect((await screen.findByRole("alert")).textContent).toBe(en.errServer);
    for (const b of screen.getAllByLabelText(/again digit/i) as HTMLInputElement[]) expect(b.value).toBe("");
  });

  it("says when the state list cannot load, and loads it again on request", async () => {
    mocked.states
      .mockRejectedValueOnce(new ApiError("No internet connection.", "NETWORK", 0))
      .mockResolvedValue([{ state: "Assam", language: "bn" }]);
    render(<SignInApp />);
    fireEvent.click(screen.getByRole("button", { name: /new worker/i }));
    typePhone("9845687924");
    await typeDigits(/code digit/i, "482913");
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Ramu" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect((await screen.findByRole("alert")).textContent).toContain(en.errStates);
    fireEvent.click(screen.getByRole("button", { name: en.tryAgain }));
    expect(await screen.findByRole("button", { name: "Assam" })).toBeTruthy();
  });
});

/**
 * ADR-0019: the screen uses its height. The question and its answer sit at
 * the top, the button that finishes the screen and the other ways out sit at
 * the bottom, and the note for staff is the last thing on every screen.
 */
describe("the screen's height", () => {
  it("explains what each answer is for, under the question", () => {
    render(<SignInApp />);
    const box = screen.getByLabelText(/phone number/i);
    const hint = document.getElementById(box.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe(en.phoneHint);
  });

  it("keeps the note for staff as the last thing on every screen", async () => {
    render(<SignInApp />);
    const last = () => screen.getByRole("main").lastElementChild!;
    expect(last().textContent).toContain(en.staffNote);
    typePhone("9845687924");
    await screen.findAllByLabelText(/pin digit/i);
    expect(last().textContent).toContain(en.staffNote);
  });

  it("puts the bottom block at the foot of the screen, not under the question", () => {
    render(<SignInApp />);
    const bottom = screen.getByRole("main").lastElementChild!;
    expect(bottom.className.split(/\s+/)).toContain("mt-auto");
  });
});

/** ADR-0013: nothing from the demo on the real sign-in page. */
describe("no demo parts", () => {
  it("lists no accounts and mentions no shared PIN or seeded person", () => {
    render(<SignInApp />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/accounts to try/i);
    expect(text).not.toMatch(/1234/);
    expect(text).not.toMatch(/pramod|bijoy|98800/i);
  });
});
