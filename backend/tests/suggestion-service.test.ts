jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/config/database', () => ({ supabase: { from: jest.fn() } }));

import { SuggestionService } from '../src/services/suggestion-service';
import { supabase } from '../src/config/database';

const mockFrom = supabase.from as jest.Mock;

describe('SuggestionService', () => {
  let service: SuggestionService;

  beforeEach(() => {
    service = new SuggestionService();
    jest.clearAllMocks();
  });

  function mockSubscriptions(subs: any[], dismissed: any[] = []) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: subs, error: null }),
          }),
        };
      }
      // dismissed_suggestions
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockResolvedValue({ data: dismissed, error: null }),
      };
    });
  }

  it('generates switch_to_annual suggestion for monthly Netflix', async () => {
    const now = new Date().toISOString();
    mockSubscriptions([
      { id: 'sub-1', name: 'Netflix', price: 15.49, billing_cycle: 'monthly', category: 'entertainment', last_interaction_at: now, created_at: now },
    ]);

    const suggestions = await service.generateSuggestions('user-1');
    const s = suggestions.find((s) => s.type === 'switch_to_annual');
    expect(s).toBeDefined();
    expect(s!.savingsPerYear).toBeGreaterThan(20);
  });

  it('generates unused_subscription suggestion for 90-day-old subscription', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);
    mockSubscriptions([
      { id: 'sub-2', name: 'SomeApp', price: 9.99, billing_cycle: 'monthly', category: 'productivity', last_interaction_at: oldDate.toISOString(), created_at: oldDate.toISOString() },
    ]);

    const suggestions = await service.generateSuggestions('user-1');
    expect(suggestions.find((s) => s.type === 'unused_subscription')).toBeDefined();
  });

  it('generates duplicate_service suggestion for two ai_tools subscriptions', async () => {
    const now = new Date().toISOString();
    mockSubscriptions([
      { id: 'sub-3', name: 'ChatGPT Plus', price: 20, billing_cycle: 'monthly', category: 'ai_tools', last_interaction_at: now, created_at: now },
      { id: 'sub-4', name: 'Claude Pro',   price: 20, billing_cycle: 'monthly', category: 'ai_tools', last_interaction_at: now, created_at: now },
    ]);

    const suggestions = await service.generateSuggestions('user-1');
    expect(suggestions.find((s) => s.type === 'duplicate_service')).toBeDefined();
  });

  it('skips dismissed suggestions', async () => {
    const now = new Date().toISOString();
    const dismissed = [
      { subscription_id: 'sub-1', suggestion_type: 'switch_to_annual', dismissed_until: new Date(Date.now() + 86400000).toISOString() },
    ];
    mockSubscriptions(
      [{ id: 'sub-1', name: 'Netflix', price: 15.49, billing_cycle: 'monthly', category: 'entertainment', last_interaction_at: now, created_at: now }],
      dismissed,
    );

    const suggestions = await service.generateSuggestions('user-1');
    expect(suggestions.find((s) => s.type === 'switch_to_annual')).toBeUndefined();
  });

  it('returns empty array when user has no subscriptions', async () => {
    mockSubscriptions([]);
    const suggestions = await service.generateSuggestions('user-1');
    expect(suggestions).toEqual([]);
  });
});
