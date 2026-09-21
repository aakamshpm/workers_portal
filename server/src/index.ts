import "dotenv/config";
import express from "express";
import cors from "cors";
import { getHmacSecret } from "./lib/hashChain";
import { parseReply, pollInbound } from "./lib/sms";
import { authRouter } from "./routes/auth";
import { discoveryRouter } from "./routes/discovery";
import { offersRouter } from "./routes/offers";
import { paymentsRouter } from "./routes/payments";
import { ledgerRouter } from "./routes/ledger";
import { complaintsRouter } from "./routes/complaints";
import { smsRouter } from "./routes/sms";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// ADR-0004: missing HMAC key fails startup, never uses an empty key.
getHmacSecret();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "migrant-wage-ledger" });
});

app.use("/api/auth", authRouter);
app.use("/api/discovery", discoveryRouter);
app.use("/api/offers", offersRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/ledger", ledgerRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/sms", smsRouter);

// 404 for unknown API paths, so a typo returns JSON rather than HTML.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such endpoint" });
});

/**
 * Central error handler.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * which is why the route files have no try/catch around their queries. The real
 * error goes to the server log; the browser gets a generic message so database
 * internals are not leaked.
 */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);

  // ADR-0008: inbound is a poll of Textbee on localhost. Webhook comes later.
  // Only runs when a key is set, so local dev without Textbee is quiet.
  if (process.env.TEXTBEE_API_KEY) {
    const POLL_MS = 30_000;
    setInterval(async () => {
      try {
        const stored = await pollInbound();
        if (stored > 0) console.log(`[sms] polled ${stored} inbound message(s)`);
        // New bodies go through existing parseReply in routes/sms.ts reply flow.
        // Poll only stores; parsing here keeps the shape visible in logs.
        void parseReply;
      } catch (e) {
        console.error("[sms] inbound poll failed", e);
      }
    }, POLL_MS);
  }
});
