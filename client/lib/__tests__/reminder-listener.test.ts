import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onReminder,
  registerReminderServiceWorker,
  type ReminderEvent,
} from '@/lib/reminder-listener';

describe('Reminder listener', () => {
  const mockRegister = vi.fn();
  const mockAddEventListener = vi.fn();
  const mockRemoveEventListener = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      serviceWorker: {
        register: mockRegister,
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the reminder service worker when supported', async () => {
    const fakeRegistration = {} as ServiceWorkerRegistration;
    mockRegister.mockResolvedValueOnce(fakeRegistration);

    const registration = await registerReminderServiceWorker('/reminder-sw.js');

    expect(mockRegister).toHaveBeenCalledWith('/reminder-sw.js');
    expect(registration).toBe(fakeRegistration);
  });

  it('throws when service workers are not supported', async () => {
    const nav = { ...globalThis.navigator } as any;
    delete nav.serviceWorker;
    vi.stubGlobal('navigator', nav);

    await expect(registerReminderServiceWorker('/reminder-sw.js')).rejects.toThrow(
      'Service workers are not supported in this browser'
    );
  });

  it('returns a no-op unsubscribe when reminder listeners are unavailable', () => {
    const nav = { ...globalThis.navigator } as any;
    delete nav.serviceWorker;
    vi.stubGlobal('navigator', nav);

    const callback = vi.fn();
    const unsubscribe = onReminder(callback);

    unsubscribe();
    expect(callback).not.toHaveBeenCalled();
  });

  it('forwards only valid renewal reminder messages and cleans up listeners', () => {
    const eventHandlers: Record<string, (event: MessageEvent) => void> = {};

    mockAddEventListener.mockImplementation((eventName, handler) => {
      eventHandlers[eventName as string] = handler as (event: MessageEvent) => void;
    });

    mockRemoveEventListener.mockImplementation((eventName, handler) => {
      if (eventHandlers[eventName as string] === handler) {
        delete eventHandlers[eventName as string];
      }
    });

    const callback = vi.fn();
    const unsubscribe = onReminder(callback);

    expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    const validPayload: ReminderEvent = {
      subscriptionId: 'sub_123',
      renewalDate: '2025-01-01',
      reminderType: 'renewal',
    };

    eventHandlers.message?.({
      data: {
        type: 'SYNCRO_REMINDER',
        payload: validPayload,
      },
    } as MessageEvent);

    expect(callback).toHaveBeenCalledWith(validPayload);

    callback.mockClear();
    eventHandlers.message?.({
      data: {
        type: 'SYNCRO_REMINDER',
        payload: {
          ...validPayload,
          reminderType: 'trial_expiry',
        },
      },
    } as MessageEvent);

    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
    expect(mockRemoveEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });
});
