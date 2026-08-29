import type { messagingApi } from '@line/bot-sdk';
import type { BillWithShares, Debt } from '../../db/repo.js';
import { formatAmount } from '../../utils/money.js';
import { dotColor, face, palette } from './theme.js';

type Component = messagingApi.FlexComponent;

function shell(
  altText: string,
  title: string,
  subtitle: string,
  body: Component[],
  accent: string = palette.pinkSoft,
): messagingApi.FlexMessage {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: accent,
        paddingAll: '16px',
        spacing: 'xs',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'lg', color: palette.text, wrap: true },
          { type: 'text', text: subtitle, size: 'xs', color: palette.muted, wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: palette.card,
        paddingAll: '16px',
        spacing: 'md',
        contents: body,
      },
      styles: { header: { separator: false } },
    },
  };
}

/** Small one-off message for confirmations and errors. */
export function noticeCard(text: string, tone: 'happy' | 'oops' = 'happy'): messagingApi.FlexMessage {
  const accent = tone === 'happy' ? palette.mintSoft : palette.sunSoft;
  return {
    type: 'flex',
    altText: text,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: accent,
        paddingAll: '16px',
        contents: [{ type: 'text', text, wrap: true, size: 'sm', color: palette.text }],
      },
    },
  };
}

function debtRow(index: number, debt: Debt, currency: string): Component {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    alignItems: 'center',
    paddingTop: '6px',
    paddingBottom: '6px',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '8px',
        height: '8px',
        cornerRadius: '4px',
        backgroundColor: dotColor(index),
        contents: [{ type: 'filler' }],
        flex: 0,
      },
      {
        type: 'text',
        text: `${debt.from.displayName} → ${debt.to.displayName}`,
        size: 'sm',
        color: palette.text,
        flex: 5,
        wrap: true,
      },
      {
        type: 'text',
        text: `${formatAmount(debt.amountMinor)} ${currency}`,
        size: 'sm',
        weight: 'bold',
        color: palette.pink,
        align: 'end',
        flex: 3,
        wrap: false,
      },
    ],
  };
}

export function summaryCard(
  bills: BillWithShares[],
  debts: Debt[],
  currency: string,
): messagingApi.FlexMessage {
  if (bills.length === 0) {
    return noticeCard(`${face.party} ไม่มีบิลค้างเลย เคลียร์หมดแล้ว!`);
  }

  const outstandingTotal = debts.reduce((sum, d) => sum + d.amountMinor, 0);

  const billLines: Component[] = bills.map((bill) => {
    const unpaid = bill.shares.filter((s) => s.paidAt === null).length;
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingTop: '4px',
      paddingBottom: '4px',
      contents: [
        { type: 'text', text: `#${bill.code}`, size: 'xs', color: palette.muted, flex: 1 },
        { type: 'text', text: bill.title, size: 'sm', color: palette.text, flex: 4, wrap: true },
        {
          type: 'text',
          text: `ค้าง ${unpaid} คน`,
          size: 'xs',
          color: unpaid === 0 ? palette.paid : palette.muted,
          align: 'end',
          flex: 3,
        },
      ],
    };
  });

  const body: Component[] = [
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        { type: 'text', text: 'ค้างจ่ายรวมทั้งกลุ่ม', size: 'xxs', color: palette.muted, align: 'center' },
        {
          type: 'text',
          text: `${formatAmount(outstandingTotal)} ${currency}`,
          size: 'xxl',
          weight: 'bold',
          color: palette.pink,
          align: 'center',
        },
      ],
    },
    { type: 'separator', color: palette.hairline },
    { type: 'text', text: `${face.bill} บิลที่ยังไม่ปิด`, size: 'xs', weight: 'bold', color: palette.muted },
    { type: 'box', layout: 'vertical', contents: billLines },
  ];

  if (debts.length > 0) {
    body.push(
      { type: 'separator', color: palette.hairline },
      { type: 'text', text: `${face.money} ใครต้องจ่ายใคร`, size: 'xs', weight: 'bold', color: palette.muted },
      { type: 'box', layout: 'vertical', contents: debts.map((d, i) => debtRow(i, d, currency)) },
    );
  }

  return shell(
    `ค้างจ่ายรวม ${formatAmount(outstandingTotal)} ${currency}`,
    `${face.cat} สรุปยอดกลุ่ม`,
    `${bills.length} บิลที่ยังไม่ปิด · พิมพ์ /bill <ชื่อ> <ยอด> เพื่อเปิดบิลใหม่`,
    body,
    palette.lavenderSoft,
  );
}

