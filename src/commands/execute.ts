import type { messagingApi } from '@line/bot-sdk';
import type { Member as DbMember } from '@prisma/client';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { billCard } from '../line/flex/billCard.js';
import { helpCard, noticeCard, personalCard, summaryCard } from '../line/flex/cards.js';
import { face } from '../line/flex/theme.js';
import { formatAmount, parseAmount, splitWithFixed } from '../utils/money.js';
import type { Command, Target } from './parse.js';

export type Ctx = {
  /** Our Group row id, not the LINE id. */
  groupId: string;
  /** The person who typed the command. */
  actor: DbMember;
};

type Reply = messagingApi.Message[];

const { currency, timezone } = config;

const card = (bill: repo.BillWithShares, headline?: string) =>
  billCard(bill, { currency, timezone, ...(headline ? { headline } : {}) });

export async function execute(command: Command, ctx: Ctx): Promise<Reply> {
  switch (command.kind) {
    case 'help':
      return [helpCard()];

    case 'unknown':
      return [noticeCard(`${face.cat} ไม่รู้จักคำสั่ง "/${command.verb}" นะ ลองพิมพ์ /help ดู`, 'oops')];

    case 'members':
      return [await membersReply(ctx)];

    case 'addMember':
      return [await addMember(command.name, ctx)];

    case 'listBills': {
      const [bills, debts] = await Promise.all([
        repo.listOpenBills(ctx.groupId),
        repo.outstandingDebts(ctx.groupId),
      ]);
      return [summaryCard(bills, debts, currency)];
    }

    case 'me': {
      const debts = await repo.outstandingDebts(ctx.groupId);
      const owes = debts.filter((d) => d.from.id === ctx.actor.id);
      const owed = debts.filter((d) => d.to.id === ctx.actor.id);
      return [personalCard(ctx.actor.displayName, owes, owed, currency)];
    }

    case 'showBill': {
      const bill = await repo.findBill(ctx.groupId, command.code);
      if (!bill) return [notFound(command.code)];
      return [card(bill)];
    }

    case 'createBill':
      return createBill(command, ctx);

    case 'pay':
      return payOwnShare(command.code, ctx);

    case 'markPaid':
      return markSomeonePaid(command, ctx);

    case 'remind':
      return remind(command.code, ctx);
  }
}

const notFound = (code: string) =>
  noticeCard(`${face.cat} ไม่เจอบิล #${code} ลองพิมพ์ /bills ดูรายการทั้งหมด`, 'oops');

async function membersReply(ctx: Ctx): Promise<messagingApi.Message> {
  const members = await repo.listMembers(ctx.groupId);
  if (members.length === 0) {
    return noticeCard(`${face.wave} ยังไม่รู้จักใครเลย ให้ทุกคนพิมพ์อะไรก็ได้ในกลุ่มสักครั้ง`, 'oops');
  }
  const list = members.map((m, i) => `${i + 1}. ${m.displayName}`).join('\n');
  return noticeCard(`${face.cat} คนที่บอทรู้จัก (${members.length})\n${list}`);
}

async function addMember(name: string, ctx: Ctx): Promise<messagingApi.Message> {
  const existing = await repo.listMembers(ctx.groupId);
  if (repo.resolveMember(existing, name) !== null) {
    return noticeCard(`${face.cat} มี "${name}" อยู่แล้วนะ`, 'oops');
  }
  const member = await repo.addMemberByName(ctx.groupId, name);
  return noticeCard(`${face.sparkle} เพิ่ม "${member.displayName}" เรียบร้อย`);
}

/**
 * Turn the names typed after the amount into concrete members. Unnamed people
 * split whatever is left over after the pinned amounts.
 */
