import type { messagingApi } from '@line/bot-sdk';
import type { Member as DbMember } from '@prisma/client';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import type { SourceId } from '../line/client.js';
import { billCard } from '../line/flex/billCard.js';
import { helpCard, noticeCard, personalCard, summaryCard } from '../line/flex/cards.js';
import { face } from '../line/flex/theme.js';
import { registerMembers, syncRoster } from '../line/roster.js';
import { formatAmount, parseAmount, splitWithFixed } from '../utils/money.js';
import type { Command, Target } from './parse.js';

export type Ctx = {
  /** Our Group row id, not the LINE id. */
  groupId: string;
  /** The person who typed the command. */
  actor: DbMember;
  /** The LINE-side chat, for the API calls that need its id rather than ours. */
  source: SourceId;
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

    case 'syncMembers':
      return syncMembers(ctx);

    case 'registerSelf':
      return registerSelf(ctx);

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
    return noticeCard(
      `${face.wave} ยังไม่รู้จักใครเลย แตะปุ่มข้างล่างเพื่อลงชื่อได้เลย`,
      'oops',
      true,
    );
  }
  const list = members.map((m, i) => `${i + 1}. ${m.displayName}`).join('\n');
  return noticeCard(`${face.cat} คนที่บอทรู้จัก (${members.length})\n${list}`);
}

/**
 * The tap-to-register button, and `/join`.
 *
 * `buildCtx` has already upserted whoever tapped — that's the whole point of
 * building a `Ctx` for every event — so there is nothing left to write here.
 * This just confirms it and hands back the roster so the group can see itself
 * filling up.
 */
async function registerSelf(ctx: Ctx): Promise<Reply> {
  const members = await repo.listMembers(ctx.groupId);
  const list = members.map((m, i) => `${i + 1}. ${m.displayName}`).join('\n');
  return [
    noticeCard(
      `${face.sparkle} รู้จัก ${ctx.actor.displayName} แล้ว!\n\n` +
        `${face.cat} ตอนนี้มี ${members.length} คน\n${list}`,
    ),
  ];
}

/**
 * Ask LINE for the entire member list. Only verified accounts may, so the
 * refusal path has to actually explain itself — "error" would send someone
 * hunting through their own code for a bug that isn't there.
 */
