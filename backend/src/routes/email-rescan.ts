import { Router, type Response } from 'express';
import { z } from 'zod';
import { supabase } from '../config/database';
import { type AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { emailRescanService } from '../services/email-rescan-service';

const router = Router();
const MAX_RESCAN_WINDOW_DAYS = 31;

const rescanRequestSchema = z.object({
  emailAccountId: z.string().uuid('emailAccountId must be a valid UUID'),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
}).superRefine((value, ctx) => {
  const startAt = new Date(value.startDate);
  const endAt = new Date(value.endDate);

  if (startAt > endAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'startDate must be less than or equal to endDate',
    });
  }

  if (endAt.getTime() > Date.now()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'endDate cannot be in the future',
    });
  }

  const windowDays = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
  if (windowDays > MAX_RESCAN_WINDOW_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: `Re-scan window cannot exceed ${MAX_RESCAN_WINDOW_DAYS} days`,
    });
  }
});

router.post(
  '/rescan',
  validate(rescanRequestSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { emailAccountId, startDate, endDate } = req.body as z.infer<typeof rescanRequestSchema>;

    const { data: emailAccount, error } = await supabase
      .from('email_accounts')
      .select('id, is_connected')
      .eq('id', emailAccountId)
      .eq('user_id', req.user!.id)
      .single();

    if (error || !emailAccount) {
      return res.status(404).json({
        success: false,
        error: 'Email account not found',
      });
    }

    if (!emailAccount.is_connected) {
      return res.status(409).json({
        success: false,
        error: 'Email account is disconnected',
      });
    }

    const result = await emailRescanService.triggerRescan({
      userId: req.user!.id,
      operatorId: req.user!.id,
      emailAccountId,
      startDate,
      endDate,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  },
);

export default router;
