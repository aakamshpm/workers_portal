# Contract: sign-in and accounts

The server implements these shapes. The sign-in page at `/` and the officer app consume them. ADR-0013, ADR-0014.

Phone numbers are 10 digits. The server accepts spaces and a leading `+91` and keeps the last 10 digits.

## Errors from the sign-in routes

Every error from `/api/auth/*` has this shape:

```json
{ "error": "Wait a minute before asking for another code.", "code": "CODE_WAIT" }
```

`error` is English, for logs and for the contractor and officer apps. `code` is fixed, and the sign-in page shows its own text for it in the reader's language (ADR-0015, ADR-0020).

| `code` | Status | When |
|---|---|---|
| `INVALID_INPUT` | 400 | A field is missing or has the wrong form |
| `INVALID_PHONE` | 400 | The phone is not 10 digits |
| `PHONE_REGISTERED` | 409 | A registration for a number that already has an account |
| `PHONE_NOT_REGISTERED` | 404 | A reset or a login for a number with no account |
| `CODE_WAIT` | 429 | A code went to this number less than a minute ago |
| `CODE_DAILY_LIMIT` | 429 | 5 codes went to this number today |
| `SMS_FAILED` | 502 | The SMS could not be sent. Nothing was stored and the limits are not used up |
| `CODE_WRONG` | 400 | The code is wrong, expired, used, or has had 5 wrong tries |
| `WRONG_PIN` | 401 | The number has an account and the PIN does not match, or the account has no PIN yet |
| `PIN_LOCKED` | 429 | 5 wrong PINs in a row. The body also has `minutesLeft` |

## POST /api/auth/code

No sign-in. Sends a one-time 6-digit code to a phone by SMS.

Request: `{ "phone": "9880030001", "purpose": "REGISTER", "language": "hi" }`.

- `purpose` is `REGISTER` or `RESET_PIN`.
- `language` is optional: `en`, `hi`, `bn`, `ml` or `or`. It is the language of the SMS. For `RESET_PIN` the account's own language is used instead.

Response `200`, after the SMS has been handed to the gateway:

```json
{ "sent": true, "expiresInMinutes": 10 }
```

- `409` `PHONE_REGISTERED` for `REGISTER` when the number already has an account. No SMS is sent.
- `404` `PHONE_NOT_REGISTERED` for `RESET_PIN` when the number has no account. No SMS is sent.
- `429` `CODE_WAIT` or `CODE_DAILY_LIMIT` (1 a minute, 5 a day per number).
- `502` `SMS_FAILED` when the gateway refused the message or did not answer within 15 seconds.
- `400` `INVALID_PHONE` or `INVALID_INPUT`.

This route tells anyone whether a number has an account. ADR-0020 explains why that is accepted.

## POST /api/auth/register

No sign-in. A worker creates his own account.

Request:

```json
{ "phone": "9845687924", "code": "482913", "name": "Ramu", "homeState": "Assam", "pin": "5739" }
```

Response `201`: `{ "token": "…", "user": { … } }`, the same shape as login. The role is always `WORKER`.

- `400` `CODE_WRONG` when the code is wrong or expired. A wrong code counts against the code's 5 tries.
- `400` `INVALID_INPUT` or `INVALID_PHONE` for an invalid field.
- `409` `PHONE_REGISTERED` when the number already has an account.

## POST /api/auth/reset-pin

No sign-in. Sets a new PIN for an existing account, including one made by the labour office that has no PIN yet.

Request: `{ "phone": "9000010001", "code": "482913", "pin": "5739" }`

Response `200`: `{ "token": "…", "user": { … } }`. The wrong-PIN lock is cleared.

- `400` `CODE_WRONG` when the code is wrong or expired.
- `400` `INVALID_INPUT` when the PIN is not 4 digits.

## PATCH /api/auth/language

Signed in, any role. Sets the language of the signed-in user's SMS and, for a worker, of his app. ADR-0015.

Request: `{ "language": "bn" }`, one of `en`, `hi`, `bn`, `ml`, `or`.

Response `200`: `{ "token": "…", "user": { … } }` with the new `language`. The token is new because the user inside it changed.

- `400` for any other value.
- `401` when not signed in.

## POST /api/auth/login

Request: `{ "phone": "9880030001", "pin": "1234" }`. Response `200`: `{ "token": "…", "user": { … } }`.

- `404` `PHONE_NOT_REGISTERED` when the number has no account (ADR-0022). It is not counted towards the PIN lock.
- `401` `WRONG_PIN` when the number has an account and the PIN does not match. An account that has no PIN yet answers the same; its owner sets a PIN through "Forgot PIN".
- `429` `PIN_LOCKED` `{ "error": "…", "code": "PIN_LOCKED", "minutesLeft": 15 }` on the fifth wrong PIN in a row, and on every try until the lock ends. `minutesLeft` is the real time left, rounded up.

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
