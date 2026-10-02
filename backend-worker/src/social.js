/* Friends and "visible in search" — per account, so they live in their own
   tables (schema.sql: player_settings, friendships) rather than the shared
   state that any phone can overwrite. Every route needs a signed-in account
   and only ever changes the requester's own rows.
     GET  /api/me/social             { searchable, friends, cooldowns }
     PUT  /api/me/social             { searchable } — show me on the Players tab
     POST /api/friends/:id           add a friend
     POST /api/friends/:id/remove    unfriend (can't re-add them for 24 hours)
   Friendship is one-way: adding someone puts them in your list, not you in
   theirs. A new 1:1 chat is only accepted between friends (enforceFriendDms,
   applied by PUT /api/state). */
import { json, err, readJson } from './util.js';
import { requesterId } from './state.js';

export const REFRIEND_WAIT_MS = 24 * 60 * 60 * 1000;

async function socialOf(db, me, now = Date.now()) {
  const [settings, rows] = await db.batch([
    db.prepare('SELECT searchable FROM player_settings WHERE playerId = ?').bind(me),
    db.prepare('SELECT friendId, addedAt, removedAt FROM friendships WHERE playerId = ?').bind(me),
  ]);
  const s = settings.results[0];
  return {
    searchable: !!(s && s.searchable),
    friends: rows.results.filter(r => r.removedAt == null).map(r => ({ id: r.friendId, addedAt: r.addedAt })),
    // Unfriended less than 24 hours ago: `until` is when they can be added again.
    cooldowns: rows.results
      .filter(r => r.removedAt != null && now < r.removedAt + REFRIEND_WAIT_MS)
      .map(r => ({ id: r.friendId, until: r.removedAt + REFRIEND_WAIT_MS })),
  };
}

/* The requester, if signed in to an account that still exists. */
async function accountId(request, db) {
  const id = await requesterId(request, db);
  if (!id) return null;
  const row = await db.prepare('SELECT id FROM players WHERE id = ? AND email IS NOT NULL').bind(id).first();
  return row ? id : null;
}

/* My friends that are still friends, for the DM check in PUT /api/state. */
export async function activeFriendIds(db, me) {
  if (!me) return new Set();
  const rows = (await db.prepare('SELECT friendId FROM friendships WHERE playerId = ? AND removedAt IS NULL').bind(me).all()).results;
  return new Set(rows.map(r => r.friendId));
}

export async function getSocial(request, env) {
  const me = await accountId(request, env.DB);
  if (!me) return err(401, 'Log in to see your friends.');
  return json(await socialOf(env.DB, me));
}

export async function putSocial(request, env) {
  const db = env.DB;
  const me = await accountId(request, db);
  if (!me) return err(401, 'Log in to change your profile.');
  const body = await readJson(request);
  if (!body || typeof body.searchable !== 'boolean') return err(400, '"searchable" must be true or false.');
  await db.prepare(`INSERT INTO player_settings (playerId, searchable) VALUES (?, ?)
    ON CONFLICT(playerId) DO UPDATE SET searchable = excluded.searchable`).bind(me, body.searchable ? 1 : 0).run();
  return json(await socialOf(db, me));
}

export async function addFriend(request, env, { id }) {
  const db = env.DB;
  const me = await accountId(request, db);
  if (!me) return err(401, 'Log in to add friends.');
  if (id === me) return err(400, "You can't add yourself as a friend.");
  const target = await db.prepare('SELECT id, name FROM players WHERE id = ? AND email IS NOT NULL').bind(id).first();
  if (!target) return err(404, 'That player has no account.');
  const now = Date.now();
  const row = await db.prepare('SELECT removedAt FROM friendships WHERE playerId = ? AND friendId = ?').bind(me, id).first();
  if (row && row.removedAt == null) return json(await socialOf(db, me, now)); // already friends
  if (row && now < row.removedAt + REFRIEND_WAIT_MS) {
    return err(429, `You unfriended ${target.name} less than 24 hours ago — you can add them again after that.`);
  }
  await db.prepare(`INSERT INTO friendships (playerId, friendId, addedAt, removedAt) VALUES (?, ?, ?, NULL)
    ON CONFLICT(playerId, friendId) DO UPDATE SET addedAt = excluded.addedAt, removedAt = NULL`).bind(me, id, now).run();
  return json(await socialOf(db, me, now));
}

export async function removeFriend(request, env, { id }) {
  const db = env.DB;
  const me = await accountId(request, db);
  if (!me) return err(401, 'Log in to change your friends.');
  const now = Date.now();
  await db.prepare('UPDATE friendships SET removedAt = ? WHERE playerId = ? AND friendId = ? AND removedAt IS NULL').bind(now, me, id).run();
  return json(await socialOf(db, me, now));
}

/* A 1:1 chat the server hasn't stored yet is only accepted from one of its
   two people, and only if the other is their friend. Chats already stored,
   and group chats, pass through unchanged. */
export function enforceFriendDms(incoming, storedIds, requester, friendIds) {
  return incoming.filter(c => {
    if (!c || c.type !== 'dm' || storedIds.has(c.id)) return true;
    const ids = c.participantIds || [];
    if (!requester || !ids.includes(requester)) return false;
    const other = ids.find(x => x !== requester);
    return !!other && friendIds.has(other);
  });
}
