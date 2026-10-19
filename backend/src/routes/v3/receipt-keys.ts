import { Router } from 'express';
import { ReceiptService } from '../v3/receipt-service';

const router = Router();

/** Well-known provider receipt signing keys: current + previous (valid during dispute window). */
router.get('/', (_req, res) => {
  const service = new ReceiptService();
  res.json({ keys: service.getReceiptPublicKeys() });
});

export default router;
