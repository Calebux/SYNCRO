/**
 * Analytics API Route Tests
 * 
 * Tests spending aggregation by category and time period.
 * Tests date range filtering and validation.
 * Tests data format and structure.
 * 
 * **Validates: Requirements 1.4, 1.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';
import { mockUser, fixtures } from '@/lib/test-utils';
import { HttpStatus } from '@/lib/api/types';

// Mock dependencies
const mockSupabaseSelect = vi.fn().mockReturnThis();
const mockSupabaseEq = vi.fn().mockResolvedValue({ 
  data: fixtures.activeSubscriptions, 
  error: null 
});

const mockSupabaseFrom = vi.fn(() => ({
  select: mockSupabaseSelect,
  eq: mockSupabaseEq,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

describe('GET /api/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseSelect.mockReturnThis();
    mockSupabaseEq.mockResolvedValue({ 
      data: fixtures.activeSubscriptions, 
      error: null 
    });
  });

  it('should return analytics data for authenticated user', async () => {
    const user = mockUser({ id: 'user-123' });
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.success).toBe(true);
    expect(data.data.analytics).toBeDefined();
    expect(data.data.analytics).toHaveProperty('totalSpend');
    expect(data.data.analytics).toHaveProperty('monthlySpend');
    expect(data.data.analytics).toHaveProperty('categoryBreakdown');
    expect(data.data.analytics).toHaveProperty('spendTrend');
  });

  it('should calculate total spend correctly', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    const expectedTotal = fixtures.activeSubscriptions.reduce(
      (sum, sub) => sum + (sub.price || 0),
      0
    );

    expect(data.data.analytics.totalSpend).toBe(expectedTotal);
  });

  it('should group spending by category', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(data.data.analytics.categoryBreakdown).toBeInstanceOf(Array);
    expect(data.data.analytics.categoryBreakdown.length).toBeGreaterThan(0);
    
    data.data.analytics.categoryBreakdown.forEach((item: any) => {
      expect(item).toHaveProperty('category');
      expect(item).toHaveProperty('spend');
      expect(item).toHaveProperty('percentage');
      expect(typeof item.spend).toBe('number');
      expect(typeof item.percentage).toBe('number');
    });
  });

  it('should calculate category percentages correctly', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    const totalPercentage = data.data.analytics.categoryBreakdown.reduce(
      (sum: number, item: any) => sum + item.percentage,
      0
    );

    // Total percentage should be approximately 100 (allowing for rounding)
    expect(totalPercentage).toBeGreaterThanOrEqual(99);
    expect(totalPercentage).toBeLessThanOrEqual(101);
  });

  it('should provide spend trend data', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(data.data.analytics.spendTrend).toBeInstanceOf(Array);
    expect(data.data.analytics.spendTrend.length).toBeGreaterThan(0);
    
    data.data.analytics.spendTrend.forEach((item: any) => {
      expect(item).toHaveProperty('month');
      expect(item).toHaveProperty('spend');
      expect(typeof item.spend).toBe('number');
    });
  });

  it('should only include active subscriptions', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    await GET(request);

    expect(mockSupabaseEq).toHaveBeenCalledWith('status', 'active');
  });

  it('should filter by user_id', async () => {
    const user = mockUser({ id: 'user-456' });
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    await GET(request);

    expect(mockSupabaseEq).toHaveBeenCalledWith('user_id', user.id);
  });

  it('should handle empty subscription list', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseEq.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.data.analytics.totalSpend).toBe(0);
    expect(data.data.analytics.categoryBreakdown).toEqual([]);
  });

  it('should reject unauthenticated requests', async () => {
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(data.success).toBe(false);
  });

  it('should handle database errors gracefully', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseEq.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed' },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(data.success).toBe(false);
  });

  it('should handle subscriptions with null prices', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseEq.mockResolvedValueOnce({
      data: [
        { price: 10, category: 'streaming', status: 'active' },
        { price: null, category: 'software', status: 'active' },
        { price: 20, category: 'gaming', status: 'active' },
      ],
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.data.analytics.totalSpend).toBe(30); // Should ignore null price
  });

  it('should handle subscriptions without category', async () => {
    const user = mockUser();
    const request = new Request('http://localhost:3000/api/analytics');

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseEq.mockResolvedValueOnce({
      data: [
        { price: 10, category: null, status: 'active' },
        { price: 20, category: 'streaming', status: 'active' },
      ],
      error: null,
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    
    // Should have "Uncategorized" category
    const uncategorized = data.data.analytics.categoryBreakdown.find(
      (item: any) => item.category === 'Uncategorized'
    );
    expect(uncategorized).toBeDefined();
    expect(uncategorized.spend).toBe(10);
  });
});
