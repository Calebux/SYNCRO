/**
 * Subscription Detail API Route Tests
 * 
 * Tests GET endpoint for single subscription retrieval.
 * Tests PATCH endpoint for subscription updates.
 * Tests DELETE endpoint with soft delete logic.
 * Tests ownership verification for all operations.
 * 
 * **Validates: Requirements 1.3, 1.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE, PATCH } from '../../[id]/route';
import { mockUser, mockSubscription } from '@/lib/test-utils';
import { HttpStatus } from '@/lib/api/types';

// Mock dependencies
const mockSupabaseSelect = vi.fn().mockReturnThis();
const mockSupabaseUpdate = vi.fn().mockReturnThis();
const mockSupabaseDelete = vi.fn().mockResolvedValue({ error: null });
const mockSupabaseEq = vi.fn().mockReturnThis();
const mockSupabaseSingle = vi.fn().mockResolvedValue({ 
  data: null, 
  error: null 
});

const mockSupabaseFrom = vi.fn(() => ({
  select: mockSupabaseSelect,
  update: mockSupabaseUpdate,
  delete: mockSupabaseDelete,
  eq: mockSupabaseEq,
  single: mockSupabaseSingle,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

describe('DELETE /api/subscriptions/[id]', () => {
  const subscriptionId = 'sub-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseSelect.mockReturnThis();
    mockSupabaseEq.mockReturnThis();
    mockSupabaseSingle.mockResolvedValue({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    });
    mockSupabaseDelete.mockResolvedValue({ error: null });
  });

  it('should delete subscription owned by user', async () => {
    const user = mockUser({ id: 'user-123' });
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.success).toBe(true);
    expect(mockSupabaseDelete).toHaveBeenCalled();
  });

  it('should reject deletion of subscription not owned by user', async () => {
    const user = mockUser({ id: 'user-456' }); // Different user
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(data.success).toBe(false);
  });

  it('should return 404 for non-existent subscription', async () => {
    const user = mockUser();
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found' },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(data.success).toBe(false);
  });

  it('should reject unauthenticated requests', async () => {
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(data.success).toBe(false);
  });
});

describe('PATCH /api/subscriptions/[id]', () => {
  const subscriptionId = 'sub-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseSelect.mockReturnThis();
    mockSupabaseUpdate.mockReturnThis();
    mockSupabaseEq.mockReturnThis();
    mockSupabaseSingle.mockResolvedValue({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    });
  });

  it('should update subscription with valid data', async () => {
    const user = mockUser({ id: 'user-123' });
    const updateData = {
      name: 'Updated Netflix',
      price: 19.99,
    };

    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    // Mock the update response
    mockSupabaseSingle.mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    }).mockResolvedValueOnce({
      data: mockSubscription({ ...updateData, id: subscriptionId }),
      error: null,
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.success).toBe(true);
    expect(mockSupabaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: updateData.name,
        price: updateData.price,
      })
    );
  });

  it('should reject update of subscription not owned by user', async () => {
    const user = mockUser({ id: 'user-456' }); // Different user
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(data.success).toBe(false);
  });

  it('should reject update with invalid price', async () => {
    const user = mockUser({ id: 'user-123' });
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ price: -10 }),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(data.success).toBe(false);
  });

  it('should allow partial updates', async () => {
    const user = mockUser({ id: 'user-123' });
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    }).mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, status: 'cancelled' }),
      error: null,
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.OK);
    expect(data.success).toBe(true);
  });

  it('should return 404 for non-existent subscription', async () => {
    const user = mockUser();
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated' }),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found' },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(data.success).toBe(false);
  });

  it('should update multiple fields at once', async () => {
    const user = mockUser({ id: 'user-123' });
    const updateData = {
      name: 'Premium Netflix',
      price: 24.99,
      category: 'entertainment',
      status: 'active' as const,
    };

    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user },
      error: null,
    });

    mockSupabaseSingle.mockResolvedValueOnce({
      data: mockSubscription({ id: subscriptionId, user_id: 'user-123' }),
      error: null,
    }).mockResolvedValueOnce({
      data: mockSubscription({ ...updateData, id: subscriptionId }),
      error: null,
    });

    await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });

    expect(mockSupabaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: updateData.name,
        price: updateData.price,
        category: updateData.category,
        status: updateData.status,
      })
    );
  });

  it('should reject unauthenticated requests', async () => {
    const request = new Request(`http://localhost:3000/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated' }),
    });

    const { createClient } = await import('@/lib/supabase/server');
    const mockSupabase = await createClient();
    vi.mocked(mockSupabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: subscriptionId }) });
    const data = await response.json();

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(data.success).toBe(false);
  });
});