async function syncMembers(ctx: Ctx): Promise<Reply> {
  const result = await syncRoster(ctx.groupId, ctx.source);

  if (!result.ok) {
    if (result.reason === 'notAGroup') {
      return [noticeCard(`${face.cat} คำสั่งนี้ใช้ได้ในกลุ่มเท่านั้นนะ`, 'oops')];
    }
    if (result.reason === 'forbidden') {
      return [
        noticeCard(
          `${face.cat} LINE ไม่ให้ดึงรายชื่อสมาชิก เพราะบัญชีบอทยังไม่ได้ยืนยัน (verified)\n\n` +
            `ให้ทุกคนพิมพ์อะไรสักครั้งในกลุ่ม หรือใช้ /add ชื่อ เพิ่มเองก็ได้นะ`,
          'oops',
        ),
      ];
    }
    return [noticeCard(`${face.cat} ดึงรายชื่อไม่สำเร็จ ลองใหม่อีกทีนะ`, 'oops')];
  }

  const headline =
    result.added === 0
      ? `${face.done} รู้จักครบทั้ง ${result.total} คนอยู่แล้ว`
      : `${face.sparkle} เจอเพิ่ม ${result.added} คน (ทั้งหมด ${result.total} คน)`;
  return [noticeCard(headline), await membersReply(ctx)];
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
  let known = await repo.listMembers(ctx.groupId);

  // Someone tagged with a real @-mention may not be on the roster yet. Their
  // user id is right there in the mention, so add them rather than rejecting
  // the bill and making them go say hello first.
  const tagged = targets.flatMap((t) => (t.kind === 'person' && t.userId ? [t.userId] : []));
  const missing = tagged.filter((id) => !known.some((m) => m.lineUserId === id));
  if (missing.length > 0) {
    await registerMembers(ctx.groupId, ctx.source, missing);
    known = await repo.listMembers(ctx.groupId);
  }

  const wantsEveryone = targets.length === 0 || targets.some((t) => t.kind === 'everyone');
  if (wantsEveryone) {
    if (known.length === 0) return 'ยังไม่รู้จักใครในกลุ่มเลย ให้ทุกคนพิมพ์อะไรสักครั้งก่อนนะ';
    return { members: known, fixed: known.map(() => null) };
  }

  const members: DbMember[] = [];
  const fixed: (number | null)[] = [];

  for (const target of targets) {
    if (target.kind !== 'person') continue;

    // A tag is unambiguous; a typed name has to be matched and might not be.
    const match = target.userId
      ? (known.find((m) => m.lineUserId === target.userId) ?? null)
      : repo.resolveMember(known, target.name);
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

  // "/bill บุฟเฟ่ 8000 @august 6000" names one person and pins them, which
  // leaves 2000 unaccounted for. The payer fronted the whole 8000, so the
  // remainder is theirs — that's what someone means by typing this, and the
  // alternative is rejecting the most natural way to write a bill.
  const everyoneIsPinned = resolved.fixed.every((amount) => amount !== null);
  const pinnedSum = resolved.fixed.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  if (
    everyoneIsPinned &&
    pinnedSum < totalMinor &&
    !resolved.members.some((m) => m.id === payer.id)
  ) {
    resolved.members.push(payer);
    resolved.fixed.push(null);
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

/**
 * "I paid." Everyone except the person owed has to be confirmed: a claim is
 * one tap from someone with an obvious interest in the answer, so it waits for
 * the payer rather than moving the bill on its own. The payer ticking their own
 * share has nobody to answer to, so that goes straight through.
 */
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

  if (bill.payerId === ctx.actor.id) {
    const updated = await repo.setSharePaid(bill.id, ctx.actor.id, true);
    if (!updated) return [notFound(bill.code)];
    const headline = updated.settledAt
      ? `${face.party} บิล #${updated.code} ครบแล้ว!`
      : `${face.done} รับทราบ ${ctx.actor.displayName} จ่าย ${formatAmount(share.amountMinor)} ${currency} แล้ว`;
    return [noticeCard(headline), card(updated)];
  }

  if (share.claimedAt) {
    return [
      noticeCard(
        `${face.pending} บอกไปแล้วนะ กำลังรอ ${bill.payer.displayName} ยืนยันอยู่`,
        'oops',
      ),
    ];
  }

  const updated = await repo.setShareClaimed(bill.id, ctx.actor.id, true);
  if (!updated) return [notFound(bill.code)];

  return [
    noticeCard(
      `${face.pending} บอก ${bill.payer.displayName} แล้วว่า ${ctx.actor.displayName} ` +
        `จ่าย ${formatAmount(share.amountMinor)} ${currency} แล้ว\n\n` +
        `รอกดยืนยันสักครู่นะ ${face.heart}`,
    ),
    card(updated, `${ctx.actor.displayName} แจ้งว่าจ่ายบิล #${bill.code} แล้ว`),
  ];
}

async function markSomeonePaid(
  command: Extract<Command, { kind: 'markPaid' }>,
  ctx: Ctx,
): Promise<Reply> {
  const bill = await repo.findBill(ctx.groupId, command.code);
  if (!bill) return [notFound(command.code)];

  // No target means the sender is talking about themselves.
  const target = command.target;
  let targetId = ctx.actor.id;
  let targetName = ctx.actor.displayName;

  if (target) {
    const members = bill.shares.map((s) => s.member);
    const label = target.kind === 'name' ? `"${target.name}"` : 'คนนั้น';

    // A card carries the member id, so it needs no name matching — but the
    // card may have been posted before the bill changed under it.
    const match =
      target.kind === 'member'
        ? (members.find((m) => m.id === target.id) ?? null)
        : repo.resolveMember(members, target.name);

    if (match === null) {
      return [noticeCard(`${face.cat} ${label} ไม่ได้อยู่ในบิล #${bill.code}`, 'oops')];
    }
    if (match === 'ambiguous') {
      return [noticeCard(`${face.cat} ${label} ตรงกับหลายคน พิมพ์ชื่อให้ยาวขึ้นนะ`, 'oops')];
    }
    targetId = match.id;
    targetName = match.displayName;
  }

  // Ticking your own row is a claim, never a confirmation — otherwise anyone
  // could tap the ยืนยัน chip on their own line and settle their own debt,
  // which is the exact thing the payer is supposed to be checking.
  if (command.paid && targetId === ctx.actor.id && bill.payerId !== ctx.actor.id) {
    return payOwnShare(bill.code, ctx);
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

  const wasClaimed = bill.shares.some((s) => s.memberId === targetId && s.claimedAt !== null);
  const headline = command.paid
    ? `${face.done} ${wasClaimed ? 'ยืนยันแล้ว' : 'ติ๊กให้'} ${targetName} ${wasClaimed ? 'ว่าจ่ายแล้ว' : 'แล้ว'}`
    : `${face.waiting} ${wasClaimed ? 'ยังไม่ได้รับเงินจาก' : 'ยกเลิกการติ๊กของ'} ${targetName}`;
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
