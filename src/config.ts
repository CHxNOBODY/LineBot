import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in from the LINE Developers Console.`,
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
