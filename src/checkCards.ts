/**
 * Checks the LINE credentials and validates every card variant against LINE's
 * own message schema, without sending anything to anyone.
 *
 *   npm run check:cards
 *
 * Worth running after touching theme.ts or any Flex builder — LINE rejects an
 * invalid bubble at send time with a terse error, which is a slow way to find
 * out you nested a box wrong.
 */
import { config } from './config.js';
import type { BillWithShares, Debt } from './db/repo.js';
import { billCard } from './line/flex/billCard.js';
import { helpCard, noticeCard, personalCard, summaryCard } from './line/flex/cards.js';

const H = {
  Authorization: `Bearer ${config.channelAccessToken}`,
  'Content-Type': 'application/json',
};

const member = (id: string, displayName: string) => ({
  id, groupId: 'g', lineUserId: `U${id}`, displayName, createdAt: new Date('2026-08-25T12:00:00Z'),
});
const chx = member('chx', 'chxnobody');
const mint = member('mint', 'Mint');
const ploy = member('ploy', 'Ploy');

function bill(settled: boolean): BillWithShares {
  const at = new Date('2026-08-25T12:00:00Z');
  const paid = (p: boolean) => (p ? at : null);
  return {
    id: 'b', groupId: 'g', code: '1', title: 'ข้าวเย็นหมูกระทะ', totalMinor: 120000,
    payerId: chx.id, note: null, createdAt: at, settledAt: settled ? at : null, payer: chx,
    shares: [
      { id: '1', billId: 'b', memberId: chx.id, amountMinor: 40000, paidAt: at, member: chx },
      { id: '2', billId: 'b', memberId: mint.id, amountMinor: 40000, paidAt: paid(settled), member: mint },
      { id: '3', billId: 'b', memberId: ploy.id, amountMinor: 40000, paidAt: paid(settled), member: ploy },
    ],
  };
}

const debts: Debt[] = [
  { from: mint, to: chx, amountMinor: 40000 },
  { from: ploy, to: chx, amountMinor: 40000 },
];

const cur = config.currency;
const opts = { currency: cur, timezone: config.timezone };

const cases: [string, unknown][] = [
  ['bill card (open, has footer buttons)', billCard(bill(false), opts)],
  ['bill card (settled, no footer)', billCard(bill(true), opts)],
  ['group summary /bills', summaryCard([bill(false)], debts, cur)],
  ['personal /me (owed)', personalCard('chxnobody', [], debts, cur)],
  ['personal /me (owes)', personalCard('Mint', [debts[0]!], [], cur)],
  ['personal /me (clear)', personalCard('Ploy', [], [], cur)],
  ['help card', helpCard()],
  ['notice happy', noticeCard('✅ รับทราบ')],
  ['notice oops', noticeCard('🐱 ไม่เจอบิลนะ', 'oops')],
  ['empty summary', summaryCard([], [], cur)],
  ['remind textV2 with mentions', {
    type: 'textV2',
    text: '💸 ทวงบิล #1 หน่อยน้า\n{p0} 400 บาท\n{p1} 400 บาท\n\nโอนให้ chxnobody แล้วพิมพ์ /pay 1 ได้เลย 💗',
    substitution: {
      p0: { type: 'mention', mentionee: { type: 'user', userId: 'U'.padEnd(33, '0') } },
      p1: { type: 'mention', mentionee: { type: 'user', userId: 'U'.padEnd(33, '1') } },
    },
  }],
];

async function main() {
  const info = await fetch('https://api.line.me/v2/bot/info', { headers: H });
  if (!info.ok) {
    console.log(`❌ credentials rejected: ${info.status} ${await info.text()}`);
    process.exit(1);
  }
  const bot = (await info.json()) as Record<string, string>;
  console.log('✅ token valid');
  console.log(`   bot name : ${bot.displayName}`);
  console.log(`   basic id : ${bot.basicId}`);
  console.log(`   chat mode: ${bot.chatMode}   (must be "bot", not "chat")`);
  console.log(`   auto-read: ${bot.markAsReadMode}\n`);

  let bad = 0;
  for (const [name, message] of cases) {
    const r = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ messages: [message] }),
    });
    if (r.ok) {
      console.log(`✅ ${name}`);
    } else {
      bad++;
      console.log(`❌ ${name}\n   ${(await r.text()).slice(0, 600)}`);
    }
  }
  console.log(bad === 0 ? '\nAll cards valid.' : `\n${bad} card(s) rejected.`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
