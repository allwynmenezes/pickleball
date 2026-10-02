/* Friends, friend requests, notifications and "visible in search" — per
   account, so they live in their own tables (schema.sql) rather than the
   shared state that any phone can overwrite. Every route needs a signed-in
   account and only acts for the requester.
     GET  /api/me/social                  everything below, for the requester
     PUT  /api/me/social                  { searchable } — listed on the Players tab (on by default)
     POST /api/friends/:id                send a friend request (accepts theirs if they asked first)
     POST /api/friends/:id/accept         accept their request — you're now each other's friends
     POST /api/friends/:id/decline        decline it — they can't ask again for 24 hours
     POST /api/friends/:id/remove         unfriend — you can't ask them again for 24 hours
     POST /api/notifications/:id/dismiss  clear an "accepted" / "declined" notice
   Friendship is mutual: a row each way in `friendships`. A new chat is
   checked by enforceNewChats (applied by PUT /api/state): 1:1 and group
   chats only with friends; an event's group chat only by its players. */
import { json, err, readJson, randomToken } from './util.js';
import { requesterId } from './state.js';

export const WAIT_MS = 24 * 60 * 60 * 1000;

async function socialOf(db, me, now = Date.now()) {
  const [settings, friends, incoming, outgoing, waits, notes] = await db.batch([
    db.prepare('SELECT searchable FROM player_settings WHERE playerId = ?').bind(me),
    db.prepare('SELECT friendId, addedAt FROM friendships WHERE playerId = ? AND removedAt IS NULL').bind(me),
    db.prepare("SELECT fromId, createdAt FROM friend_requests WHERE toId = ? AND status = 'pending' ORDER BY createdAt DESC").bind(me),
    db.prepare("SELECT toId FROM friend_requests WHERE fromId = ? AND status = 'pending'").bind(me),
    db.prepare('SELECT otherId, until FROM friend_waits WHERE playerId = ? AND until > ?').bind(me, now),
    db.prepare('SELECT id, type, otherId, createdAt FROM notifications WHERE playerId = ? AND dismissedAt IS NULL ORDER BY createdAt DESC LIMIT 50').bind(me),
  ]);
  const s = settings.results[0];
  return {
    searchable: s ? !!s.searchable : true,
    friends: friends.results.map(r => ({ id: r.friendId, since: r.addedAt })),
    incoming: incoming.results.map(r => ({ id: r.fromId, at: r.createdAt })),
    outgoing: outgoing.results.map(r => ({ id: r.toId })),
    // Can't send this player a request until `until` (after unfriending them, or them declining).
    waits: waits.results.map(r => ({ id: r.otherId, until: r.until })),
    notifications: notes.results,
  };
}

/* The requester, if signed in to an account that still exists. */
async function accountId(request, db) {
  const id = await requesterId(request, db);
  if (!id) return null;
  const row = await db.prepare('SELECT id FROM players WHERE id = ? AND email IS NOT NULL').bind(id).first();
  return row ? id : null;
}

/* My current friends, for the chat checks in PUT /api/state. */
export async function activeFriendIds(db, me) {
  if (!me) return new Set();
  const rows = (await db.prepare('SELECT friendId FROM friendships WHERE playerId = ? AND removedAt IS NULL').bind(me).all()).results;
  return new Set(rows.map(r => r.friendId));
}

/* Friends both ways. */
const befriend = (db, a, b, now) => [[a, b], [b, a]].map(([x, y]) => db.prepare(`INSERT INTO friendships (playerId, friendId, addedAt, removedAt)
  VALUES (?, ?, ?, NULL) ON CONFLICT(playerId, friendId) DO UPDATE SET addedAt = excluded.addedAt, removedAt = NULL`).bind(x, y, now));
const wait = (db, who, other, until) => db.prepare(`INSERT INTO friend_waits (playerId, otherId, until) VALUES (?, ?, ?)
  ON CONFLICT(playerId, otherId) DO UPDATE SET until = excluded.until`).bind(who, other, until);
const notify = (db, to, type, other, now) => db.prepare('INSERT INTO notifications (id, playerId, type, otherId, createdAt) VALUES (?, ?, ?, ?, ?)')
  .bind(randomToken(12), to, type, other, now);

/* Runs `fn(db, me, now)` for a signed-in account; `fn` returns an error Response or nothing. */
function asAccount(fn, signedOut) {
  return async (request, env, params) => {
    const db = env.DB;
    const me = await accountId(request, db);
    if (!me) return err(401, signedOut);
    const now = Date.now();
    const problem = await fn(db, me, now, params || {}, request);
    return problem || json(await socialOf(db, me, now));
  };
}

export const getSocial = asAccount(async () => null, 'Log in to see your friends.');

