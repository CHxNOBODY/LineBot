import type { Bill, Member, Share } from '@prisma/client';
import { prisma } from './client.js';

export type BillWithShares = Bill & {
  payer: Member;
  shares: (Share & { member: Member })[];
};

const billInclude = {
  payer: true,
  shares: { include: { member: true }, orderBy: { amountMinor: 'desc' } },
} as const;

export async function getOrCreateGroup(lineId: string) {
  return prisma.group.upsert({
    where: { lineId },
    update: {},
    create: { lineId },
  });
}

/**
 * Record that we've seen this person. Display names change over time, so an
 * existing member is updated rather than duplicated.
 */
export async function rememberMember(
  groupId: string,
  lineUserId: string,
  displayName: string,
): Promise<Member> {
  return prisma.member.upsert({
    where: { groupId_lineUserId: { groupId, lineUserId } },
    update: { displayName },
    create: { groupId, lineUserId, displayName },
  });
}

/** Add someone the bot has never seen talk, by name only. */
export async function addMemberByName(groupId: string, displayName: string): Promise<Member> {
  return prisma.member.create({ data: { groupId, displayName } });
}

export async function listMembers(groupId: string): Promise<Member[]> {
  return prisma.member.findMany({ where: { groupId }, orderBy: { displayName: 'asc' } });
}

/**
 * Resolve a name typed in chat to a member. Matches exactly first, then falls
 * back to a case-insensitive prefix match so "/pay mint" finds "Mint 🌱".
 * Returns `'ambiguous'` when a prefix matches more than one person.
 */
export function resolveMember(members: Member[], query: string): Member | 'ambiguous' | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exact = members.filter((m) => m.displayName.toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return 'ambiguous';

  const prefix = members.filter((m) => m.displayName.toLowerCase().startsWith(needle));
  if (prefix.length === 1) return prefix[0]!;
  if (prefix.length > 1) return 'ambiguous';

  const contains = members.filter((m) => m.displayName.toLowerCase().includes(needle));
  if (contains.length === 1) return contains[0]!;
  if (contains.length > 1) return 'ambiguous';

  return null;
}

export async function createBill(params: {
  groupId: string;
  title: string;
  totalMinor: number;
  payerId: string;
  note?: string;
  shares: { memberId: string; amountMinor: number }[];
}): Promise<BillWithShares> {
  // Codes are short so people can type `/pay 7`. Retry on the unique
  // constraint in case two bills are created in the same instant.
  for (let attempt = 0; attempt < 5; attempt++) {
    const used = await prisma.bill.count({ where: { groupId: params.groupId } });
    const code = String(used + 1 + attempt);
    try {
      return await prisma.bill.create({
        data: {
          groupId: params.groupId,
          code,
          title: params.title,
          totalMinor: params.totalMinor,
          payerId: params.payerId,
          note: params.note ?? null,
          shares: { create: params.shares },
        },
        include: billInclude,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('could not allocate a bill code');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002';
}

export async function findBill(groupId: string, code: string): Promise<BillWithShares | null> {
  return prisma.bill.findUnique({
    where: { groupId_code: { groupId, code } },
    include: billInclude,
  });
}

export async function latestBill(groupId: string): Promise<BillWithShares | null> {
  return prisma.bill.findFirst({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
    include: billInclude,
  });
}

export async function listOpenBills(groupId: string): Promise<BillWithShares[]> {
  return prisma.bill.findMany({
    where: { groupId, settledAt: null },
    orderBy: { createdAt: 'asc' },
    include: billInclude,
  });
}

/**
 * Mark one person's share paid (or unpaid). Settles the whole bill once every
 * share is in, so it drops off `/bills`.
 */
export async function setSharePaid(
  billId: string,
  memberId: string,
  paid: boolean,
): Promise<BillWithShares | null> {
  const share = await prisma.share.findUnique({ where: { billId_memberId: { billId, memberId } } });
  if (!share) return null;

  await prisma.share.update({
    where: { id: share.id },
    data: { paidAt: paid ? new Date() : null },
  });

  const remaining = await prisma.share.count({ where: { billId, paidAt: null } });
  await prisma.bill.update({
    where: { id: billId },
    data: { settledAt: remaining === 0 ? new Date() : null },
  });

  return prisma.bill.findUnique({ where: { id: billId }, include: billInclude });
}

export type Debt = { from: Member; to: Member; amountMinor: number };

/** Everything still owed in the group, as (debtor -> payer) totals. */
export async function outstandingDebts(groupId: string): Promise<Debt[]> {
  const bills = await listOpenBills(groupId);
  const totals = new Map<string, Debt>();

  for (const bill of bills) {
    for (const share of bill.shares) {
      if (share.paidAt) continue;
      if (share.memberId === bill.payerId) continue; // nobody owes themselves
      const key = `${share.memberId}->${bill.payerId}`;
      const existing = totals.get(key);
      if (existing) {
        existing.amountMinor += share.amountMinor;
      } else {
        totals.set(key, { from: share.member, to: bill.payer, amountMinor: share.amountMinor });
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}
