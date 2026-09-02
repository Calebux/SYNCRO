import { Request } from 'express';
import { supabase } from '../../config/database';
import { NotFoundError, UnauthorizedError } from '../../errors';
import { encodeV2Cursor, parseV2ListQuery } from '../../http/v2/cursor';
import { paginate } from '../../http/v2/envelope';
import { createV2Registry, type V2HandlerContext } from '../../http/v2/registry';

function requireUser(req: Request): string {
  const user = (req as Request & { user?: { id: string } }).user;
  if (!user?.id) {
    throw new UnauthorizedError();
  }
  return user.id;
}

export const v2Registry = createV2Registry();

v2Registry.register({
  method: 'get',
  path: '/health',
  auth: 'public',
  handler: async () => ({
    status: 'ok',
    version: 'v2',
  }),
});

v2Registry.register({
  method: 'get',
  path: '/subscriptions',
  auth: 'user',
  list: true,
  handler: async (ctx: V2HandlerContext) => {
    const userId = requireUser(ctx.req);
    const { limit, cursor } = parseV2ListQuery(ctx.query);

    let query = supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch subscriptions: ${error.message}`);
    }

    const hasMore = (rows?.length ?? 0) > limit;
    const items = hasMore ? rows!.slice(0, limit) : (rows ?? []);
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeV2Cursor({ createdAt: last.created_at, id: String(last.id) })
        : null;

    return paginate(items, { next_cursor: nextCursor, has_more: hasMore, limit });
  },
});

v2Registry.register({
  method: 'get',
  path: '/subscriptions/:id',
  auth: 'user',
  handler: async (ctx: V2HandlerContext) => {
    const userId = requireUser(ctx.req);
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('id', ctx.params.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch subscription: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundError('Subscription not found.');
    }
    return data;
  },
});

v2Registry.register({
  method: 'get',
  path: '/tags',
  auth: 'user',
  list: true,
  handler: async (ctx: V2HandlerContext) => {
    const userId = requireUser(ctx.req);
    const { limit, cursor } = parseV2ListQuery(ctx.query);

    let query = supabase
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch tags: ${error.message}`);
    }

    const hasMore = (rows?.length ?? 0) > limit;
    const items = hasMore ? rows!.slice(0, limit) : (rows ?? []);
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeV2Cursor({ createdAt: last.created_at, id: String(last.id) })
        : null;

    return paginate(items, { next_cursor: nextCursor, has_more: hasMore, limit });
  },
});
