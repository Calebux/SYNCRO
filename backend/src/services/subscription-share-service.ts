import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';
import type { CreateShareInviteInput } from '../schemas/subscription-share';

export type SharePermissionLevel = 'view-only' | 'can-renew' | 'full-access';

export interface ShareInvite {
  id: string;
  subscription_id: string;
  created_by: string;
  token_hash: string;
  permission_level: SharePermissionLevel;
  max_uses: number;
  use_count: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareInvitePublicView {
  subscriptionId: string;
  subscriptionName: string;
  permissionLevel: SharePermissionLevel;
  expiresAt: string;
  usesRemaining: number | null;
}

const EXPIRY_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export class SubscriptionShareService {
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  async createInvite(
    userId: string,
    subscriptionId: string,
    input: CreateShareInviteInput,
  ): Promise<{ invite: ShareInvite; token: string; shareUrl: string }> {
    const { data: subscription, error: subErr } = await supabase
      .from('subscriptions')
      .select('id, name, user_id')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .single();

    if (subErr || !subscription) {
      throw new Error('Subscription not found or access denied');
    }

    const token = this.generateToken();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + (EXPIRY_MS[input.expiry] ?? EXPIRY_MS['7d']));
    const maxUses = input.maxUses === -1 ? 999999 : 1;

    const { data: invite, error } = await supabase
      .from('subscription_share_invites')
      .insert({
        subscription_id: subscriptionId,
        created_by: userId,
        token_hash: tokenHash,
        permission_level: input.permissionLevel,
        max_uses: maxUses,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error || !invite) {
      logger.error('[SubscriptionShare] Failed to create invite', { error });
      throw new Error('Failed to create share invite');
    }

    await this.logAudit(invite.id, subscriptionId, 'created', userId, {
      permissionLevel: input.permissionLevel,
      expiry: input.expiry,
      maxUses: input.maxUses,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const shareUrl = `${frontendUrl}/share/${token}`;

    return { invite: invite as ShareInvite, token, shareUrl };
  }

  async getInvitePreview(token: string): Promise<ShareInvitePublicView> {
    const tokenHash = this.hashToken(token);

    const { data: invite, error } = await supabase
      .from('subscription_share_invites')
      .select('*, subscriptions!inner(id, name)')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .single();

    if (error || !invite) {
      throw new Error('Invite not found or has been revoked');
    }

    if (new Date(invite.expires_at) < new Date()) {
      await this.logAudit(invite.id, invite.subscription_id, 'expired', null);
      throw new Error('Invite has expired');
    }

    if (invite.use_count >= invite.max_uses) {
      throw new Error('Invite has reached its usage limit');
    }

    const sub = invite.subscriptions as { id: string; name: string };

    await this.logAudit(invite.id, invite.subscription_id, 'viewed', null);

    return {
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      permissionLevel: invite.permission_level,
      expiresAt: invite.expires_at,
      usesRemaining: invite.max_uses >= 999999 ? null : invite.max_uses - invite.use_count,
    };
  }

  async acceptInvite(token: string, userId: string): Promise<{
    subscriptionId: string;
    permissionLevel: SharePermissionLevel;
  }> {
    const tokenHash = this.hashToken(token);

    const { data: invite, error } = await supabase
      .from('subscription_share_invites')
      .select('*')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .single();

    if (error || !invite) {
      throw new Error('Invite not found or has been revoked');
    }

    if (new Date(invite.expires_at) < new Date()) {
      throw new Error('Invite has expired');
    }

    if (invite.use_count >= invite.max_uses) {
      throw new Error('Invite has reached its usage limit');
    }

    if (invite.created_by === userId) {
      throw new Error('Cannot accept your own invite');
    }

    const { error: updateErr } = await supabase
      .from('subscription_share_invites')
      .update({
        use_count: invite.use_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (updateErr) {
      throw new Error('Failed to accept invite');
    }

    await this.logAudit(invite.id, invite.subscription_id, 'accepted', userId, {
      permissionLevel: invite.permission_level,
    });

    return {
      subscriptionId: invite.subscription_id,
      permissionLevel: invite.permission_level,
    };
  }

  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const { data: invite, error } = await supabase
      .from('subscription_share_invites')
      .select('*')
      .eq('id', inviteId)
      .eq('created_by', userId)
      .is('revoked_at', null)
      .single();

    if (error || !invite) {
      throw new Error('Invite not found or already revoked');
    }

    const { error: updateErr } = await supabase
      .from('subscription_share_invites')
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', inviteId);

    if (updateErr) {
      throw new Error('Failed to revoke invite');
    }

    await this.logAudit(inviteId, invite.subscription_id, 'revoked', userId);
  }

  async listPendingInvites(userId: string, subscriptionId: string): Promise<ShareInvite[]> {
    const { data, error } = await supabase
      .from('subscription_share_invites')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .eq('created_by', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Failed to list share invites');
    }

    return (data ?? []) as ShareInvite[];
  }

  async getAuditLog(userId: string, subscriptionId: string): Promise<unknown[]> {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      throw new Error('Subscription not found or access denied');
    }

    const { data, error } = await supabase
      .from('subscription_share_audit_log')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Failed to fetch audit log');
    }

    return data ?? [];
  }

  private async logAudit(
    inviteId: string,
    subscriptionId: string,
    action: string,
    actorUserId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase.from('subscription_share_audit_log').insert({
      invite_id: inviteId,
      subscription_id: subscriptionId,
      action,
      actor_user_id: actorUserId,
      metadata: metadata ?? null,
    });

    if (error) {
      logger.warn('[SubscriptionShare] Audit log insert failed', { error });
    }
  }
}

export const subscriptionShareService = new SubscriptionShareService();
