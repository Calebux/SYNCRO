import { supabase } from '../config/database';
import { PaidReceipt } from './types';
import { ReceiptStore } from './receipt-service';

export class SupabaseReceiptStore implements ReceiptStore {
  async save(receipt: PaidReceipt): Promise<void> {
    const { error } = await supabase.from('v3_receipts').insert({
      receipt_id: receipt.receiptId,
      channel_id: receipt.channelId,
      issued_at: receipt.timestamp,
      receipt,
    });
    if (error) throw new Error(`Failed to persist receipt ${receipt.receiptId}: ${error.message}`);
  }

  async get(receiptId: string): Promise<PaidReceipt | null> {
    const { data, error } = await supabase
      .from('v3_receipts')
      .select('receipt')
      .eq('receipt_id', receiptId)
      .maybeSingle();
    if (error) throw new Error(`Failed to retrieve receipt ${receiptId}: ${error.message}`);
    return (data?.receipt as PaidReceipt | undefined) ?? null;
  }
}
