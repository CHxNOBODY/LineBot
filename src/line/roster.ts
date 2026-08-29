/**
 * Keeping the member roster in step with the actual chat.
 *
 * LINE only lets *verified* or premium Official Accounts enumerate a chat's
 * members, so this is a best-effort upgrade rather than the primary mechanism:
 * where the API allows it the bot learns everyone the moment it joins, and
 * where it doesn't the bot falls back to the usual trickle of registering
 * people as they speak. Both paths end up in the same `Member` rows.
 */
import * as repo from '../db/repo.js';
import { fetchDisplayName, fetchMemberIds, type SourceId } from './client.js';

/** Each name is its own profile lookup, so don't fire 500 of them at once. */
const CONCURRENCY = 8;

export type RosterSync =
  | { ok: true; total: number; added: number }
  | { ok: false; reason: 'notAGroup' | 'forbidden' | 'failed' };

/**
 * Look up display names for `userIds` and upsert them all as members.
 * Returns how many were people the bot had never seen before.
 */
export async function registerMembers(
  groupId: string,
  source: SourceId,
  userIds: string[],
): Promise<{ total: number; added: number }> {
  const known = await repo.listMembers(groupId);
  const seen = new Set(
    known.map((m) => m.lineUserId).filter((id): id is string => id !== null),
  );

  let added = 0;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    await Promise.all(
      userIds.slice(i, i + CONCURRENCY).map(async (userId) => {
        const displayName = await fetchDisplayName(source, userId);
        await repo.rememberMember(groupId, userId, displayName);
        if (!seen.has(userId)) added++;
      }),
    );
  }

  return { total: userIds.length, added };
}

/** Pull the whole member list from LINE and register everyone in it. */
export async function syncRoster(groupId: string, source: SourceId): Promise<RosterSync> {
  const listed = await fetchMemberIds(source);
  if (!listed.ok) return listed;

  const { total, added } = await registerMembers(groupId, source, listed.ids);
  return { ok: true, total, added };
}
