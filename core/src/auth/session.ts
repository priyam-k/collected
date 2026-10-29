import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { apiTokens, sessions, users, type ApiTokenRow, type UserRow } from '../db/schema.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { nowIso } from '../lib/time.js';

export const SESSION_COOKIE = 'collected_session';
export const SESSION_DAYS = 30;
/** Plaintext tokens start with this so a leaked one is recognisable in logs and secret scanners. */
export const TOKEN_PREFIX = 'clt_';
/** The first person to sign in claims a single-user instance; stored so nobody else can. */
export const OWNER_SETTING = 'auth.owner';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(24).toString('base64url');
const TOUCH_MS = 60 * 60_000;

/** Whether an email may sign in: `ALLOWED_EMAILS` when set, else only the owner (or anyone, until there is one). */
export async function emailAllowed(ctx: AppContext, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  if (ctx.env.ALLOWED_EMAILS?.length) return ctx.env.ALLOWED_EMAILS.includes(e);
  const owner = await getSetting<string>(ctx, OWNER_SETTING);
  return !owner || owner.toLowerCase() === e;
}

export async function upsertUser(ctx: AppContext, profile: { email: string; name?: string | null; picture?: string | null }): Promise<UserRow> {
  const email = profile.email.trim().toLowerCase();
  const now = nowIso();
  const [row] = await ctx.db
    .insert(users)
    .values({ id: newId(), email, name: profile.name ?? null, picture: profile.picture ?? null, lastLoginAt: now })
    .onConflictDoUpdate({ target: users.email, set: { name: profile.name ?? null, picture: profile.picture ?? null, lastLoginAt: now } })
    .returning();
  if (!(await getSetting<string>(ctx, OWNER_SETTING))) await setSetting(ctx, OWNER_SETTING, email);
  return row!;
}

export async function userByEmail(ctx: AppContext, email: string): Promise<UserRow | null> {
  return (await ctx.db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })) ?? null;
}

// --- sessions ---------------------------------------------------------------------------------------------------

export async function createSession(ctx: AppContext, userId: string, userAgent?: string | null): Promise<{ id: string; expiresAt: string }> {
  const id = newId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await ctx.db.insert(sessions).values({ id, userId, userAgent: userAgent?.slice(0, 300) ?? null, expiresAt });
  return { id, expiresAt };
}

/** The user behind a session id, or null when unknown or expired. Sliding expiry, touched at most hourly. */
export async function sessionUser(ctx: AppContext, id: string): Promise<UserRow | null> {
  if (!id) return null;
  const s = await ctx.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
  if (!s) return null;
  if (s.expiresAt < nowIso()) {
    await ctx.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (Date.now() - Date.parse(s.lastSeenAt) > TOUCH_MS) {
    await ctx.db.update(sessions).set({ lastSeenAt: nowIso(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString() }).where(eq(sessions.id, id));
  }
  return (await ctx.db.query.users.findFirst({ where: eq(users.id, s.userId) })) ?? null;
}

export async function deleteSession(ctx: AppContext, id: string): Promise<void> {
  await ctx.db.delete(sessions).where(eq(sessions.id, id));
}

// --- API tokens (the CLI) --------------------------------------------------------------------------------------------

export async function createToken(ctx: AppContext, userId: string, name: string): Promise<{ token: string; row: ApiTokenRow }> {
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await ctx.db
    .insert(apiTokens)
    .values({ id: newId(), userId, name: name.trim().slice(0, 80), tokenHash: sha256(secret), prefix: secret.slice(0, 10) })
    .returning();
  return { token: secret, row: row! };
}

/** Resolves a bearer token to its user and row, or null. `lastUsedAt` is updated at most hourly. */
export async function tokenUser(ctx: AppContext, token: string): Promise<{ user: UserRow; token: ApiTokenRow } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await ctx.db.query.apiTokens.findFirst({ where: and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt)) });
  if (!row) return null;
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) return null;
  if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > TOUCH_MS) await ctx.db.update(apiTokens).set({ lastUsedAt: nowIso() }).where(eq(apiTokens.id, row.id));
  return { user, token: row };
}

export async function listTokens(ctx: AppContext, userId: string): Promise<ApiTokenRow[]> {
  return ctx.db.select().from(apiTokens).where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.createdAt));
}

export async function revokeToken(ctx: AppContext, userId: string, id: string): Promise<boolean> {
  const r = await ctx.db
    .update(apiTokens)
    .set({ revokedAt: nowIso() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return r.length > 0;
}

/** Synthetic identities that stand in for the owner: `dev` under AUTH_DISABLED, `local` for the CLI's in-process app (LOCAL_OWNER). */
export const SYNTHETIC_PERSONS: Record<string, { email: string; name: string }> = {
  dev: { email: 'dev@localhost', name: 'Local development' },
  local: { email: 'local@this-machine', name: 'This machine' },
};

/** A person (an email or a synthetic owner), as opposed to a token, service token or helper key. */
export const isPerson = (identity: string | null | undefined): boolean => !!identity && (identity in SYNTHETIC_PERSONS || identity.includes('@'));
