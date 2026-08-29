/**
 * Chat command grammar. Everything is optional-friendly: the bot should never
 * make someone remember exact syntax, so most commands have a Thai alias and
 * sensible defaults (no targets = split between everyone).
 */

/** One person named in a `/bill`, optionally pinned to a fixed amount. */
export type Target =
  | { kind: 'everyone' }
  | {
      kind: 'person';
      name: string;
      fixedRaw: string | null;
      /** Set when the person was tagged with a real @-mention. */
      userId: string | null;
    };

/**
 * A LINE @-mention, as character offsets into the raw message text.
 *
 * Kept as a plain structural type so this module stays free of SDK imports and
 * unit-testable without a webhook.
 */
export type Mention = {
  index: number;
  length: number;
  /** Absent unless the person lets the bot see their profile. */
  userId?: string;
  /** True for an @All mention, which means the whole group. */
  everyone?: boolean;
};

/**
 * Who a `/paid` is about. Typed commands can only name someone, but the tick
 * chips on the bill card already know the exact member, so they skip the
 * name-matching guesswork entirely.
 */
export type PaidTarget =
  | { kind: 'name'; name: string }
  | { kind: 'member'; id: string };

export type Command =
  | { kind: 'help' }
  | { kind: 'createBill'; title: string; amountRaw: string; targets: Target[]; payerName: string | null }
  | { kind: 'showBill'; code: string }
  | { kind: 'listBills' }
  | { kind: 'me' }
  | { kind: 'members' }
  | { kind: 'syncMembers' }
  | { kind: 'registerSelf' }
  | { kind: 'addMember'; name: string }
  | { kind: 'pay'; code: string | null }
  | { kind: 'markPaid'; code: string; target: PaidTarget | null; paid: boolean }
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
  join: 'join',
  ลงชื่อ: 'join',
  มาแล้ว: 'join',
  sync: 'sync',
  ซิงค์: 'sync',
  ดึงรายชื่อ: 'sync',
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

/** A word plus where it started, so mentions can be matched back onto it. */
type Token = { text: string; start: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    tokens.push({ text: match[0], start: match.index });
  }
  return tokens;
}

/** The mention covering this token, if any — LINE gives offsets, not words. */
function mentionAt(token: Token, mentions: Mention[]): Mention | undefined {
  const end = token.start + token.text.length;
  return mentions.find((m) => m.index < end && m.index + m.length > token.start);
}

/**
 * Returns null when the text isn't addressed to the bot at all, so ordinary
 * group chatter is ignored.
 *
 * `mentions` come off the LINE event and are matched to tokens by character
 * offset, so tagging someone resolves to their user id rather than to whatever
 * their display name happens to be today.
 */
export function parseCommand(rawText: string, mentions: Mention[] = []): Command | null {
  if (!rawText.trim().startsWith('/')) return null;

  // Tokenised over the raw text, not the trimmed text, so token offsets line
  // up with the offsets LINE reports for mentions.
  const tokens = tokenize(rawText);
  const verbToken = tokens.shift();
  if (!verbToken) return null;

  const rawVerb = verbToken.text.slice(1);
  if (!rawVerb) return null;

  const words = tokens.map((t) => t.text);
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
    case 'sync':
      return { kind: 'syncMembers' };
    case 'join':
      return { kind: 'registerSelf' };

    case 'add': {
      const name = words.join(' ').trim();
      return name ? { kind: 'addMember', name } : { kind: 'unknown', verb: rawVerb };
    }

    case 'pay': {
      const code = words[0] && isCode(words[0]) ? stripHash(words[0]) : null;
      return { kind: 'pay', code };
    }

    case 'remind': {
      const code = words[0] && isCode(words[0]) ? stripHash(words[0]) : null;
      return { kind: 'remind', code };
    }

    case 'paid':
    case 'unpay': {
      if (!words[0] || !isCode(words[0])) return { kind: 'unknown', verb: rawVerb };
      const code = stripHash(words[0]);
      const name = words.slice(1).join(' ').trim();
      return {
        kind: 'markPaid',
        code,
        target: name ? { kind: 'name', name } : null,
        paid: verb === 'paid',
      };
    }

    case 'bill':
      return parseBill(tokens, mentions);
  }
  return { kind: 'unknown', verb: rawVerb };
}

/**
 * A person in a bill. A tagged one carries the LINE user id straight off the
 * mention, which beats matching a display name full of emoji; `name` stays as
 * the fallback for plain typed text.
 */
function person(raw: string, fixedRaw: string | null, mention?: Mention): Target {
  return {
    kind: 'person',
    name: raw.replace(/^@/, ''),
    fixedRaw,
    userId: mention?.userId ?? null,
  };
}

function parseBill(tokens: Token[], mentions: Mention[]): Command {
  if (tokens.length === 0) return { kind: 'help' };

  // `/bill 3` with nothing else means "show me bill #3" — you can't open a
  // bill with no title anyway.
  if (tokens.length === 1 && isCode(tokens[0]!.text)) {
    return { kind: 'showBill', code: stripHash(tokens[0]!.text) };
  }

  // The amount is the first bare number; everything before it is the title and
  // everything after names the people splitting it.
  const amountIndex = tokens.findIndex((t) => isAmount(t.text));
  if (amountIndex === -1) return { kind: 'unknown', verb: 'bill' };

  const title =
    tokens
      .slice(0, amountIndex)
      .map((t) => t.text)
      .join(' ')
      .trim() || 'บิล';
  const amountRaw = tokens[amountIndex]!.text;
  const rest = tokens.slice(amountIndex + 1);

  const targets: Target[] = [];
  let payerName: string | null = null;

  /** The person a following amount would pin, if the last token named one. */
  const pinnable = (): Extract<Target, { kind: 'person' }> | null => {
    const last = targets.at(-1);
    return last && last.kind === 'person' && last.fixedRaw === null ? last : null;
  };

  for (const token of rest) {
    const word = token.text;
    const mention = mentionAt(token, mentions);

    if (mention?.everyone || EVERYONE.has(word.toLowerCase())) {
      targets.push({ kind: 'everyone' });
      continue;
    }

    const payerMatch = /^(?:by|payer|จ่ายโดย)[=:](.+)$/i.exec(word);
    if (payerMatch) {
      payerName = payerMatch[1]!;
      continue;
    }

    const waiting = pinnable();

    // "@august 6000" — an amount straight after a person pins their share.
    // This is the easy form; everything below is the older "=" spelling of the
    // same thing, kept working because people have it in their muscle memory.
    if (waiting && isAmount(word)) {
      waiting.fixedRaw = word;
      continue;
    }

    // "@august =6000", where the "=" drifted onto its own token.
    const detached = /^[=:](.+)$/.exec(word);
    if (waiting && detached) {
      waiting.fixedRaw = detached[1]!;
      continue;
    }

    // "@august= 6000", where the amount is the next token instead.
    const dangling = /^(.+?)[=:]$/.exec(word);
    if (dangling) {
      targets.push(person(dangling[1]!, null, mention));
      continue;
    }

    const fixedMatch = /^(.+?)[=:](.+)$/.exec(word);
    if (fixedMatch) {
      targets.push(person(fixedMatch[1]!, fixedMatch[2]!, mention));
      continue;
    }

    targets.push(person(word, null, mention));
  }

  return { kind: 'createBill', title, amountRaw, targets, payerName };
}
