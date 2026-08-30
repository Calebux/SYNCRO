import { Router, Response } from 'express';
import { supabase } from '../config/database';
<<<<<<< HEAD
import { AuthenticatedRequest } from '../middleware/auth';
=======
import { env } from '../config/env';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
>>>>>>> main
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { emailService } from '../services/email-service';
import { createTeamInviteLimiter } from '../middleware/rate-limit-factory';
import logger from '../config/logger';
import { inviteTeamSchema, updateRoleSchema } from '../schemas/team';
import { NotFoundError } from '../errors';

const router: Router = Router();


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveUserTeam(
  userId: string
): Promise<{ teamId: string; isOwner: boolean; memberRole: string | null } | null> {
  const { data: ownedTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  if (ownedTeam) {
    return { teamId: ownedTeam.id, isOwner: true, memberRole: null };
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (membership) {
    return { teamId: membership.team_id, isOwner: false, memberRole: membership.role };
  }

  return null;
}

function canManageTeam(ctx: { isOwner: boolean; memberRole: string | null }): boolean {
  return ctx.isOwner || ctx.memberRole === 'admin';
}

// ---------------------------------------------------------------------------
// GET /api/team  — list team members
// ---------------------------------------------------------------------------

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await resolveUserTeam(req.user!.id);

    if (!ctx) {
      return res.json({ success: true, data: [] });
    }

    const { data: members, error } = await supabase
      .from('team_members')
      .select('id, user_id, role, joined_at')
      .eq('team_id', ctx.teamId)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        const { data: userData } = await supabase.auth.admin.getUserById(m.user_id);
        return {
          id: m.id,
          userId: m.user_id,
          email: userData?.user?.email ?? null,
          role: m.role,
          joinedAt: m.joined_at,
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error('GET /api/team error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list team members',
    });
  }

  const { data: members, error } = await supabase
    .from('team_members')
    .select('id, user_id, role, joined_at')
    .eq('team_id', ctx.teamId)
    .order('joined_at', { ascending: true });

  if (error) throw error;

  const enriched = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data: userData } = await supabase.auth.admin.getUserById(m.user_id);
      return {
        id: m.id,
        userId: m.user_id,
        email: userData?.user?.email ?? null,
        role: m.role,
        joinedAt: m.joined_at,
      };
    })
  );

  res.json({ success: true, data: enriched });
});

// ---------------------------------------------------------------------------
// POST /api/team/invite  — invite a new member
// ---------------------------------------------------------------------------

