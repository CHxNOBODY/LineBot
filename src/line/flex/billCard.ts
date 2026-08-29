import type { messagingApi } from '@line/bot-sdk';
import type { BillWithShares } from '../../db/repo.js';
import { formatAmount } from '../../utils/money.js';
import { dotColor, face, formatDate, palette } from './theme.js';

type Box = messagingApi.FlexBox;
type Component = messagingApi.FlexComponent;

/** A slim 8px progress bar showing how much of the bill has come back. */
function progressBar(paidMinor: number, totalMinor: number): Box {
  const pct = totalMinor === 0 ? 100 : Math.round((paidMinor / totalMinor) * 100);
  const clamped = Math.min(100, Math.max(0, pct));
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: palette.pinkSoft,
    height: '8px',
    cornerRadius: '4px',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        // A 0%-wide box still renders a sliver, so collapse it to nothing.
        width: clamped === 0 ? '1px' : `${clamped}%`,
        backgroundColor: clamped === 0 ? palette.pinkSoft : palette.paid,
        cornerRadius: '4px',
        contents: [{ type: 'filler' }],
      },
    ],
  };
}

/** Where one person's share has got to. */
export type ShareState = 'owing' | 'claimed' | 'paid';

/**
 * The right-hand slot on a share row: a tappable chip until the money is
 * confirmed, then a plain ✅. All three states are the same fixed width so the
 * amount column stays aligned however the rows are mixed.
 *
 * A claimed row reads "ยืนยัน" because the only person who should act on it is
 * the payer. The card is the same for everyone, though, so who may actually do
 * what is settled server-side, not by hiding chips.
 */
function tickSlot(billCode: string, memberId: string, name: string, state: ShareState): Box {
  const slot = { type: 'box', layout: 'vertical', flex: 0, width: '46px' } as const;

  if (state === 'paid') {
    return {
      ...slot,
      contents: [{ type: 'text', text: face.done, size: 'sm', align: 'center' }],
    };
  }

  const claimed = state === 'claimed';
  return {
    ...slot,
    backgroundColor: claimed ? palette.sunSoft : palette.pinkSoft,
    cornerRadius: '12px',
    paddingAll: '5px',
    action: {
      type: 'postback',
      label: claimed ? 'ยืนยัน' : 'ติ๊ก',
      data: `action=tick&bill=${billCode}&member=${memberId}`,
      displayText: claimed
        ? `ยืนยันว่า ${name} จ่ายบิล #${billCode} แล้ว`
        : `ติ๊กว่า ${name} จ่ายบิล #${billCode} แล้ว`,
    },
    contents: [
      {
        type: 'text',
        text: claimed ? 'ยืนยัน' : 'ติ๊ก',
        size: 'xxs',
        weight: 'bold',
        color: claimed ? palette.sun : palette.pink,
        align: 'center',
      },
    ],
  };
}

/** One "1. mint ......... 600 บาท [ ติ๊ก ]" line. */
function shareRow(opts: {
  index: number;
  billCode: string;
  memberId: string;
  name: string;
  amountMinor: number;
  state: ShareState;
  currency: string;
}): Box {
  const { index, name, amountMinor, state, currency } = opts;
  const paid = state === 'paid';
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
        backgroundColor: paid
          ? palette.hairline
          : state === 'claimed'
            ? palette.sun
            : dotColor(index),
        contents: [{ type: 'filler' }],
        flex: 0,
      },
      {
        type: 'text',
        text: `${index + 1}. ${name}`,
        size: 'sm',
        color: paid ? palette.muted : palette.text,
        weight: paid ? 'regular' : 'bold',
        decoration: paid ? 'line-through' : 'none',
        flex: 4,
        wrap: false,
      },
      {
        type: 'text',
        text: `${formatAmount(amountMinor)} ${currency}`,
        size: 'sm',
        color: paid ? palette.muted : palette.text,
        align: 'end',
        flex: 3,
        wrap: false,
      },
      tickSlot(opts.billCode, opts.memberId, name, state),
    ],
  };
}

