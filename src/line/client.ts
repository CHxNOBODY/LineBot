import { HTTPFetchError, messagingApi } from '@line/bot-sdk';
import { config } from '../config.js';

export const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

/** Where a message came from: a group, a multi-person room, or a 1:1 chat. */
export type SourceId = { lineId: string; kind: 'group' | 'room' | 'user' };

export function sourceOf(source: {
  type: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}): SourceId | null {
  if (source.type === 'group' && source.groupId) return { lineId: source.groupId, kind: 'group' };
  if (source.type === 'room' && source.roomId) return { lineId: source.roomId, kind: 'room' };
  if (source.type === 'user' && source.userId) return { lineId: source.userId, kind: 'user' };
  return null;
}

/** Whether LINE will hand over the chat's member list, and why not if it won't. */
export type MemberIds =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'notAGroup' | 'forbidden' | 'failed' };

/**
 * Page through every member id in a group or room.
 *
 * `getGroupMembersIds` is gated on the Official Account being verified or
 * premium. An ordinary account gets a 403 here, which is the expected answer
 * rather than an exceptional one — callers treat it as "fall back to learning
 * people as they speak", not as an error worth shouting about.
 */
export async function fetchMemberIds(source: SourceId): Promise<MemberIds> {
  if (source.kind === 'user') return { ok: false, reason: 'notAGroup' };

  const ids: string[] = [];
  let start: string | undefined;

  try {
    do {
      const page =
        source.kind === 'group'
          ? await lineClient.getGroupMembersIds(source.lineId, start)
          : await lineClient.getRoomMembersIds(source.lineId, start);
      ids.push(...page.memberIds);
      start = page.next;
    } while (start);
  } catch (err) {
    if (err instanceof HTTPFetchError && err.status === 403) {
      return { ok: false, reason: 'forbidden' };
    }
    console.error('member list lookup failed', err);
    return { ok: false, reason: 'failed' };
  }

  return { ok: true, ids };
}

/**
 * Display names live on LINE, not in our database. Falls back to a placeholder
 * when the user has blocked the bot or hidden their profile.
 */
export async function fetchDisplayName(source: SourceId, userId: string): Promise<string> {
  try {
    if (source.kind === 'group') {
      const p = await lineClient.getGroupMemberProfile(source.lineId, userId);
      return p.displayName;
    }
    if (source.kind === 'room') {
      const p = await lineClient.getRoomMemberProfile(source.lineId, userId);
      return p.displayName;
    }
    const p = await lineClient.getProfile(userId);
    return p.displayName;
  } catch {
    return 'เพื่อนนิรนาม';
  }
}
