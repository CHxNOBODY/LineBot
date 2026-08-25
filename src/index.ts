import { SignatureValidationFailed, middleware, type WebhookRequestBody } from '@line/bot-sdk';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { prisma } from './db/client.js';
import { handleEvent } from './line/handlers.js';

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, tz: config.timezone });
});

/**
 * `middleware` verifies the X-Line-Signature header and parses the body. It has
 * to see the raw body, so no global express.json() before this route.
 */
app.post(
  '/webhook',
  middleware({ channelSecret: config.channelSecret }),
  async (req, res) => {
    const body = req.body as WebhookRequestBody;

    // Acknowledge immediately — LINE retries anything slower than a few seconds,
    // and a retry would double-post cards.
    res.status(200).end();

    await Promise.all(
      body.events.map((event) =>
        handleEvent(event).catch((err) => {
          console.error('event failed', event.type, err);
        }),
      ),
    );
  },
);

/**
 * Anything hitting /webhook without a valid X-Line-Signature isn't LINE, so say
 * 401 and move on rather than logging a stack trace for every internet scanner.
 */
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof SignatureValidationFailed) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  console.error('unhandled error', err);
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(config.port, () => {
  console.log(`🧾 bill splitter listening on :${config.port} (${config.timezone})`);
});

/**
 * `server.close()` waits for in-flight connections, which keep-alive clients
 * hold open indefinitely — so give it a deadline and exit regardless. Without
 * this the process survives Ctrl-C and keeps the port bound.
 */
function shutdown() {
  const forced = setTimeout(() => process.exit(0), 5_000);
  forced.unref();

  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
  server.closeIdleConnections?.();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, shutdown);
}
