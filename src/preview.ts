/**
 * Prints the Flex JSON for a sample bill card. Paste the output into
 * https://developers.line.biz/flex-simulator/ to tweak the look without
 * deploying anything.
 *
 *   npm run preview            # an open bill
 *   npm run preview -- settled # the all-paid version
 *   npm run preview -- summary # the /bills group summary
 */
import type { BillWithShares, Debt } from './db/repo.js';
import { billCard } from './line/flex/billCard.js';
import { summaryCard } from './line/flex/cards.js';

const CURRENCY = 'บาท';
const TZ = 'Asia/Bangkok';

const member = (id: string, displayName: string) => ({
  id,
  groupId: 'demo',
  lineUserId: `U_${id}`,
  displayName,
  createdAt: new Date('2026-08-25T12:00:00Z'),
});

const chx = member('chx', 'chxnobody');
const mint = member('mint', 'Mint');
const ploy = member('ploy', 'Ploy');

function sampleBill(settled: boolean): BillWithShares {
  const at = new Date('2026-08-25T12:00:00Z');
  return {
    id: 'demo-bill',
    groupId: 'demo',
    code: '1',
    title: 'ข้าวเย็นหมูกระทะ',
    totalMinor: 120000,
    payerId: chx.id,
    note: null,
    createdAt: at,
    settledAt: settled ? at : null,
    payer: chx,
    shares: [
      { id: 's1', billId: 'demo-bill', memberId: chx.id, amountMinor: 40000, paidAt: at, member: chx },
      {
        id: 's2',
        billId: 'demo-bill',
        memberId: mint.id,
        amountMinor: 40000,
        paidAt: settled ? at : null,
        member: mint,
      },
      {
        id: 's3',
        billId: 'demo-bill',
        memberId: ploy.id,
        amountMinor: 40000,
        paidAt: settled ? at : null,
        member: ploy,
      },
    ],
  };
}

const mode = process.argv[2] ?? 'open';

const message =
  mode === 'summary'
    ? summaryCard(
        [sampleBill(false)],
        [
          { from: mint, to: chx, amountMinor: 40000 },
          { from: ploy, to: chx, amountMinor: 40000 },
        ] satisfies Debt[],
        CURRENCY,
      )
    : billCard(sampleBill(mode === 'settled'), { currency: CURRENCY, timezone: TZ });

console.log(JSON.stringify(message.contents, null, 2));
