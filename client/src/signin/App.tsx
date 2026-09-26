import { useState } from "react";
import { getStoredUser } from "../shared/api";
import { appFor } from "../shared/apps";
import { leaveTo } from "../shared/leave";
import Login from "./Login";

/**
 * The sign-in page at "/", for every role. ADR-0012.
 *
 * One page for everyone, because the phone number already decides the role.
 * After sign-in, each role is sent to its own app. Someone who is already
 * signed in and opens "/" goes straight to their app.
 */
export default function SignInApp() {
  const [user] = useState(() => getStoredUser());

  if (user) {
    leaveTo(appFor(user.role));
    return null;
  }

  return <Login onSignedIn={(u) => leaveTo(appFor(u.role))} />;
}
