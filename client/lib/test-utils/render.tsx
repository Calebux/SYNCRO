/**
 * Render helpers for React component testing
 * 
 * Provides wrapper functions to render components with necessary providers
 * (auth, theme, query client, etc.) for realistic testing scenarios.
 * 
 * @example
 * const { user } = renderWithAuth(<MyComponent />);
 * await user.click(screen.getByRole('button'));
 * 
 * @example
 * renderWithProviders(<MyComponent />, { theme: 'dark' });
 */

import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { MockUser } from './factories';
import { mockUser } from './factories';

/**
 * Mock auth context value
 */
interface MockAuthContext {
  user: MockUser | null;
  signIn: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  loading: boolean;
  error: Error | null;
}

/**
 * Creates a mock auth context
 */
export const createMockAuthContext = (user?: MockUser | null): MockAuthContext => ({
  user: user === null ? null : (user || mockUser()),
  signIn: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn().mockResolvedValue({ error: null }),
  loading: false,
  error: null,
});

/**
 * Renders a component with authentication context
 * 
 * @param ui - The React component to render
 * @param user - Optional mock user (defaults to authenticated user)
 * @param options - Additional render options
 * 
 * @example
 * const { user } = renderWithAuth(<ProtectedComponent />);
 * await user.click(screen.getByRole('button'));
 */
export const renderWithAuth = (
  ui: ReactElement,
  user?: MockUser | null,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  const mockAuthContext = createMockAuthContext(user);

  // Create a simple wrapper that provides auth context
  // Note: In a real app, you'd import your actual AuthProvider
  // For now, we'll mock it with a simple context provider
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    // Mock implementation - replace with actual AuthProvider in real tests
    return <div data-testid="auth-wrapper">{children}</div>;
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    user: userEvent.setup(),
    mockAuthContext,
  };
};

/**
 * Theme options for testing
 */
type Theme = 'light' | 'dark' | 'system';

/**
 * Renders a component with all necessary providers (theme, query client, etc.)
 * 
 * @param ui - The React component to render
 * @param options - Render options including theme
 * 
 * @example
 * renderWithProviders(<MyComponent />, { theme: 'dark' });
 */
export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    theme?: Theme;
    initialQueryData?: Record<string, unknown>;
  }
) => {
  const { theme = 'light', initialQueryData, ...renderOptions } = options || {};

  // Create a wrapper with all providers
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return (
      <div data-testid="providers-wrapper" data-theme={theme}>
        {children}
      </div>
    );
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
  };
};

/**
 * Renders a component with both auth and providers
 * 
 * @param ui - The React component to render
 * @param user - Optional mock user
 * @param options - Additional render options
 * 
 * @example
 * const { user } = renderWithAuthAndProviders(<Dashboard />);
 * await user.type(screen.getByRole('textbox'), 'test');
 */
export const renderWithAuthAndProviders = (
  ui: ReactElement,
  user?: MockUser | null,
  options?: Omit<RenderOptions, 'wrapper'> & {
    theme?: Theme;
  }
) => {
  const { theme = 'light', ...renderOptions } = options || {};
  const mockAuthContext = createMockAuthContext(user);

  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return (
      <div data-testid="auth-providers-wrapper" data-theme={theme}>
        {children}
      </div>
    );
  };

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
    mockAuthContext,
  };
};

/**
 * Waits for loading states to complete
 * 
 * @example
 * renderWithProviders(<AsyncComponent />);
 * await waitForLoadingToFinish();
 * expect(screen.getByText('Loaded')).toBeInTheDocument();
 */
export const waitForLoadingToFinish = async () => {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => {
    const loadingElements = document.querySelectorAll('[data-loading="true"]');
    expect(loadingElements.length).toBe(0);
  });
};

/**
 * Simulates a user typing with realistic delays
 * 
 * @example
 * const user = userEvent.setup();
 * await typeWithDelay(user, screen.getByRole('textbox'), 'Hello World');
 */
export const typeWithDelay = async (
  user: ReturnType<typeof userEvent.setup>,
  element: HTMLElement,
  text: string,
  delay: number = 50
) => {
  await user.type(element, text, { delay });
};

/**
 * Simulates form submission
 * 
 * @example
 * await submitForm(user, screen.getByRole('form'));
 */
export const submitForm = async (
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement
) => {
  const submitButton = form.querySelector('button[type="submit"]') as HTMLElement;
  if (submitButton) {
    await user.click(submitButton);
  } else {
    throw new Error('No submit button found in form');
  }
};

/**
 * Waits for an element to be removed from the DOM
 * 
 * @example
 * await waitForElementToBeRemoved(() => screen.getByText('Loading...'));
 */
export const waitForElementToBeRemoved = async (callback: () => HTMLElement) => {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => {
    expect(callback).toThrow();
  });
};
