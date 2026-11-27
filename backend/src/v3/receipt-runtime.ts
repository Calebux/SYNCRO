import { ReceiptService } from './receipt-service';
import { SupabaseReceiptStore } from './receipt-store';

export const receiptService = new ReceiptService(new SupabaseReceiptStore());
