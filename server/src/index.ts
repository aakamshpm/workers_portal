import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { offersRouter } from "./routes/offers";
import { paymentsRouter } from "./routes/payments";
import { ledgerRouter } from "./routes/ledger";
import { complaintsRouter } from "./routes/complaints";
import { smsRouter } from "./routes/sms";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "migrant-wage-ledger" });
});

app.use("/api/auth", authRouter);
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
});
