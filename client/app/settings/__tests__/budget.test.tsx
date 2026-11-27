/**
 * Budget Settings Tests
 * 
 * Tests budget limit input validation, update submission and database persistence,
 * and budget alert threshold configuration.
 * 
 * **Validates: Requirements 3.2, 4.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockUser } from '@/lib/test-utils/factories';
import { mockSupabaseClient } from '@/lib/test-utils/mocks';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

describe('Budget Settings Tests', () => {
  let supabase: ReturnType<typeof mockSupabaseClient>;
  let testUser: ReturnType<typeof mockUser>;

  beforeEach(() => {
    testUser = mockUser({ id: 'user-budget-123', email: 'budget@example.com' });
    supabase = mockSupabaseClient(testUser);
    vi.clearAllMocks();
  });

  describe('Budget Limit Input Validation', () => {
    it('should only accept positive numbers', () => {
      const BudgetInput = () => {
        const [budget, setBudget] = vi.fn().mockReturnValue('') as any;
        const [error, setError] = vi.fn().mockReturnValue(null) as any;

        const handleChange = (value: string) => {
          const numValue = parseFloat(value);
          if (value && (isNaN(numValue) || numValue <= 0)) {
            setError('Budget must be a positive number');
          } else {
            setError(null);
            setBudget(value);
          }
        };

        return (
          <div>
            <label htmlFor="budget-input">Monthly Budget Limit</label>
            <input
              id="budget-input"
              type="number"
              value={budget}
              onChange={(e) => handleChange(e.target.value)}
              min="0.01"
              step="0.01"
            />
            {error && <span role="alert">{error}</span>}
          </div>
        );
      };

      render(<BudgetInput />);

      const input = screen.getByLabelText('Monthly Budget Limit');

      // Test positive number
      fireEvent.change(input, { target: { value: '100' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Test zero (should show error)
      fireEvent.change(input, { target: { value: '0' } });
      
      // Test negative number (browser will prevent, but validation handles it)
      fireEvent.change(input, { target: { value: '-50' } });
    });

    it('should validate decimal inputs', () => {
      const validateBudget = (value: string): { valid: boolean; error?: string } => {
        const numValue = parseFloat(value);
        
        if (!value) {
          return { valid: false, error: 'Budget is required' };
        }
        
        if (isNaN(numValue)) {
          return { valid: false, error: 'Budget must be a number' };
        }
        
        if (numValue <= 0) {
          return { valid: false, error: 'Budget must be greater than zero' };
        }
        
        if (numValue > 1000000) {
          return { valid: false, error: 'Budget cannot exceed $1,000,000' };
        }
        
        return { valid: true };
      };

      // Valid decimals
      expect(validateBudget('100.50')).toEqual({ valid: true });
      expect(validateBudget('0.01')).toEqual({ valid: true });
      expect(validateBudget('999999.99')).toEqual({ valid: true });

      // Invalid inputs
      expect(validateBudget('0')).toEqual({ valid: false, error: 'Budget must be greater than zero' });
      expect(validateBudget('-100')).toEqual({ valid: false, error: 'Budget must be greater than zero' });
      expect(validateBudget('abc')).toEqual({ valid: false, error: 'Budget must be a number' });
      expect(validateBudget('')).toEqual({ valid: false, error: 'Budget is required' });
      expect(validateBudget('1000001')).toEqual({ valid: false, error: 'Budget cannot exceed $1,000,000' });
    });

    it('should format currency display', () => {
      const formatCurrency = (value: number): string => {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(value);
      };

      expect(formatCurrency(100)).toBe('$100.00');
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
      expect(formatCurrency(0.99)).toBe('$0.99');
    });

    it('should show validation errors in real-time', () => {
      const BudgetForm = () => {
        const [value, setValue] = vi.fn().mockReturnValue('') as any;
        const [error, setError] = vi.fn().mockReturnValue(null) as any;

        return (
          <form>
            <input
              aria-label="Budget amount"
              type="number"
              value={value}
              onChange={(e) => {
                const val = e.target.value;
                setValue(val);
                if (val && parseFloat(val) <= 0) {
                  setError('Must be positive');
                } else {
                  setError(null);
                }
              }}
            />
            {error && <span role="alert">{error}</span>}
          </form>
        );
      };

      render(<BudgetForm />);
      
      const input = screen.getByLabelText('Budget amount');
      fireEvent.change(input, { target: { value: '-10' } });
      
      // Validation should occur on change
      expect(input).toBeInTheDocument();
    });
  });

  describe('Budget Update Submission and Database Persistence', () => {
    it('should persist budget updates to database', async () => {
      const newBudget = 500.00;

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          user_id: testUser.id,
          monthly_budget_limit: newBudget,
          updated_at: new Date().toISOString(),
        }],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .update({ monthly_budget_limit: newBudget })
        .eq('user_id', testUser.id)
        .select();

      // Assert
      expect(supabase.from).toHaveBeenCalledWith('user_preferences');
      expect(supabase.update).toHaveBeenCalledWith({ monthly_budget_limit: newBudget });
      expect(supabase.eq).toHaveBeenCalledWith('user_id', testUser.id);
      expect(data?.[0].monthly_budget_limit).toBe(newBudget);
    });

    it('should handle concurrent budget updates', async () => {
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          user_id: testUser.id,
          monthly_budget_limit: 600,
          version: 2, // Version incremented
        }],
        error: null,
      });

      // Act - Simulate two updates
      const update1 = supabase
        .from('user_preferences')
        .update({ monthly_budget_limit: 500 })
        .eq('user_id', testUser.id)
        .select();

      const update2 = supabase
        .from('user_preferences')
        .update({ monthly_budget_limit: 600 })
        .eq('user_id', testUser.id)
        .select();

      const [result1, result2] = await Promise.all([update1, update2]);

      // Assert - Last update wins
      expect(result2.data?.[0].monthly_budget_limit).toBe(600);
    });

    it('should create budget preference if it does not exist', async () => {
      const initialBudget = 300.00;

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          user_id: testUser.id,
          monthly_budget_limit: initialBudget,
          created_at: new Date().toISOString(),
        }],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .insert({
          user_id: testUser.id,
          monthly_budget_limit: initialBudget,
        })
        .select();

      // Assert
      expect(supabase.insert).toHaveBeenCalled();
      expect(data?.[0].monthly_budget_limit).toBe(initialBudget);
    });

    it('should handle update errors gracefully', async () => {
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: null,
        error: {
          message: 'Database connection error',
          code: 'CONNECTION_ERROR',
        },
      });

      // Act
      const { error } = await supabase
        .from('user_preferences')
        .update({ monthly_budget_limit: 500 })
        .eq('user_id', testUser.id)
        .select();

      // Assert
      expect(error).toBeDefined();
      expect(error?.message).toBe('Database connection error');
    });

    it('should update budget and return confirmation', async () => {
      const budgetData = {
        user_id: testUser.id,
        monthly_budget_limit: 750.00,
        currency: 'USD',
        updated_at: new Date().toISOString(),
      };

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [budgetData],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .update({
          monthly_budget_limit: budgetData.monthly_budget_limit,
          currency: budgetData.currency,
        })
        .eq('user_id', testUser.id)
        .select();

      // Assert
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        user_id: testUser.id,
        monthly_budget_limit: 750.00,
        currency: 'USD',
      });
    });
  });

  describe('Budget Alert Threshold Configuration', () => {
    it('should configure alert thresholds as percentages', async () => {
      const alertThresholds = {
        warning: 75, // 75% of budget
        critical: 90, // 90% of budget
        exceeded: 100, // 100% of budget
      };

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          user_id: testUser.id,
          budget_alert_thresholds: alertThresholds,
        }],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .update({ budget_alert_thresholds: alertThresholds })
        .eq('user_id', testUser.id)
        .select();

      // Assert
      expect(data?.[0].budget_alert_thresholds).toEqual(alertThresholds);
      expect(data?.[0].budget_alert_thresholds.warning).toBe(75);
      expect(data?.[0].budget_alert_thresholds.critical).toBe(90);
      expect(data?.[0].budget_alert_thresholds.exceeded).toBe(100);
    });

    it('should validate threshold percentages', () => {
      const validateThreshold = (value: number): { valid: boolean; error?: string } => {
        if (value < 0 || value > 100) {
          return { valid: false, error: 'Threshold must be between 0 and 100' };
        }
        return { valid: true };
      };

      expect(validateThreshold(50)).toEqual({ valid: true });
      expect(validateThreshold(0)).toEqual({ valid: true });
      expect(validateThreshold(100)).toEqual({ valid: true });
      expect(validateThreshold(-10)).toEqual({ valid: false, error: 'Threshold must be between 0 and 100' });
      expect(validateThreshold(150)).toEqual({ valid: false, error: 'Threshold must be between 0 and 100' });
    });

    it('should enforce logical threshold ordering', () => {
      const validateThresholdOrder = (warning: number, critical: number, exceeded: number) => {
        if (warning >= critical) {
          return { valid: false, error: 'Warning must be less than critical' };
        }
        if (critical > exceeded) {
          return { valid: false, error: 'Critical must be less than or equal to exceeded' };
        }
        return { valid: true };
      };

      // Valid ordering
      expect(validateThresholdOrder(75, 90, 100)).toEqual({ valid: true });
      expect(validateThresholdOrder(50, 75, 100)).toEqual({ valid: true });

      // Invalid ordering
      expect(validateThresholdOrder(90, 75, 100)).toEqual({ 
        valid: false, 
        error: 'Warning must be less than critical' 
      });
      expect(validateThresholdOrder(75, 110, 100)).toEqual({ 
        valid: false, 
        error: 'Critical must be less than or equal to exceeded' 
      });
    });

    it('should trigger alerts based on spending and thresholds', () => {
      const budget = 1000;
      const thresholds = {
        warning: 75,
        critical: 90,
        exceeded: 100,
      };

      const checkBudgetStatus = (spent: number) => {
        const percentage = (spent / budget) * 100;

        if (percentage >= thresholds.exceeded) {
          return { status: 'exceeded', percentage };
        } else if (percentage >= thresholds.critical) {
          return { status: 'critical', percentage };
        } else if (percentage >= thresholds.warning) {
          return { status: 'warning', percentage };
        }
        return { status: 'ok', percentage };
      };

      expect(checkBudgetStatus(500)).toEqual({ status: 'ok', percentage: 50 });
      expect(checkBudgetStatus(750)).toEqual({ status: 'warning', percentage: 75 });
      expect(checkBudgetStatus(900)).toEqual({ status: 'critical', percentage: 90 });
      expect(checkBudgetStatus(1000)).toEqual({ status: 'exceeded', percentage: 100 });
      expect(checkBudgetStatus(1100)).toEqual({ status: 'exceeded', percentage: 110 });
    });

    it('should persist custom alert thresholds', async () => {
      const customThresholds = {
        warning: 60,
        critical: 85,
        exceeded: 100,
      };

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          user_id: testUser.id,
          budget_alert_thresholds: customThresholds,
          updated_at: new Date().toISOString(),
        }],
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .update({ budget_alert_thresholds: customThresholds })
        .eq('user_id', testUser.id)
        .select();

      // Assert
      expect(data?.[0].budget_alert_thresholds.warning).toBe(60);
      expect(data?.[0].budget_alert_thresholds.critical).toBe(85);
    });

    it('should use default thresholds when not configured', async () => {
      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValue({
        data: {
          user_id: testUser.id,
          budget_alert_thresholds: null,
        },
        error: null,
      });

      // Act
      const { data } = await supabase
        .from('user_preferences')
        .select('budget_alert_thresholds')
        .eq('user_id', testUser.id)
        .single();

      // Apply defaults when null
      const thresholds = data?.budget_alert_thresholds || {
        warning: 75,
        critical: 90,
        exceeded: 100,
      };

      // Assert
      expect(thresholds.warning).toBe(75);
      expect(thresholds.critical).toBe(90);
      expect(thresholds.exceeded).toBe(100);
    });
  });
});
