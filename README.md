# 🧾 หารบิล — LINE bill splitter bot

A LINE bot for the group-trip problem: one person pays for everyone, then has to
chase the rest. Open a bill in the group chat and the bot posts a card showing
the total and exactly who owes what, tracks who has paid, and @-mentions the
stragglers when you tell it to nudge them.

```text
🧾 ข้าวเย็นหมูกระทะ                      #1
25 Aug · 💸 chxnobody จ่ายไปก่อน
────────────────────────────────
            ยอดรวม / Total
             1,200 บาท
      ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░
   เก็บได้ 400 · ค้างอีก 800 บาท
────────────────────────────────
💗 ใครต้องจ่ายบ้าง
● 1. chxnobody          400 บาท ✅
● 2. Mint               400 บาท 🕐
● 3. Ploy               400 บาท 🕐
────────────────────────────────
    [ จ่ายแล้ว 💗 ]   [ ทวง 🔔 ]
```

Built with TypeScript, Express, the LINE Messaging API SDK v9, and Prisma on
SQLite. All amounts are stored as integer satang, so a 1,200 split three ways
adds back up to exactly 1,200 — no floating-point drift.

## Commands

Type these in the group chat. Thai aliases work too (`/หาร`, `/จ่าย`, `/สรุป`, `/ช่วย`).

| Command | What it does |
| --- | --- |
| `/bill ข้าวเย็น 1200` | Open a bill, split evenly between everyone the bot knows |
| `/bill ข้าวเย็น 1200 mint ploy` | Split only between the people you name |
| `/bill ข้าวเย็น 1200 mint=500 ploy` | Pin some amounts; the rest share what's left |
| `/bill ข้าวเย็น 1200 mint ploy by=nobody` | Someone other than you fronted the money |
| `/pay` / `/pay 3` | Mark your own share paid (newest unpaid bill if no number) |
| `/paid 3 mint` | The person who paid confirms someone has settled up |
| `/unpay 3 mint` | Undo a tick |
| `/remind 3` | Re-post the card and @-mention everyone still owing |
| `/bill 3` | Show bill #3 again |
| `/bills` | Every open bill plus a who-owes-who summary |
| `/me` | What you owe and what you're owed |
| `/members` | Everyone the bot has seen |
| `/add ชื่อ` | Add someone who never talks in the group |
| `/help` | The command menu |

The person who fronted the money has their own share ticked off automatically —
you don't owe yourself. A bill closes itself once every share is paid and drops
off `/bills`.

### How the bot learns who's in the group

Unverified LINE bots can't list a group's members, so the bot registers people
as it sees them talk. Get everyone to send one message in the group after you
add the bot, or use `/add <name>` for anyone quiet. `/members` shows who it knows.

## Setup

### 1. Create the LINE channel

Since 4 September 2024 you can't create a Messaging API channel in the Developers
Console — it starts from the Official Account Manager. A **LINE Login** channel is
a different thing and has no access token; make sure you end up on a **Messaging
API** channel.

1. In [LINE Official Account Manager](https://manager.line.biz/), create a LINE
   Official Account.
2. **Settings → Messaging API → Enable Messaging API**, and choose a provider.
   This creates the Messaging API channel.
3. Open that channel in the
   [LINE Developers Console](https://developers.line.biz/console/):
   - **Basic settings** → copy the **Channel secret** → `LINE_CHANNEL_SECRET`
   - **Messaging API** → issue a long-lived **Channel access token** →
     `LINE_CHANNEL_ACCESS_TOKEN`

   Both values must come from this same channel, or every webhook fails
   signature validation.
4. **Messaging API** → turn **Use webhook** on, and turn **Auto-reply messages**
   and **Greeting messages** off (LINE's canned replies otherwise talk over the bot).
5. **Messaging API** → set **Allow bot to join group chats** to **on**, otherwise
   you can't add it to your group.

### 2. Run it

```bash
npm install
cp .env.example .env     # then fill in the two LINE values
npm run db:push          # creates prisma/dev.db
npm run dev
```

### 3. Point LINE at your machine

LINE needs a public HTTPS URL. For local development:

```bash
npx localtunnel --port 3000     # or: ngrok http 3000
```

Set the webhook URL in the console to `https://<your-tunnel>/webhook` and hit
**Verify**. Then add the bot to your group and send `/help`.

## Designing the cards

Every colour and emoji lives in `src/line/flex/theme.ts`. To try a change without
deploying, print the Flex JSON and paste it into LINE's
[Flex Message Simulator](https://developers.line.biz/flex-simulator/):

```bash
npm run preview             # open bill
npm run preview -- settled  # the all-paid version
npm run preview -- summary  # the /bills card
```

## Layout

```text
src/
  index.ts              Express app + LINE signature middleware
  config.ts             env loading, fails fast on missing secrets
  commands/
    parse.ts            text -> Command (pure, unit-tested)
    execute.ts          Command -> LINE messages
  line/
    client.ts           SDK client, profile lookups
    handlers.ts         webhook event routing
    flex/
      theme.ts          palette + emoji
      billCard.ts       the main bill card
      cards.ts          summary, personal, help, notice cards
  db/
    client.ts           Prisma client
    repo.ts             all queries, split/settle logic
  utils/money.ts        satang arithmetic and splitting
prisma/schema.prisma    Group / Member / Bill / Share
test/money.test.ts      money + parser tests
```

## Scripts

| Script | |
| --- | --- |
| `npm run dev` | watch mode |
| `npm run build` / `npm start` | compile to `dist/` and run |
| `npm test` | unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | sync schema to the database |
| `npm run db:studio` | browse the data |
| `npm run preview` | dump Flex JSON for the simulator |
| `npm run check:cards` | validate credentials + every card against LINE's schema |

## Deploying

Any host with a persistent disk works (Railway, Fly.io, a VPS). Set
`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` and `DATABASE_URL`, run
`npm run build`, then `npm start`.

Deploying somewhere without a disk (Vercel, Cloud Run)? Change one line in
`prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

point `DATABASE_URL` at Supabase/Neon, and run `npm run db:push`. No application
code changes.

## Security

`.env` is gitignored — keep your channel secret and access token out of the repo.
If either has ever been committed, rotate it in the LINE Developers Console.
