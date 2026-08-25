import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in from the LINE Developers Console.`,
    );
  }
  // Starting with the placeholders still copied from .env.example gets you a
  // server that boots fine and then 401s on every LINE call, which is a
  // miserable thing to debug. Fail loudly instead.
  if (value.startsWith('your_') && value.endsWith('_here')) {
    throw new Error(
      `${name} is still the placeholder from .env.example. Paste the real value from the LINE Developers Console.`,
    );
  }
  return value;
}

export const config = {
  channelSecret: required('LINE_CHANNEL_SECRET'),
  channelAccessToken: required('LINE_CHANNEL_ACCESS_TOKEN'),
  port: Number(process.env.PORT ?? 3000),
  timezone: process.env.TZ ?? 'Asia/Bangkok',
  currency: process.env.CURRENCY ?? 'บาท',
} as const;