export function personalCard(
  name: string,
  owes: Debt[],
  owed: Debt[],
  currency: string,
): messagingApi.FlexMessage {
  const owesTotal = owes.reduce((s, d) => s + d.amountMinor, 0);
  const owedTotal = owed.reduce((s, d) => s + d.amountMinor, 0);
  const net = owedTotal - owesTotal;

  const body: Component[] = [
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        {
          type: 'text',
          text: net >= 0 ? 'เพื่อนติดเธออยู่' : 'เธอติดเพื่อนอยู่',
          size: 'xxs',
          color: palette.muted,
          align: 'center',
        },
        {
          type: 'text',
          text: `${formatAmount(Math.abs(net))} ${currency}`,
          size: 'xxl',
          weight: 'bold',
          color: net >= 0 ? palette.paid : palette.pink,
          align: 'center',
        },
      ],
    },
  ];

  if (owes.length > 0) {
    body.push(
      { type: 'separator', color: palette.hairline },
      { type: 'text', text: `${face.money} ต้องจ่ายให้`, size: 'xs', weight: 'bold', color: palette.muted },
      { type: 'box', layout: 'vertical', contents: owes.map((d, i) => debtRow(i, d, currency)) },
    );
  }
  if (owed.length > 0) {
    body.push(
      { type: 'separator', color: palette.hairline },
      { type: 'text', text: `${face.done} รอรับจาก`, size: 'xs', weight: 'bold', color: palette.muted },
      { type: 'box', layout: 'vertical', contents: owed.map((d, i) => debtRow(i, d, currency)) },
    );
  }
  if (owes.length === 0 && owed.length === 0) {
    body.push({
      type: 'text',
      text: `${face.party} เคลียร์หมดแล้ว ไม่ติดใครเลย`,
      size: 'sm',
      color: palette.muted,
      align: 'center',
      wrap: true,
    });
  }

  return shell(
    `ยอดของ ${name}`,
    `${face.sparkle} ยอดของ ${name}`,
    'เฉพาะบิลที่ยังไม่ปิด',
    body,
    palette.mintSoft,
  );
}

type HelpEntry = { cmd: string; desc: string };

const HELP: HelpEntry[] = [
  { cmd: '/bill ข้าวเย็น 1200', desc: 'เปิดบิล หารทุกคนในกลุ่มเท่า ๆ กัน' },
  { cmd: '/bill ข้าวเย็น 1200 mint ploy', desc: 'หารเฉพาะคนที่ระบุ' },
  { cmd: '/bill ข้าวเย็น 1200 mint=500 ploy', desc: 'ล็อกยอดบางคน ที่เหลือหารกัน' },
  { cmd: '/pay 3', desc: 'บอกว่าเราจ่ายบิล #3 แล้ว' },
  { cmd: '/paid 3 mint', desc: 'คนที่ออกเงินยืนยันว่า mint จ่ายแล้ว' },
  { cmd: '/unpay 3 mint', desc: 'ยกเลิกการติ๊กว่าจ่ายแล้ว' },
  { cmd: '/bill 3', desc: 'ดูการ์ดบิล #3 อีกครั้ง' },
  { cmd: '/bills', desc: 'สรุปบิลที่ยังไม่ปิดทั้งหมด' },
  { cmd: '/me', desc: 'ดูว่าเราติดใคร ใครติดเรา' },
  { cmd: '/members', desc: 'ดูรายชื่อที่บอทรู้จัก' },
  { cmd: '/add ชื่อ', desc: 'เพิ่มคนที่ไม่เคยพิมพ์ในกลุ่ม' },
  { cmd: '/sync', desc: 'ดึงรายชื่อทุกคนจาก LINE (บัญชี verified เท่านั้น)' },
  { cmd: '/help', desc: 'เมนูนี้' },
];

export function helpCard(): messagingApi.FlexMessage {
  const rows: Component[] = HELP.map((entry) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'none',
    paddingTop: '6px',
    paddingBottom: '6px',
    contents: [
      { type: 'text', text: entry.cmd, size: 'sm', weight: 'bold', color: palette.text, wrap: true },
      { type: 'text', text: entry.desc, size: 'xs', color: palette.muted, wrap: true },
    ],
  }));

  return shell(
    'วิธีใช้บอทหารบิล',
    `${face.cat} หารบิลกันเถอะ`,
    'พิมพ์คำสั่งพวกนี้ในกลุ่มได้เลย',
    [{ type: 'box', layout: 'vertical', contents: rows }],
    palette.sunSoft,
  );
}
