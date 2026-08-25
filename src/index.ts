import { middleware, type WebhookRequestBody } from '@line/bot-sdk';
import express from 'express';
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

const server = app.listen(config.port, () => {
  console.log(`🧾 bill splitter listening on :${config.port} (${config.timezone})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
}
