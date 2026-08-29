# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LINE Messaging API bot (Thai-language UI) that splits group bills: one person
fronts the money, the bot posts a Flex card showing who owes what, tracks
payments, and @-mentions stragglers on `/remind`. TypeScript ESM on Node 20+,
Express, `@line/bot-sdk` v9, Prisma on SQLite.

## Commands

```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc -> dist/ ;  npm start runs dist/index.js
npm run typecheck    # tsc --noEmit
npm test             # node --test --import tsx test/*.test.ts
npm run db:push      # sync prisma/schema.prisma to the DB (creates prisma/dev.db)
npm run db:studio    # browse data
npm run preview      # print Flex JSON for the LINE simulator ( -- settled | -- summary )
npm run check:cards  # verify credentials + POST every card to LINE's validate endpoint
```

Run a single test: `node --test --import tsx --test-name-pattern "even split" test/money.test.ts`.

`npm run check:cards` and `npm run preview` are the fastest feedback loop for
any change under `src/line/flex/` — LINE rejects a malformed bubble at send
time with a terse error, so validate before wiring anything up. `check:cards`
hits the real LINE API and needs valid credentials in `.env`; `preview` needs
none.

Local webhook testing needs a public HTTPS tunnel — `npx cloudflared tunnel
--url http://localhost:3000` — pointed at `/webhook` in the LINE Developers
Console. A **503** on Verify means the tunnel died, not that the server broke;
localtunnel drops out silently and often, which is why cloudflared is the
default here. To prove the server independently of any tunnel, POST
`{"destination":"U","events":[]}` to `/webhook` with an `X-Line-Signature` of
the body's HMAC-SHA256 keyed on `LINE_CHANNEL_SECRET` (base64) and expect 200,
then repeat with a junk signature and expect 401. Both
`LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` must come from the *same*
Messaging API channel or every request fails signature validation.

## Architecture

Text and button presses both funnel into one pure-ish pipeline:

```
webhook event -> handlers.ts (routing, ctx)
              -> parse.ts    (text  -> Command)   pure, unit-tested
              -> execute.ts  (Command -> Message[])
              -> repo.ts     (all Prisma queries)
              -> flex/*      (Message construction)
```

- **`parse.ts`** is the only place that knows the chat grammar. `Command` is a
  discriminated union; adding a command means extending that union, and
  `execute`'s switch then fails typecheck until handled. Every verb has a Thai
  alias in the `ALIASES` map.
- **`execute.ts`** returns `messagingApi.Message[]` and never touches Prisma
  directly — everything goes through `repo.ts`. Its helpers return `string` for
  user-facing errors, which the caller wraps in `noticeCard(..., 'oops')`.
- **Card buttons** post back `action=<pay|remind|show>&bill=<code>`, plus
  `action=tick&bill=<code>&member=<memberId>` for the per-person chips on the
  bill card. `commandFromPostback` in `handlers.ts` turns these into the same
  `Command` values the text parser produces. Keep the two in sync when adding
  button actions. `markPaid` carries a `PaidTarget` union precisely because the
  two routes identify people differently — typed commands have a name to
  resolve, chips already know the member id.
- **`handlers.ts` builds a `Ctx` for *every* text message, command or not.**
  That's deliberate: unverified LINE bots can't enumerate group members, so the
  bot learns who exists by upserting a `Member` whenever someone speaks.
  `/bill ... @all` depends on it. Don't short-circuit non-commands before
  `buildCtx`.
- **`roster.ts` is the other half of learning who exists.** `registerMembers`
  upserts a batch of LINE user ids (profile lookups run 8 at a time); `syncRoster`
  pulls the full list first. `join` and `/sync` call `syncRoster`, `memberJoined`
  calls `registerMembers`. All of it is best-effort: `getGroupMembersIds` is gated
  on the account being verified or premium, and an ordinary account gets
  `403 Access to this API is not available for your account` — returned as
  `{ ok: false, reason: 'forbidden' }`, never thrown. Treat that as the normal
  path and keep the speak-to-be-seen fallback working.
- **`index.ts`** acknowledges the webhook with 200 *before* processing events —
  LINE retries anything slower than a few seconds and a retry double-posts
  cards. The SDK `middleware` needs the raw body, so never mount a global
  `express.json()` ahead of `/webhook`.

## Money

All amounts are integer **minor units (satang)** end to end — DB columns
(`totalMinor`, `amountMinor`), function args, everything. Floats are never used
for arithmetic. `splitEvenly` hands the indivisible remainder out one satang at
a time so shares always sum back to exactly the total; `splitWithFixed` layers
pinned amounts on top and returns `null` when they can't reconcile. Convert to
a display string only at the edge, via `formatAmount`.

## Data model

`Group` (one LINE group/room/1:1) → `Member` → `Bill` → `Share`.

- `Member.lineUserId` is nullable — people added via `/add <name>` have no LINE
  id and therefore can't be @-mentioned (`mentionMessage` falls back to plain
  text for them).
- `Bill.code` is a short per-group number (`"1"`, `"2"`) so people can type
  `/pay 3`; allocation retries on the unique constraint.
- A bill's `settledAt` is maintained by `setSharePaid`, which re-counts unpaid
  shares after every tick — that's what drops it off `/bills`. The payer's own
  share is ticked automatically at creation.

## Flex cards

Every colour, emoji and date format lives in `src/line/flex/theme.ts`; card
builders pull from it rather than hardcoding. `billCard.ts` is the main card;
`cards.ts` holds summary / personal / help / notice. `check:cards` covers each
variant (open, settled, empty, both notice tones) — extend its `cases` array
when you add one.

## Conventions

- ESM with `NodeNext` resolution: relative imports must carry the `.js`
  extension even in `.ts` source.
- `strict` plus `noUncheckedIndexedAccess`, so indexed access needs `!` or a
  guard; the existing code uses `!` where the index is provably in range.
- User-facing strings are Thai. `config.currency` (default `บาท`) and
  `config.timezone` come from env — don't hardcode either in card builders.
- `config.ts` throws at import time on a missing secret *or* on an unreplaced
  `.env.example` placeholder. Anything importing `config` therefore can't boot
  without real credentials.
