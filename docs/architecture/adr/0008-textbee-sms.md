# ADR-0008: Textbee hosted SMS

## Status

Accepted.

## Context

Workers receive SMS on their own phone. The team develops on localhost and is not hosting a public API yet. [Textbee](https://github.com/textbee/textbee) sends through a spare Android phone’s SIM via a hosted REST API.

## Decision

- `SmsProvider` calls `https://api.textbee.dev`.
- Do not self-host Textbee.
- Outbound: POST send-sms from localhost. Inbound: poll GET messages on localhost. A public webhook is a later milestone.
- `SmsMessage` is the audit log. `/phone` is not the worker’s handset.
- Tests use a fake provider. Tests never call textbee.dev.
- If `TEXTBEE_API_KEY` is missing, `send()` fails. It does not pretend the message was delivered.

## Consequences

- One Android phone must stay on, charged, and on the internet.
- The worker sees that SIM’s number as the sender.
- Skill: `textbee-sms`.
