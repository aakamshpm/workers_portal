import { useCallback, useState } from "react";
import { getStoredUser } from "../shared/api";
import { appFor } from "../shared/apps";
import { leaveTo } from "../shared/leave";
import { I18nProvider, isLanguage, type Language } from "../shared/i18n";
import Login from "./Login";

/** Where the sign-in page keeps the reader's own choice of language. */
const LANGUAGE_KEY = "wage-ledger-language";

function storedLanguage(): Language | null {
  const v = localStorage.getItem(LANGUAGE_KEY);
  return isLanguage(v) ? v : null;
}

/**
 * The sign-in page at "/", for every role. ADR-0012, ADR-0015.
 *
 * One page for everyone, because the phone number already decides the role.
 * After sign-in, each role is sent to its own app. Someone who is already
 * signed in and opens "/" goes straight to their app.
 *
 * Language: the reader's own choice wins, and is kept in the browser for the
 * next visit. A new worker who never chose one gets the language of the home
 * state he picks, because that is the language his SMS will come in.
 */
export default function SignInApp() {
  const [user] = useState(() => getStoredUser());
  const [chosen, setChosen] = useState<Language | null>(storedLanguage);
  const [fromState, setFromState] = useState<Language | null>(null);

  const choose = useCallback((language: Language) => {
    localStorage.setItem(LANGUAGE_KEY, language);
    setChosen(language);
  }, []);

  if (user) {
    leaveTo(appFor(user.role));
    return null;
  }

  return (
    <I18nProvider language={chosen ?? fromState ?? "en"} onChange={choose}>
      <Login
        onSignedIn={(u) => leaveTo(appFor(u.role))}
        onHomeStateLanguage={(language) => setFromState(language)}
      />
    </I18nProvider>
  );
}
