import { supabase } from '../config/database';
import logger from '../config/logger';
import type { Merchant, MerchantCreateInput, MerchantUpdateInput } from '../types/merchant';

export class MerchantService {
    private async discoverMetadata(name: string): Promise<{ cancellation_url: string | null }> {
        // Implement a heuristic-based discovery for cancellation URLs.
        // E.g. Netflix -> netflix.com/cancel
        try {
            const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalized.length > 0) {
                return { cancellation_url: `https://www.${normalized}.com/cancel` };
            }
        } catch (e) {
            logger.warn(`Failed to discover metadata for ${name}:`, e);
        }
        return { cancellation_url: null };
    }

    async createMerchant(input: MerchantCreateInput): Promise<Merchant> {
        let cancellation_url = input.cancellation_url;
        if (!cancellation_url) {
            const discovered = await this.discoverMetadata(input.name);
            cancellation_url = discovered.cancellation_url;
        }

        const { data: merchant, error } = await supabase
            .from('merchants')
            .insert({
                name: input.name,
                logo_url: input.logo_url || null,
                category: input.category || null,
                cancellation_url: cancellation_url || null,
                gift_card_supported: input.gift_card_supported || false,
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create merchant:', error);
            throw new Error(`Failed to create merchant: ${error.message}`);
        }

        return merchant;
    }

    async updateMerchant(merchantId: string, input: MerchantUpdateInput): Promise<Merchant> {
        const updateData: any = {
            ...input,
            updated_at: new Date().toISOString(),
        };

        // Remove undefined fields
        Object.keys(updateData).forEach(
            (key) => updateData[key] === undefined && delete updateData[key]
        );

        const { data: merchant, error } = await supabase
            .from('merchants')
            .update(updateData)
            .eq('merchant_id', merchantId)
            .select()
            .single();

        if (error) {
            logger.error('Failed to update merchant:', error);
            throw new Error(`Failed to update merchant: ${error.message}`);
        }

        if (!merchant) {
            throw new Error('Merchant not found');
        }

        return merchant;
    }

    async deleteMerchant(merchantId: string): Promise<void> {
        const { error } = await supabase
            .from('merchants')
            .delete()
            .eq('merchant_id', merchantId);

        if (error) {
            logger.error('Failed to delete merchant:', error);
            throw new Error(`Failed to delete merchant: ${error.message}`);
        }
    }

    async getMerchant(merchantId: string): Promise<Merchant> {
        const { data: merchant, error } = await supabase
            .from('merchants')
            .select('*')
            .eq('merchant_id', merchantId)
            .single();

        if (error) {
            logger.error('Failed to get merchant:', error);
            throw new Error(`Failed to get merchant: ${error.message}`);
        }

        if (!merchant) {
            throw new Error('Merchant not found');
        }

        return merchant;
    }

    async listMerchants(options: { limit?: number; offset?: number; category?: string } = {}): Promise<{ merchants: Merchant[]; total: number }> {
        let query = supabase
            .from('merchants')
            .select('*', { count: 'exact' })
            .order('name', { ascending: true });

        if (options.category) {
            query = query.eq('category', options.category);
        }

        if (options.limit) {
            query = query.limit(options.limit);
        }

        if (options.offset) {
            query = query.range(
                options.offset,
                options.offset + (options.limit || 10) - 1
            );
        }

        const { data: merchants, error, count } = await query;

        if (error) {
            logger.error('Failed to list merchants:', error);
            throw new Error(`Failed to list merchants: ${error.message}`);
        }

        return {
            merchants: merchants || [],
            total: count || 0,
        };
    }
}

export const merchantService = new MerchantService();
