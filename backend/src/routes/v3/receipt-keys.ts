import { Router } from 'express';
import { receiptService } from '../../v3/receipt-runtime';

const router = Router();

/** Well-known provider receipt signing keys: current + previous (valid during dispute window). */
router.get('/', (_req, res) => {
  res.json({ keys: receiptService.getReceiptPublicKeys() });
});

export default router;
