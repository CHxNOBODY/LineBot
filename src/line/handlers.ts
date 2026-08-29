import type { WebhookEvent, messagingApi } from '@line/bot-sdk';
import { execute, type Ctx } from '../commands/execute.js';
import { parseCommand, type Command, type Mention } from '../commands/parse.js';
import * as repo from '../db/repo.js';
import { fetchDisplayName, lineClient, sourceOf } from './client.js';
import { helpCard, noticeCard } from './flex/cards.js';
import { face } from './flex/theme.js';
import { registerMembers, syncRoster } from './roster.js';

/** LINE caps a single reply at five messages. */
const MAX_REPLY = 5;

export async function handleEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'message':
      if (event.message.type === 'text') await onText(event.replyToken, event, event.message);
      return;
    case 'postback':
      await onPostback(event);
      return;
    case 'join':
      await onJoin(event);
      return;
    case 'follow':
      await reply(event.replyToken, [helpCard()]);
      return;
    case 'memberJoined':
      await onMemberJoined(event);
      return;
    default:
      return;
  }
}

async function reply(replyToken: string, messages: messagingApi.Message[]): Promise<void> {
  if (messages.length === 0) return;
  await lineClient.replyMessage({ replyToken, messages: messages.slice(0, MAX_REPLY) });
}

/**
 * Every command needs to know which group it's in and who's talking, and both
 * are worth recording even when the message isn't a command — that's how the
 * bot learns who's in the group.
 */
async function buildCtx(event: {
  source: { type: string; userId?: string; groupId?: string; roomId?: string };
}): Promise<Ctx | null> {
  const source = sourceOf(event.source);
  const userId = event.source.userId;
  if (!source || !userId) return null;

  const group = await repo.getOrCreateGroup(source.lineId);
  const displayName = await fetchDisplayName(source, userId);
  const actor = await repo.rememberMember(group.id, userId, displayName);

  return { groupId: group.id, actor, source };
}

/**
 * The bot was just added to a chat. A verified account can pull the whole
 * roster right here; an unverified one starts empty and has to be told so,
 * otherwise `/bill ... @all` silently splits between nobody.
 */
async function onJoin(event: Extract<WebhookEvent, { type: 'join' }>): Promise<void> {
  const source = sourceOf(event.source);
  if (!source) {
    await reply(event.replyToken, [helpCard()]);
    return;
  }

  const group = await repo.getOrCreateGroup(source.lineId);
  const synced = await syncRoster(group.id, source);

  const intro = synced.ok
    ? noticeCard(`${face.wave} หวัดดี! รู้จักทุกคนในกลุ่มแล้ว ${synced.total} คน`)
    : noticeCard(`${face.wave} หวัดดี! ให้ทุกคนพิมพ์อะไรสักครั้ง บอทจะได้รู้จักนะ`);

  await reply(event.replyToken, [intro, helpCard()]);
}

/** Someone joined a chat the bot is already in — register them on the spot. */
async function onMemberJoined(
  event: Extract<WebhookEvent, { type: 'memberJoined' }>,
): Promise<void> {
  const source = sourceOf(event.source);
  if (!source) return;

  const group = await repo.getOrCreateGroup(source.lineId);
  const userIds = event.joined.members
    .map((m) => m.userId)
    .filter((id): id is string => typeof id === 'string');

  const { added } = await registerMembers(group.id, source, userIds);

  const messages: messagingApi.Message[] = [];
  if (added > 0) {
    messages.push(noticeCard(`${face.wave} ยินดีต้อนรับ! เพิ่ม ${added} คนเข้ารายชื่อแล้ว`));
  }
  messages.push(helpCard());
  await reply(event.replyToken, messages);
}

/** Just the parts of a text message this module needs. */
type TextMessage = {
  text: string;
  mention?: {
    mentionees: Array<{
      type: string;
      index: number;
      length: number;
      userId?: string;
      isSelf?: boolean;
    }>;
  };
};

/**
 * LINE reports mentions as offsets into the text plus a user id, where the
 * person allows the bot to see their profile. Mentions of the bot itself are
 * dropped: tagging the bot addresses it, it doesn't make the bot owe money.
 */
function mentionsOf(message: TextMessage): Mention[] {
  return (message.mention?.mentionees ?? [])
    .filter((m) => !m.isSelf)
    .map((m) => ({
      index: m.index,
      length: m.length,
      userId: m.userId,
      everyone: m.type === 'all',
    }));
}

async function onText(
  replyToken: string,
  event: Parameters<typeof buildCtx>[0],
  message: TextMessage,
) {
  const command = parseCommand(message.text, mentionsOf(message));
  // Still build the context for non-commands: seeing someone chat is how we
  // learn they exist, which `/bill ... @all` depends on.
  const ctx = await buildCtx(event);
  if (!ctx || !command) return;

  await reply(replyToken, await execute(command, ctx));
}

/** Postback payloads come from the buttons on the bill card. */
function commandFromPostback(data: string): Command | null {
  const params = new URLSearchParams(data);
  const action = params.get('action');
  if (!action) return null;

  // The roster button is the one action that isn't about a particular bill.
  if (action === 'join') return { kind: 'registerSelf' };

  const code = params.get('bill');
  if (!code) return null;

  switch (action) {
    case 'pay':
      return { kind: 'pay', code };
    case 'remind':
      return { kind: 'remind', code };
    case 'show':
      return { kind: 'showBill', code };
    case 'tick': {
      // The per-person chips on the bill card. execute() still enforces that
      // only the payer may tick someone other than themselves.
      const memberId = params.get('member');
      if (!memberId) return null;
      return { kind: 'markPaid', code, target: { kind: 'member', id: memberId }, paid: true };
    }
    default:
      return null;
  }
}

async function onPostback(event: Extract<WebhookEvent, { type: 'postback' }>) {
  const command = commandFromPostback(event.postback.data);
  if (!command) return;

  const ctx = await buildCtx(event);
  if (!ctx) return;

  await reply(event.replyToken, await execute(command, ctx));
}

export const greeting = `${face.wave} หวัดดี! เราคือบอทหารบิล พิมพ์ /help เพื่อดูวิธีใช้`;
