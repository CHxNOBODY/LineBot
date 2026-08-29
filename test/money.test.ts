import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAmount, parseAmount, splitEvenly, splitWithFixed } from '../src/utils/money.js';
import { parseCommand } from '../src/commands/parse.js';

test('parseAmount accepts the shapes people actually type', () => {
  assert.equal(parseAmount('1200'), 120000);
  assert.equal(parseAmount('1,200'), 120000);
  assert.equal(parseAmount('1200.50'), 120050);
  assert.equal(parseAmount('1200.5'), 120050);
  assert.equal(parseAmount('฿1200'), 120000);
});

test('parseAmount rejects junk and non-positive amounts', () => {
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-50'), null);
  assert.equal(parseAmount('12.345'), null);
});

test('formatAmount hides trailing zero satang', () => {
  assert.equal(formatAmount(120000), '1,200');
  assert.equal(formatAmount(120050), '1,200.50');
  assert.equal(formatAmount(5), '0.05');
});

test('an even split adds back up to the total', () => {
  assert.deepEqual(splitEvenly(120000, 2), [60000, 60000]);

  // 1200 / 7 does not divide evenly; the leftover satang go to the first few.
  const seven = splitEvenly(120000, 7);
  assert.equal(seven.reduce((a, b) => a + b, 0), 120000);
  assert.equal(Math.max(...seven) - Math.min(...seven), 1);
});

test('fixed amounts are honoured and the rest is shared', () => {
  const shares = splitWithFixed(120000, [50000, null, null]);
  assert.deepEqual(shares, [50000, 35000, 35000]);
});

test('fixed amounts that overshoot the total are rejected', () => {
  assert.equal(splitWithFixed(120000, [130000, null]), null);
  assert.equal(splitWithFixed(120000, [50000, 50000]), null);
  assert.deepEqual(splitWithFixed(120000, [50000, 70000]), [50000, 70000]);
});

test('a plain group message is not a command', () => {
  assert.equal(parseCommand('กินข้าวกันมั้ย'), null);
  assert.equal(parseCommand('1200'), null);
});

test('/bill picks the amount out of a multi-word title', () => {
  const cmd = parseCommand('/bill ข้าวเย็น หมูกระทะ 1200 mint ploy');
  assert.deepEqual(cmd, {
    kind: 'createBill',
    title: 'ข้าวเย็น หมูกระทะ',
    amountRaw: '1200',
    payerName: null,
    targets: [
      { kind: 'person', name: 'mint', fixedRaw: null },
      { kind: 'person', name: 'ploy', fixedRaw: null },
    ],
  });
});

test('/bill supports pinned amounts and an explicit payer', () => {
  const cmd = parseCommand('/bill dinner 1200 mint=500 ploy by=chxnobody');
  assert.deepEqual(cmd, {
    kind: 'createBill',
    title: 'dinner',
    amountRaw: '1200',
    payerName: 'chxnobody',
    targets: [
      { kind: 'person', name: 'mint', fixedRaw: '500' },
      { kind: 'person', name: 'ploy', fixedRaw: null },
    ],
  });
});

test('/bill with a lone number shows that bill instead of creating one', () => {
  assert.deepEqual(parseCommand('/bill 3'), { kind: 'showBill', code: '3' });
  assert.deepEqual(parseCommand('/bill #3'), { kind: 'showBill', code: '3' });
});

test('pay and paid commands', () => {
  assert.deepEqual(parseCommand('/pay'), { kind: 'pay', code: null });
  assert.deepEqual(parseCommand('/pay 3'), { kind: 'pay', code: '3' });
  assert.deepEqual(parseCommand('/paid 3 mint'), {
    kind: 'markPaid',
    code: '3',
    target: { kind: 'name', name: 'mint' },
    paid: true,
  });
  assert.deepEqual(parseCommand('/unpay 3 mint'), {
    kind: 'markPaid',
    code: '3',
    target: { kind: 'name', name: 'mint' },
    paid: false,
  });
  // Bare /paid means "I paid", same as tapping your own row on the card.
  assert.deepEqual(parseCommand('/paid 3'), {
    kind: 'markPaid',
    code: '3',
    target: null,
    paid: true,
  });
});

test('/sync is its own command, with a Thai alias', () => {
  assert.deepEqual(parseCommand('/sync'), { kind: 'syncMembers' });
  assert.deepEqual(parseCommand('/ซิงค์'), { kind: 'syncMembers' });
});

test('Thai aliases work', () => {
  assert.deepEqual(parseCommand('/สรุป'), { kind: 'listBills' });
  assert.deepEqual(parseCommand('/ช่วย'), { kind: 'help' });
  assert.deepEqual(parseCommand('/จ่าย 2'), { kind: 'pay', code: '2' });
});
