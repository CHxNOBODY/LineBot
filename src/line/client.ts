import { messagingApi } from '@line/bot-sdk';
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
