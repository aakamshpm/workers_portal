---
name: textbee-sms
description: Wire SmsProvider to Textbee and poll inbound messages. Use when implementing ADR-0008. Core agent only.
---

# textbee-sms

1. Introduce `SmsProvider` with `send` and `fetchInbound`. Default production implementation calls `https://api.textbee.dev` (`TEXTBEE_BASE_URL` overridable).
2. Tests inject a fake. Tests never HTTP to textbee.dev.
3. `send()` in `server/src/lib/sms.ts` calls the provider, then writes `SmsMessage` as an audit row (SID / provider id + status).
4. If `TEXTBEE_API_KEY` is missing, `send()` throws. It does not write a row that looks delivered.
5. Poll inbound on an interval in the API process. Pass new bodies through existing `parseReply`.
6. Do not add a public webhook in this skill. Webhook is Phase 5.
7. Do not self-host Textbee.
8. Keep generating message bodies in the worker’s language. That code stays.
