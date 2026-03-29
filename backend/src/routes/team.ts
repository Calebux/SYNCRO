import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { emailService } from '../services/email-service';
import { createTeamInviteLimiter } from '../middleware/rate-limit-factory';
import logger from '../config/logger';

// ─── Validation schemas ───────────────────────────────────────────────────────

const VALID_ROLES = ['admin', 'member', 'viewer'] as const;

const inviteSchema = z.object({
  email: z
    .string()
    .email('Must be a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
  }).default('member'),
});

const updateRoleSchema = z.object({
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
  }),
});


const router = Router();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the team associated with a user (owned or member).
 * Returns { teamId, isOwner, memberRole } or null if no team.
 */
async function resolveUserTeam(
  userId: string
): Promise<{ teamId: string; isOwner: boolean; memberRole: string | null } | null> {
  // Check ownership first
  const { data: ownedTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .limit(1)
    .single();

  if (ownedTeam) {
    return { teamId: ownedTeam.id, isOwner: true, memberRole: null };
  }

  // Check membership
  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (membership) {
    return { teamId: membership.team_id, isOwner: false, memberRole: membership.role };
  }

  return null;
}

/**
 * Return true if the user can perform admin-level team actions (invite / remove).
 */
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

    // Fetch members with basic user profile from auth.users via supabase admin
    const { data: members, error } = await supabase
      .from('team_members')
      .select('id, user_id, role, joined_at')
      .eq('team_id', ctx.teamId)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    // Enrich each member with their email from auth.users
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
});

// ---------------------------------------------------------------------------
// POST /api/team/invite  — invite a new member
// ---------------------------------------------------------------------------
router.post('/invite', createTeamInviteLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bodyValidation = inviteSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      return res.status(400).json({
        success: false,
        error: bodyValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, role } = bodyValidation.data;

    // Ensure user has (or creates) a team
    let ctx = await resolveUserTeam(req.user!.id);

    if (!ctx) {
      // Auto-create a team for first-time owners
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

    // Check for an existing active invitation for this email + team
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

    // Check if already a member
    const { data: alreadyMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', ctx.teamId)
      .eq('user_id', (await (supabase.auth.admin as any)?.getUserByEmail?.(email))?.data?.user?.id ?? '')
      .limit(1)
      .single();

    if (alreadyMember) {
      return res.status(409).json({ success: false, error: 'This user is already a team member' });
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

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

    // Fetch team name for the email
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', ctx.teamId)
      .single();

    const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/team/accept/${invitation.token}`;

    // Fire-and-forget — don't block the response on email delivery
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
});

// ---------------------------------------------------------------------------
// GET /api/team/pending  — list pending invitations
// ---------------------------------------------------------------------------
router.get('/pending', async (req: AuthenticatedRequest, res: Response) => {
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
});

// ---------------------------------------------------------------------------
// POST /api/team/accept/:token  — accept an invitation
// ---------------------------------------------------------------------------
router.post('/accept/:token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params;

    const { data: invitation, error: fetchErr } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .single();

    if (fetchErr || !invitation) {
      return res.status(404).json({ success: false, error: 'Invitation not found or already used' });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Invitation has expired' });
    }

    // The authenticated user must match the invited email
    if (req.user!.email !== invitation.email) {
      return res.status(403).json({
        success: false,
        error: 'This invitation was sent to a different email address',
      });
    }

    // Check they're not already a member
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', invitation.team_id)
      .eq('user_id', req.user!.id)
      .single();

    if (existing) {
      // Mark invitation accepted anyway and return success
      await supabase
        .from('team_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      return res.json({ success: true, message: 'You are already a member of this team' });
    }

    // Add to team_members and mark invitation accepted in one go
    const { error: memberErr } = await supabase
      .from('team_members')
      .insert({ team_id: invitation.team_id, user_id: req.user!.id, role: invitation.role });

    if (memberErr) throw memberErr;

    await supabase
      .from('team_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    res.json({ success: true, message: 'You have joined the team', data: { role: invitation.role } });
  } catch (error) {
    logger.error('POST /api/team/accept/:token error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to accept invitation',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/team/:memberId/role  — update a member's role (owner only)
// ---------------------------------------------------------------------------
router.put('/:memberId/role', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.params;

    const bodyValidation = updateRoleSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      return res.status(400).json({
        success: false,
        error: bodyValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { role } = bodyValidation.data;

    const ctx = await resolveUserTeam(req.user!.id);

    if (!ctx?.isOwner) {
      return res.status(403).json({ success: false, error: 'Only the team owner can change member roles' });
    }

    // Verify the member belongs to this team
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
});

// ---------------------------------------------------------------------------
// DELETE /api/team/:memberId  — remove a team member (owner or admin)
// ---------------------------------------------------------------------------
router.delete('/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.params;

    const ctx = await resolveUserTeam(req.user!.id);

    if (!ctx) {
      return res.status(403).json({ success: false, error: 'You are not part of a team' });
    }

    if (!canManageTeam(ctx)) {
      return res.status(403).json({ success: false, error: 'Only team owners and admins can remove members' });
    }

    // Verify member belongs to this team
    const { data: member, error: fetchErr } = await supabase
      .from('team_members')
      .select('id, user_id')
      .eq('id', memberId)
      .eq('team_id', ctx.teamId)
      .single();

    if (fetchErr || !member) {
      return res.status(404).json({ success: false, error: 'Team member not found' });
    }

    // Prevent removing the owner via this endpoint
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
});

export default router;