async function resolveTargets(
  targets: Target[],
  ctx: Ctx,
): Promise<{ members: DbMember[]; fixed: (number | null)[] } | string> {
  const known = await repo.listMembers(ctx.groupId);

  const wantsEveryone = targets.length === 0 || targets.some((t) => t.kind === 'everyone');
  if (wantsEveryone) {
    if (known.length === 0) return 'ยังไม่รู้จักใครในกลุ่มเลย ให้ทุกคนพิมพ์อะไรสักครั้งก่อนนะ';
    return { members: known, fixed: known.map(() => null) };
  }

  const members: DbMember[] = [];
  const fixed: (number | null)[] = [];

  for (const target of targets) {
    if (target.kind !== 'person') continue;

    const match = repo.resolveMember(known, target.name);
    if (match === null) return `ไม่รู้จัก "${target.name}" — พิมพ์ /members ดูรายชื่อ หรือ /add ${target.name}`;
    if (match === 'ambiguous') return `"${target.name}" ตรงกับหลายคน พิมพ์ชื่อให้ยาวขึ้นหน่อยนะ`;
    if (members.some((m) => m.id === match.id)) continue; // named twice, count once

    let amount: number | null = null;
    if (target.fixedRaw !== null) {
      amount = parseAmount(target.fixedRaw);
      if (amount === null) return `ยอดของ "${target.name}" (${target.fixedRaw}) อ่านไม่ออกนะ`;
    }
    members.push(match);
    fixed.push(amount);
  }

  if (members.length === 0) return 'ยังไม่ได้บอกว่าใครต้องหารบ้าง';
  return { members, fixed };
}

async function createBill(
  command: Extract<Command, { kind: 'createBill' }>,
  ctx: Ctx,
): Promise<Reply> {
  const totalMinor = parseAmount(command.amountRaw);
  if (totalMinor === null) {
    return [noticeCard(`${face.cat} ยอด "${command.amountRaw}" อ่านไม่ออกนะ ลองใส่เป็นตัวเลข เช่น 1200`, 'oops')];
  }

  const resolved = await resolveTargets(command.targets, ctx);
  if (typeof resolved === 'string') return [noticeCard(`${face.cat} ${resolved}`, 'oops')];

  // Whoever fronted the money — the sender unless `by=name` says otherwise.
  let payer = ctx.actor;
  if (command.payerName) {
    const known = await repo.listMembers(ctx.groupId);
    const match = repo.resolveMember(known, command.payerName);
    if (match === null || match === 'ambiguous') {
      return [noticeCard(`${face.cat} ไม่รู้ว่า "${command.payerName}" คือใคร`, 'oops')];
    }
    payer = match;
  }

  const amounts = splitWithFixed(totalMinor, resolved.fixed);
  if (amounts === null) {
    const fixedSum = resolved.fixed.reduce<number>((a, v) => a + (v ?? 0), 0);
    return [
      noticeCard(
        `${face.cat} ยอดที่ล็อกไว้รวม ${formatAmount(fixedSum)} ${currency} ` +
          `ไม่ตรงกับยอดรวม ${formatAmount(totalMinor)} ${currency} นะ`,
        'oops',
      ),
    ];
  }

  const bill = await repo.createBill({
    groupId: ctx.groupId,
    title: command.title,
    totalMinor,
    payerId: payer.id,
    shares: resolved.members.map((m, i) => ({ memberId: m.id, amountMinor: amounts[i]! })),
  });

  // The payer already covered their own share, so tick it off immediately.
  const withPayerSettled = bill.shares.some((s) => s.memberId === payer.id)
    ? await repo.setSharePaid(bill.id, payer.id, true)
    : bill;

  const final = withPayerSettled ?? bill;
  return [card(final, `${final.title} — หารกัน ${formatAmount(final.totalMinor)} ${currency}`)];
}

/** Resolve `/pay` with no code to the newest bill the actor still owes on. */
async function billForActor(code: string | null, ctx: Ctx): Promise<repo.BillWithShares | null> {
  if (code) return repo.findBill(ctx.groupId, code);

  const open = await repo.listOpenBills(ctx.groupId);
  const mine = open.filter((b) =>
    b.shares.some((s) => s.memberId === ctx.actor.id && s.paidAt === null),
  );
  return mine.at(-1) ?? (await repo.latestBill(ctx.groupId));
}

async function payOwnShare(code: string | null, ctx: Ctx): Promise<Reply> {
  const bill = await billForActor(code, ctx);
  if (!bill) return [notFound(code ?? '?')];

  const share = bill.shares.find((s) => s.memberId === ctx.actor.id);
  if (!share) {
    return [noticeCard(`${face.cat} ${ctx.actor.displayName} ไม่ได้อยู่ในบิล #${bill.code} นะ`, 'oops')];
  }
  if (share.paidAt) {
    return [noticeCard(`${face.done} บิล #${bill.code} จ่ายไปแล้วนี่นา`, 'oops')];
  }

  const updated = await repo.setSharePaid(bill.id, ctx.actor.id, true);
  if (!updated) return [notFound(bill.code)];

  const headline = updated.settledAt
    ? `${face.party} บิล #${updated.code} ครบแล้ว!`
    : `${face.done} รับทราบ ${ctx.actor.displayName} จ่าย ${formatAmount(share.amountMinor)} ${currency} แล้ว`;
  return [noticeCard(headline), card(updated)];
}