export const putSocial = asAccount(async (db, me, now, params, request) => {
  const body = await readJson(request);
  if (!body || typeof body.searchable !== 'boolean') return err(400, '"searchable" must be true or false.');
  await db.prepare(`INSERT INTO player_settings (playerId, searchable) VALUES (?, ?)
    ON CONFLICT(playerId) DO UPDATE SET searchable = excluded.searchable`).bind(me, body.searchable ? 1 : 0).run();
  return null;
}, 'Log in to change your profile.');

async function accept(db, me, them, now) {
  await db.batch([
    db.prepare("UPDATE friend_requests SET status = 'accepted', respondedAt = ? WHERE fromId = ? AND toId = ? AND status = 'pending'").bind(now, them, me),
    // Anything I'd sent them is settled too.
    db.prepare("UPDATE friend_requests SET status = 'accepted', respondedAt = ? WHERE fromId = ? AND toId = ? AND status = 'pending'").bind(now, me, them),
    ...befriend(db, me, them, now),
    notify(db, them, 'friend_accepted', me, now),
  ]);
}
const pendingFrom = (db, from, to) => db.prepare("SELECT id FROM friend_requests WHERE fromId = ? AND toId = ? AND status = 'pending'").bind(from, to).first();

export const sendRequest = asAccount(async (db, me, now, { id }) => {
  if (id === me) return err(400, "You can't add yourself as a friend.");
  const target = await db.prepare('SELECT id, name FROM players WHERE id = ? AND email IS NOT NULL').bind(id).first();
  if (!target) return err(404, 'That player has no account.');
  if (await db.prepare('SELECT 1 FROM friendships WHERE playerId = ? AND friendId = ? AND removedAt IS NULL').bind(me, id).first()) return null;
  const w = await db.prepare('SELECT until FROM friend_waits WHERE playerId = ? AND otherId = ? AND until > ?').bind(me, id, now).first();
  if (w) return err(429, `You can send ${target.name} a friend request again 24 hours after the last one ended.`);
  if (await pendingFrom(db, id, me)) { await accept(db, me, id, now); return null; } // they asked first
  if (await pendingFrom(db, me, id)) return null; // already asked
  await db.prepare("INSERT INTO friend_requests (id, fromId, toId, createdAt, status) VALUES (?, ?, ?, ?, 'pending')").bind(randomToken(12), me, id, now).run();
  return null;
}, 'Log in to add friends.');

export const acceptRequest = asAccount(async (db, me, now, { id }) => {
  if (!await pendingFrom(db, id, me)) return err(404, 'That friend request is no longer waiting.');
  await accept(db, me, id, now);
  return null;
}, 'Log in to answer friend requests.');

export const declineRequest = asAccount(async (db, me, now, { id }) => {
  if (!await pendingFrom(db, id, me)) return err(404, 'That friend request is no longer waiting.');
  await db.batch([
    db.prepare("UPDATE friend_requests SET status = 'declined', respondedAt = ? WHERE fromId = ? AND toId = ? AND status = 'pending'").bind(now, id, me),
    wait(db, id, me, now + WAIT_MS),
    notify(db, id, 'friend_declined', me, now),
  ]);
  return null;
}, 'Log in to answer friend requests.');

export const removeFriend = asAccount(async (db, me, now, { id }) => {
  await db.batch([
    db.prepare('UPDATE friendships SET removedAt = ? WHERE ((playerId = ? AND friendId = ?) OR (playerId = ? AND friendId = ?)) AND removedAt IS NULL').bind(now, me, id, id, me),
    wait(db, me, id, now + WAIT_MS),
  ]);
  return null;
}, 'Log in to change your friends.');

export const dismissNotification = asAccount(async (db, me, now, { id }) => {
  await db.prepare('UPDATE notifications SET dismissedAt = ? WHERE id = ? AND playerId = ?').bind(now, id, me).run();
  return null;
}, 'Log in to see your notifications.');

/* The chat id of an event's group chat — one per event, so two phones
   turning it on can't make two. */
export const eventChatId = eventId => `event-${eventId}`;

/* A chat the server hasn't stored yet is only accepted from one of its
   people: a 1:1 or group chat only if everyone else in it is their friend;
   an event's group chat only from that event's host or players, with the
   event's group chat turned on. Stored chats pass through unchanged. */
export function enforceNewChats(incoming, storedIds, requester, friendIds, events = []) {
  return incoming.filter(c => {
    if (!c || storedIds.has(c.id)) return true;
    if (!requester) return false;
    if (c.eventId) {
      const ev = events.find(e => e.id === c.eventId);
      return !!ev && !!ev.groupChat && c.id === eventChatId(ev.id)
        && (ev.createdBy === requester || (ev.memberIds || []).includes(requester));
    }
    const ids = c.participantIds || [];
    const others = ids.filter(x => x !== requester);
    return ids.includes(requester) && others.length > 0 && others.every(x => friendIds.has(x));
  });
}