export function billCard(
  bill: BillWithShares,
  opts: { currency: string; timezone: string; headline?: string },
): messagingApi.FlexMessage {
  const { currency, timezone } = opts;
  const paidMinor = bill.shares
    .filter((s) => s.paidAt)
    .reduce((sum, s) => sum + s.amountMinor, 0);
  const outstanding = bill.totalMinor - paidMinor;
  const settled = bill.settledAt !== null;

  const claimedCount = bill.shares.filter((s) => s.paidAt === null && s.claimedAt !== null).length;

  const rows: Component[] = bill.shares.map((share, i) =>
    shareRow({
      index: i,
      billCode: bill.code,
      memberId: share.memberId,
      name: share.member.displayName,
      amountMinor: share.amountMinor,
      state: share.paidAt ? 'paid' : share.claimedAt ? 'claimed' : 'owing',
      currency,
    }),
  );

  const header: Box = {
    type: 'box',
    layout: 'vertical',
    backgroundColor: settled ? palette.mintSoft : palette.pinkSoft,
    paddingAll: '16px',
    spacing: 'xs',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: `${settled ? face.party : face.bill} ${bill.title}`,
            weight: 'bold',
            size: 'lg',
            color: palette.text,
            wrap: true,
            flex: 5,
          },
          {
            type: 'text',
            text: `#${bill.code}`,
            size: 'sm',
            color: palette.muted,
            align: 'end',
            flex: 1,
          },
        ],
      },
      {
        type: 'text',
        text: `${formatDate(bill.createdAt, timezone)}  ·  ${face.money} ${bill.payer.displayName} จ่ายไปก่อน`,
        size: 'xs',
        color: palette.muted,
        wrap: true,
      },
    ],
  };

  const totalBlock: Box = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents: [
      { type: 'text', text: 'ยอดรวม / Total', size: 'xxs', color: palette.muted, align: 'center' },
      {
        type: 'text',
        text: `${formatAmount(bill.totalMinor)} ${currency}`,
        size: 'xxl',
        weight: 'bold',
        color: palette.pink,
        align: 'center',
      },
      { type: 'box', layout: 'vertical', margin: 'md', contents: [progressBar(paidMinor, bill.totalMinor)] },
      {
        type: 'text',
        text: settled
          ? `${face.sparkle} ครบแล้ว ทุกคนจ่ายเรียบร้อย ${face.sparkle}`
          : `เก็บได้ ${formatAmount(paidMinor)} · ค้างอีก ${formatAmount(outstanding)} ${currency}` +
            (claimedCount > 0 ? `\n${face.pending} รอยืนยัน ${claimedCount} คน` : ''),
        size: 'xxs',
        color: settled ? palette.paid : palette.muted,
        align: 'center',
        margin: 'sm',
        wrap: true,
      },
    ],
  };

  const footer: Box | null = settled
    ? null
    : {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: palette.pink,
            action: {
              type: 'postback',
              label: 'จ่ายแล้ว 💗',
              data: `action=pay&bill=${bill.code}`,
              displayText: `จ่ายบิล #${bill.code} แล้ว`,
            },
            flex: 3,
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            color: palette.pinkSoft,
            action: {
              type: 'postback',
              label: 'ทวง 🔔',
              data: `action=remind&bill=${bill.code}`,
              displayText: `ทวงบิล #${bill.code}`,
            },
            flex: 2,
          },
        ],
      };

  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header,
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: palette.card,
      paddingAll: '16px',
      spacing: 'md',
      contents: [
        totalBlock,
        { type: 'separator', color: palette.hairline },
        {
          type: 'text',
          text: `${face.heart} ใครต้องจ่ายบ้าง`,
          size: 'xs',
          weight: 'bold',
          color: palette.muted,
        },
        { type: 'box', layout: 'vertical', spacing: 'none', contents: rows },
      ],
    },
    // A `styles.footer` block with no footer to style is rejected by LINE.
    ...(footer ? { footer, styles: { header: { separator: false }, footer: { separator: false } } } : { styles: { header: { separator: false } } }),
  };

  return {
    type: 'flex',
    altText: opts.headline
      ? opts.headline
      : `${bill.title} · ${formatAmount(bill.totalMinor)} ${currency} (#${bill.code})`,
    contents: bubble,
  };
}