async function markSomeonePaid(
  command: Extract<Command, { kind: 'markPaid' }>,
  ctx: Ctx,
): Promise<Reply> {
  const bill = await repo.findBill(ctx.groupId, command.code);
  if (!bill) return [notFound(command.code)];

  // No name given means the sender is talking about themselves.
  let targetId = ctx.actor.id;
  let targetName = ctx.actor.displayName;

  if (command.name) {
    const members = bill.shares.map((s) => s.member);
    const match = repo.resolveMember(members, command.name);
    if (match === null) {
      return [noticeCard(`${face.cat} "${command.name}" ไม่ได้อยู่ในบิล #${bill.code}`, 'oops')];
    }
    if (match === 'ambiguous') {
      return [noticeCard(`${face.cat} "${command.name}" ตรงกับหลายคน พิมพ์ชื่อให้ยาวขึ้นนะ`, 'oops')];
    }
    targetId = match.id;
    targetName = match.displayName;
  }

  // Only the person who fronted the money gets to tick off other people.
  if (targetId !== ctx.actor.id && bill.payerId !== ctx.actor.id) {
    return [
      noticeCard(
        `${face.cat} มีแต่ ${bill.payer.displayName} (คนที่ออกเงิน) ที่ยืนยันแทนคนอื่นได้นะ`,
        'oops',
      ),
    ];
  }

  const updated = await repo.setSharePaid(bill.id, targetId, command.paid);
  if (!updated) return [notFound(bill.code)];

  const headline = command.paid
    ? `${face.done} ติ๊กให้ ${targetName} แล้ว`
    : `${face.waiting} ยกเลิกการติ๊กของ ${targetName} แล้ว`;
  return [noticeCard(headline), card(updated)];
}

/**
 * Re-post the bill and @-mention whoever still owes, so the reminder actually
 * pings their phone instead of scrolling past.
 */
async function remind(code: string | null, ctx: Ctx): Promise<Reply> {
  const bill = code ? await repo.findBill(ctx.groupId, code) : await repo.latestBill(ctx.groupId);
  if (!bill) return [notFound(code ?? '?')];

  const unpaid = bill.shares.filter((s) => s.paidAt === null);
  if (unpaid.length === 0) {
    return [noticeCard(`${face.party} บิล #${bill.code} เคลียร์หมดแล้ว ไม่ต้องทวง`)];
  }

  const nudge = mentionMessage(
    unpaid.map((s) => ({ member: s.member, amountMinor: s.amountMinor })),
    bill.payer.displayName,
    bill.code,
  );
  return [nudge, card(bill)];
}

/**
 * Build the nudge as a v2 text message, where `{p0}`-style placeholders in the
 * text are swapped for real @-mentions. People who have never spoken in the
 * group have no LINE user id, so they're listed by name without a ping.
 */
function mentionMessage(
  owing: { member: DbMember; amountMinor: number }[],
  payerName: string,
  code: string,
): messagingApi.TextMessageV2 {
  const substitution: Record<string, messagingApi.SubstitutionObject> = {};
  const lines: string[] = [`${face.money} ทวงบิล #${code} หน่อยน้า`];

  owing.forEach(({ member, amountMinor }, i) => {
    const amount = `${formatAmount(amountMinor)} ${config.currency}`;
    if (member.lineUserId) {
      const key = `p${i}`;
      substitution[key] = {
        type: 'mention',
        mentionee: { type: 'user', userId: member.lineUserId },
      };
      lines.push(`{${key}} ${amount}`);
    } else {
      lines.push(`${member.displayName} ${amount}`);
    }
  });

  lines.push('', `โอนให้ ${payerName} แล้วพิมพ์ /pay ${code} ได้เลย ${face.heart}`);

  const message: messagingApi.TextMessageV2 = { type: 'textV2', text: lines.join('\n') };
  if (Object.keys(substitution).length > 0) message.substitution = substitution;
  return message;
}
