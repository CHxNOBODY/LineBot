/**
 * Chat command grammar. Everything is optional-friendly: the bot should never
 * make someone remember exact syntax, so most commands have a Thai alias and
 * sensible defaults (no targets = split between everyone).
 */

/** One person named in a `/bill`, optionally pinned to a fixed amount. */
export type Target =
  | { kind: 'everyone' }
  | { kind: 'person'; name: string; fixedRaw: string | null };

export type Command =
  | { kind: 'help' }
  | { kind: 'createBill'; title: string; amountRaw: string; targets: Target[]; payerName: string | null }
  | { kind: 'showBill'; code: string }
  | { kind: 'listBills' }
  | { kind: 'me' }
  | { kind: 'members' }
  | { kind: 'addMember'; name: string }
  | { kind: 'pay'; code: string | null }
  | { kind: 'markPaid'; code: string; name: string | null; paid: boolean }
  | { kind: 'remind'; code: string | null }
  | { kind: 'unknown'; verb: string };

const ALIASES: Record<string, string> = {
  bill: 'bill',
  b: 'bill',
  หาร: 'bill',
  บิล: 'bill',
  bills: 'bills',
  list: 'bills',
  สรุป: 'bills',
  pay: 'pay',
  จ่าย: 'pay',
  จ่ายแล้ว: 'pay',
  paid: 'paid',
  ได้รับ: 'paid',
  unpay: 'unpay',
  ยกเลิก: 'unpay',
  remind: 'remind',
  ทวง: 'remind',
  me: 'me',
  ของฉัน: 'me',
  members: 'members',
  คน: 'members',
  add: 'add',
  เพิ่ม: 'add',
  help: 'help',
  h: 'help',
  ช่วย: 'help',
  วิธีใช้: 'help',
};

const EVERYONE = new Set(['@all', 'all', 'ทุกคน', 'everyone', '@everyone']);

const isCode = (token: string): boolean => /^#?\d{1,4}$/.test(token);
const stripHash = (token: string): string => token.replace(/^#/, '');

/** A bare number, possibly with a decimal part or thousands separators. */
const isAmount = (token: string): boolean => /^฿?\d[\d,]*(\.\d{1,2})?$/.test(token);

/**
 * Returns null when the text isn't addressed to the bot at all, so ordinary
 * group chatter is ignored.
 */
export function parseCommand(rawText: string): Command | null {
  const text = rawText.trim();
  if (!text.startsWith('/')) return null;

  const tokens = text.slice(1).split(/\s+/).filter(Boolean);
  const rawVerb = tokens.shift();
  if (!rawVerb) return null;

  const verb = ALIASES[rawVerb.toLowerCase()];
  if (!verb) return { kind: 'unknown', verb: rawVerb };

  switch (verb) {
    case 'help':
      return { kind: 'help' };
    case 'bills':
      return { kind: 'listBills' };
    case 'me':
      return { kind: 'me' };
    case 'members':
      return { kind: 'members' };

    case 'add': {
      const name = tokens.join(' ').trim();
      return name ? { kind: 'addMember', name } : { kind: 'unknown', verb: rawVerb };
    }

    case 'pay': {
      const code = tokens[0] && isCode(tokens[0]) ? stripHash(tokens[0]) : null;
      return { kind: 'pay', code };
    }

    case 'remind': {
      const code = tokens[0] && isCode(tokens[0]) ? stripHash(tokens[0]) : null;
      return { kind: 'remind', code };
    }

    case 'paid':
    case 'unpay': {
      if (!tokens[0] || !isCode(tokens[0])) return { kind: 'unknown', verb: rawVerb };
      const code = stripHash(tokens[0]);
      const name = tokens.slice(1).join(' ').trim() || null;
      return { kind: 'markPaid', code, name, paid: verb === 'paid' };
    }

    case 'bill':
      return parseBill(tokens);
  }
  return { kind: 'unknown', verb: rawVerb };
}

function parseBill(tokens: string[]): Command {
  if (tokens.length === 0) return { kind: 'help' };

  // `/bill 3` with nothing else means "show me bill #3" — you can't open a
  // bill with no title anyway.
  if (tokens.length === 1 && isCode(tokens[0]!)) {
    return { kind: 'showBill', code: stripHash(tokens[0]!) };
  }

  // The amount is the first bare number; everything before it is the title and
  // everything after names the people splitting it.
  const amountIndex = tokens.findIndex(isAmount);
  if (amountIndex === -1) return { kind: 'unknown', verb: 'bill' };

  const title = tokens.slice(0, amountIndex).join(' ').trim() || 'บิล';
  const amountRaw = tokens[amountIndex]!;
  const rest = tokens.slice(amountIndex + 1);

  const targets: Target[] = [];
  let payerName: string | null = null;

  for (const token of rest) {
    const lower = token.toLowerCase();

    if (EVERYONE.has(lower)) {
      targets.push({ kind: 'everyone' });
      continue;
    }

    const payerMatch = /^(?:by|payer|จ่ายโดย)[=:](.+)$/i.exec(token);
    if (payerMatch) {
      payerName = payerMatch[1]!;
      continue;
    }

    const fixedMatch = /^(.+?)[=:](.+)$/.exec(token);
    if (fixedMatch) {
      targets.push({ kind: 'person', name: fixedMatch[1]!, fixedRaw: fixedMatch[2]! });
      continue;
    }

    targets.push({ kind: 'person', name: token.replace(/^@/, ''), fixedRaw: null });
  }

  return { kind: 'createBill', title, amountRaw, targets, payerName };
}
