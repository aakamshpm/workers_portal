# Contract: sign-in and accounts

The server implements these shapes. The sign-in page at `/` and the officer app consume them. ADR-0013, ADR-0014.

Phone numbers are 10 digits. The server accepts spaces and a leading `+91` and keeps the last 10 digits.

## POST /api/auth/code

No sign-in. Sends a one-time 6-digit code to a phone by SMS.

Request: `{ "phone": "9880030001", "purpose": "REGISTER", "language": "hi" }`.

- `purpose` is `REGISTER` or `RESET_PIN`.
- `language` is optional: `en`, `hi`, `bn`, `ml` or `or`. It is the language of the SMS. For `RESET_PIN` the account's own language is used instead, when the number has an account.

Response, always, whether or not the number has an account:

```json
{ "sent": true, "expiresInMinutes": 10 }
```

The SMS is sent only when it makes sense: for `REGISTER` only to a number with no account, for `RESET_PIN` only to a number with an account. The response is the same either way, so this route cannot tell anyone which numbers are registered.

- `400` when the phone is not 10 digits or the purpose is unknown.
- `429` `{ "error": "Wait a minute before asking for another code." }` when a code was sent to this number less than a minute ago.
- `429` `{ "error": "Too many codes today. Try again tomorrow." }` after 5 codes to this number today.

## POST /api/auth/register

No sign-in. A worker creates his own account.

Request:

```json
{ "phone": "9845687924", "code": "482913", "name": "Ramu", "homeState": "Assam", "pin": "5739" }
```

Response `201`: `{ "token": "…", "user": { … } }`, the same shape as login. The role is always `WORKER`.

- `400` when the code is wrong or expired, or a field is invalid. A wrong code counts against the code's 5 tries.
- `409` when the number already has an account.

## POST /api/auth/reset-pin

No sign-in. Sets a new PIN for an existing account, including one made by the labour office that has no PIN yet.

Request: `{ "phone": "9000010001", "code": "482913", "pin": "5739" }`

Response `200`: `{ "token": "…", "user": { … } }`. The wrong-PIN lock is cleared.

- `400` when the code is wrong or expired, or the PIN is not 4 digits.

## PATCH /api/auth/language

Signed in, any role. Sets the language of the signed-in user's SMS and, for a worker, of his app. ADR-0015.

Request: `{ "language": "bn" }`, one of `en`, `hi`, `bn`, `ml`, `or`.

Response `200`: `{ "token": "…", "user": { … } }` with the new `language`. The token is new because the user inside it changed.

- `400` for any other value.
- `401` when not signed in.

## POST /api/auth/login

Unchanged, except: an account that has no PIN yet answers `401` `{ "error": "Wrong phone number or PIN" }`, the same as a wrong PIN. Its owner sets a PIN through "Forgot PIN".

## GET /api/accounts

Labour officer only. Contractor and officer accounts, newest first.

```json
{
  "accounts": [
    {
      "id": "…",
      "name": "Ramesh Pillai",
      "phone": "9000010001",
      "role": "CONTRACTOR",
      "company": "Ramesh Builders",
      "hasPin": true,
      "createdAt": "…"
    }
  ]
}
```

`hasPin` is `false` until the owner has set a PIN. Workers are not listed: they register themselves.

## POST /api/accounts

Labour officer only. Creates a contractor or officer account with no PIN.

Request:

```json
{ "role": "CONTRACTOR", "name": "Joseph K", "phone": "9447012345", "company": "Joseph Constructions" }
```

`company` is required for a contractor and not allowed for an officer. `role` is `CONTRACTOR` or `AUTHORITY`.

Response `201`: the new account, in the shape above, with `hasPin: false`.

- `400` for an invalid field.
- `409` when the number already has an account.

No SMS is sent. The officer tells the new user to open the sign-in page and choose "Forgot PIN".
