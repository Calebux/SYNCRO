import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { slackService } from '../../services/slack-service';

const router: Router = Router();

router.get('/status', (_req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
  res.json({
    success: true,
    data: slackService.getStatus(),
  });
});

export default router;