router.post(
  '/invite',
  createTeamInviteLimiter(),
  requireRole('owner', 'admin'),
  validate(inviteTeamSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, role } = req.body;

      let ctx = await resolveUserTeam(req.user!.id);

      if (!ctx) {
        const { data: newTeam, error: createErr } = await supabase
          .from('teams')
          .insert({ name: `${req.user!.email}'s Team`, owner_id: req.user!.id })
          .select('id')
          .single();

        if (createErr || !newTeam) throw createErr ?? new Error('Failed to create team');
        ctx = { teamId: newTeam.id, isOwner: true, memberRole: null };
      }

      if (!canManageTeam(ctx)) {
        return res.status(403).json({ success: false, error: 'Only team owners and admins can invite members' });
      }

      const { data: existing } = await supabase
        .from('team_invitations')
        .select('id, expires_at')
        .eq('team_id', ctx.teamId)
        .eq('email', email)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .single();

      if (existing) {
        return res.status(409).json({ success: false, error: 'A pending invitation already exists for this email' });
      }

      // Resolve invitee by email via Admin API (typed loosely — SDK may lack getUserByEmail)
      type AdminUserLookup = {
        getUserByEmail?: (
          email: string,
        ) => Promise<{ data: { user: { id: string } | null } | null }>;
      };
      const adminAuth = supabase.auth.admin as unknown as AdminUserLookup;
      const inviteeLookup = adminAuth.getUserByEmail
        ? await adminAuth.getUserByEmail(email)
        : { data: { user: null } };

      const { data: alreadyMember } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', ctx.teamId)
        .eq('user_id', inviteeLookup?.data?.user?.id ?? '')
        .limit(1)
        .single();

      if (alreadyMember) {
        return res.status(409).json({ success: false, error: 'This user is already a team member' });
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const { data: invitation, error: invErr } = await supabase
        .from('team_invitations')
        .insert({
          team_id: ctx.teamId,
          email,
          role,
          invited_by: req.user!.id,
          expires_at: expiresAt.toISOString(),
        })
        .select('id, token, expires_at')
        .single();

      if (invErr || !invitation) throw invErr ?? new Error('Failed to create invitation');

      const { data: team } = await supabase
        .from('teams')
        .select('name')
        .eq('id', ctx.teamId)
        .single();

      const acceptUrl = `${env.FRONTEND_URL}/team/accept/${invitation.token}`;

      emailService
        .sendInvitationEmail(email, {
          inviterEmail: req.user!.email,
          teamName: team?.name ?? 'your team',
          role,
          acceptUrl,
          expiresAt,
        })
        .catch((err) => logger.error('Invitation email failed:', err));

      res.status(201).json({
        success: true,
        data: {
          id: invitation.id,
          email,
          role,
          expiresAt: invitation.expires_at,
          acceptUrl,
        },
      });
    } catch (error) {
      logger.error('POST /api/team/invite error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send invitation',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/team/pending  — list pending invitations
// ---------------------------------------------------------------------------

router.get('/pending', requireRole('owner', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await resolveUserTeam(req.user!.id);

    if (!ctx) {
      return res.json({ success: true, data: [] });
    }

    if (!canManageTeam(ctx)) {
      return res.status(403).json({ success: false, error: 'Only team owners and admins can view pending invitations' });
    }

    const { data: invitations, error } = await supabase
      .from('team_invitations')
      .select('id, email, role, expires_at, created_at, invited_by')
      .eq('team_id', ctx.teamId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data: invitations ?? [] });
  } catch (error) {
    logger.error('GET /api/team/pending error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list pending invitations',
    });
  }

  const { data: invitations, error } = await supabase
    .from('team_invitations')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('team_id', ctx.teamId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;

  res.json({ success: true, data: invitations ?? [] });
});

// ---------------------------------------------------------------------------
// POST /api/team/accept/:token  — accept an invitation
// ---------------------------------------------------------------------------

router.post('/accept/:token', async (req: AuthenticatedRequest, res: Response) => {
  const { token } = req.params;

  const { data: invitation, error: fetchErr } = await supabase
    .from('team_invitations')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .maybeSingle();

  if (fetchErr || !invitation) {
    throw new NotFoundError('Invitation not found or already used');
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new BadRequestError('Invitation has expired'); // Or perhaps a custom 410 if desired, but 400/404 is cleaner
  }

    if (req.user!.email !== invitation.email) {
      return res.status(403).json({
        success: false,
        error: 'This invitation was sent to a different email address',
      });
    }

    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', invitation.team_id)
      .eq('user_id', req.user!.id)
      .single();

    if (existing) {
      await supabase
        .from('team_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return res.json({ success: true, message: 'You are already a member of this team' });
    }

    const { error: memberErr } = await supabase
      .from('team_members')
      .insert({ team_id: invitation.team_id, user_id: req.user!.id, role: invitation.role });

    if (memberErr) throw memberErr;

  if (existing) {
    await supabase
      .from('team_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    return res.json({ success: true, message: 'You are already a member of this team' });
  }

  const { error: memberErr } = await supabase
    .from('team_members')
    .insert({ team_id: invitation.team_id, user_id: req.user!.id, role: invitation.role });

  if (memberErr) throw memberErr;

  await supabase
    .from('team_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  res.json({ success: true, message: 'You have joined the team', data: { role: invitation.role } });
});

// ---------------------------------------------------------------------------
// PUT /api/team/:memberId/role  — update a member's role (owner only)
// ---------------------------------------------------------------------------

router.put(
  '/:memberId/role',
  requireRole('owner'),
  validate(updateRoleSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { memberId } = req.params;
      const { role } = req.body;

      const ctx = await resolveUserTeam(req.user!.id);

      if (!ctx?.isOwner) {
        return res.status(403).json({ success: false, error: 'Only the team owner can change member roles' });
      }

      const { data: member, error: fetchErr } = await supabase
        .from('team_members')
        .select('id, user_id, role')
        .eq('id', memberId)
        .eq('team_id', ctx.teamId)
        .single();

      if (fetchErr || !member) {
        return res.status(404).json({ success: false, error: 'Team member not found' });
      }

      const { data: updated, error: updateErr } = await supabase
        .from('team_members')
        .update({ role })
        .eq('id', memberId)
        .select('id, user_id, role, joined_at')
        .single();

      if (updateErr) throw updateErr;

      res.json({ success: true, data: updated });
    } catch (error) {
      logger.error('PUT /api/team/:memberId/role error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update member role',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/team/:memberId  — remove a team member (owner or admin)
// ---------------------------------------------------------------------------

router.delete('/:memberId', requireRole('owner', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.params;

    const ctx = await resolveUserTeam(req.user!.id);

    if (!ctx) {
      return res.status(403).json({ success: false, error: 'You are not part of a team' });
    }

    if (!canManageTeam(ctx)) {
      return res.status(403).json({ success: false, error: 'Only team owners and admins can remove members' });
    }

    const { data: member, error: fetchErr } = await supabase
      .from('team_members')
      .select('id, user_id')
      .eq('id', memberId)
      .eq('team_id', ctx.teamId)
      .single();

    if (fetchErr || !member) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }

    const { data: team } = await supabase
      .from('teams')
      .select('owner_id')
      .eq('id', ctx.teamId)
      .single();

    if (team?.owner_id === member.user_id) {
      return res.status(400).json({ success: false, error: 'Cannot remove the team owner' });
    }

    const { error: deleteErr } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId);

    if (deleteErr) throw deleteErr;

    res.json({ success: true, message: 'Team member removed' });
  } catch (error) {
    logger.error('DELETE /api/team/:memberId error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove team member',
    });
  }

  const { data: member, error: fetchErr } = await supabase
    .from('team_members')
    .select('id, user_id')
    .eq('id', req.params.memberId)
    .eq('team_id', ctx.teamId)
    .maybeSingle();

  if (fetchErr || !member) {
    throw new NotFoundError('Team member not found');
  }

  const { data: team } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', ctx.teamId)
    .single();

  if (team?.owner_id === member.user_id) {
    throw new BadRequestError('Cannot remove the team owner');
  }

  const { error: deleteErr } = await supabase
    .from('team_members')
    .delete()
    .eq('id', req.params.memberId);

  if (deleteErr) throw deleteErr;

  res.json({ success: true, message: 'Team member removed' });
});

// ---------------------------------------------------------------------------
// PATCH /api/team/slack-webhook  — save Slack webhook URL (admin/owner only)
// ---------------------------------------------------------------------------

router.patch('/slack-webhook', requireRole('owner', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { slack_webhook_url } = req.body as { slack_webhook_url: string | null };

    const ctx = await resolveUserTeam(req.user!.id);
    if (!ctx) {
      return res.status(404).json({ success: false, error: 'No team found' });
    }
    if (!canManageTeam(ctx)) {
      return res.status(403).json({ success: false, error: 'Only admins can update the Slack webhook' });
    }

    // Basic URL validation
    if (slack_webhook_url && !slack_webhook_url.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({ success: false, error: 'Invalid Slack webhook URL' });
    }

    const { error } = await supabase
      .from('teams')
      .update({ slack_webhook_url: slack_webhook_url ?? null })
      .eq('id', ctx.teamId);

    if (error) throw error;

    res.json({ success: true, message: 'Slack webhook updated' });
  } catch (error) {
    logger.error('PATCH /api/team/slack-webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update Slack webhook',
    });
  }
});

export default router;
