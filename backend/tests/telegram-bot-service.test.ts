/**
 * Telegram Bot Service Tests
 * Tests for Telegram notification delivery
 */

import { TelegramBotService } from '../src/services/telegram-bot-service';
import { NotificationPayload } from '../src/types/reminder';

// Mock fetch globally
(global as any).fetch = jest.fn();

describe('TelegramBotService', () => {
    let service: TelegramBotService;
    const mockBotToken = 'test-bot-token-123';
    const mockChatId = '123456789';
    const mockUserId = 'user-123';

    beforeEach(() => {
        jest.clearAllMocks();
        service = new TelegramBotService({ botToken: mockBotToken });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });


    describe('Configuration', () => {
        it('should be configured with bot token', () => {
            expect(service.isConfigured()).toBe(true);
        });

        it('should not be configured without bot token', () => {
            const unconfiguredService = new TelegramBotService();
            expect(unconfiguredService.isConfigured()).toBe(false);
        });

        it('should verify connection successfully', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: {
                        id: 123456,
                        username: 'test_bot',
                        first_name: 'Test Bot',
                    },
                }),
            });

            const result = await service.verifyConnection();
            expect(result).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/getMe')
            );
        });

        it('should handle connection verification failure', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: false,
                    description: 'Unauthorized',
                }),
            });

            const result = await service.verifyConnection();
            expect(result).toBe(false);
        });

        it('should handle network errors during verification', async () => {
            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            const result = await service.verifyConnection();
            expect(result).toBe(false);
        });
    });

    describe('Send Renewal Reminder', () => {
        const mockPayload: NotificationPayload = {
            title: 'Renewal Reminder',
            body: 'Your subscription renews soon',
            subscription: {
                id: 'sub-123',
                user_id: mockUserId,
                name: 'Netflix',
                category: 'Streaming',
                price: 15.99,
                billing_cycle: 'monthly',
                status: 'active',
                provider: 'Netflix',
                renewal_url: 'https://netflix.com/account',
                is_trial: false,
                trial_ends_at: null,
                trial_converts_to_price: null,
                credit_card_required: false,
                website_url: 'https://netflix.com',
                email_account_id: null,
                merchant_id: null,
                logo_url: null,
                notes: null,
                tags: [],
                expired_at: null,
                active_until: null,
                next_billing_date: '2026-05-27',
                created_at: '2026-01-01',
                updated_at: '2026-04-27',
            },
            reminderType: 'renewal',
            daysBefore: 3,
            renewalDate: '2026-05-27',
            priority: 'normal',
        };

        it('should send renewal reminder successfully', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: {
                        message_id: 12345,
                        chat: { id: mockChatId },
                        text: 'Test message',
                    },
                }),
            });

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId
            );

            expect(result.success).toBe(true);
            expect(result.metadata?.messageId).toBe(12345);
            expect(result.metadata?.chatId).toBe(mockChatId);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/sendMessage'),
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );
        });

        it('should format trial expiry message correctly', async () => {
            const trialPayload: NotificationPayload = {
                ...mockPayload,
                reminderType: 'trial_expiry',
                daysBefore: 1,
                subscription: {
                    ...mockPayload.subscription,
                    is_trial: true,
                    trial_ends_at: '2026-05-27',
                    trial_converts_to_price: 19.99,
                    credit_card_required: true,
                },
            };

            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            const result = await service.sendRenewalReminder(
                mockUserId,
                trialPayload,
                mockChatId
            );

            expect(result.success).toBe(true);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.text).toContain('Trial Ending');
            expect(body.text).toContain('$19.99');
        });

        it('should include inline keyboard buttons', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendRenewalReminder(mockUserId, mockPayload, mockChatId);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.reply_markup).toBeDefined();
            expect(body.reply_markup.inline_keyboard).toBeDefined();
            expect(body.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
        });

        it('should handle missing chat ID gracefully', async () => {
            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload
                // No chatId provided
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('not connected Telegram');
            expect(result.metadata?.retryable).toBe(false);
        });

        it('should handle bot blocked by user error', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: false,
                    error_code: 403,
                    description: 'Forbidden: bot was blocked by the user',
                }),
            });

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('bot was blocked');
            expect(result.metadata?.retryable).toBe(false);
        });

        it('should handle rate limit errors as retryable', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: false,
                    error_code: 429,
                    description: 'Too Many Requests: retry after 30',
                }),
            });

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId,
                { maxAttempts: 1 } // Limit attempts for test
            );

            expect(result.success).toBe(false);
            expect(result.metadata?.retryable).toBe(true);
        });

        it('should retry on retryable errors', async () => {
            // First attempt fails with retryable error
            (global.fetch as any)
                .mockResolvedValueOnce({
                    json: async () => ({
                        ok: false,
                        error_code: 500,
                        description: 'Internal Server Error',
                    }),
                })
                // Second attempt succeeds
                .mockResolvedValueOnce({
                    json: async () => ({
                        ok: true,
                        result: { message_id: 12345, chat: { id: mockChatId } },
                    }),
                });

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId,
                { maxAttempts: 2 }
            );

            expect(result.success).toBe(true);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('should not send when service is not configured', async () => {
            const unconfiguredService = new TelegramBotService();

            const result = await unconfiguredService.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
            expect(result.metadata?.retryable).toBe(false);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('Send Simple Message', () => {
        it('should send simple message successfully', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            const result = await service.sendSimpleMessage(
                mockUserId,
                'Test message',
                mockChatId
            );

            expect(result.success).toBe(true);
            expect(result.metadata?.messageId).toBe(12345);
        });

        it('should handle HTML formatting', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendSimpleMessage(
                mockUserId,
                '<b>Bold</b> text',
                mockChatId
            );

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.parse_mode).toBe('HTML');
            expect(body.text).toContain('<b>Bold</b>');
        });
    });

    describe('Send Risk Alert', () => {
        const riskPayload = {
            subscriptionName: 'Netflix',
            riskFactors: [
                {
                    factor_type: 'consecutive_failures',
                    details: { count: 3 },
                },
                {
                    factor_type: 'balance_projection',
                    details: {},
                },
            ],
            renewalDate: '2026-05-27',
            recommendedAction: 'Update payment method',
        };

        it('should send risk alert successfully', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            const result = await service.sendRiskAlert(
                mockUserId,
                riskPayload,
                mockChatId
            );

            expect(result.success).toBe(true);
            expect(result.metadata?.messageId).toBe(12345);
        });

        it('should format risk factors correctly', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendRiskAlert(mockUserId, riskPayload, mockChatId);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.text).toContain('Risk Alert');
            expect(body.text).toContain('3 consecutive payment failures');
            expect(body.text).toContain('Insufficient projected balance');
            expect(body.text).toContain('Update payment method');
        });

        it('should include review button', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendRiskAlert(mockUserId, riskPayload, mockChatId);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.reply_markup).toBeDefined();
            expect(body.reply_markup.inline_keyboard[0][0].text).toContain('Review');
        });
    });

    describe('Error Handling', () => {
        it('should handle network errors', async () => {
            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            const mockPayload: NotificationPayload = {
                title: 'Test',
                body: 'Test',
                subscription: {} as any,
                reminderType: 'renewal',
                daysBefore: 3,
                renewalDate: '2026-05-27',
            };

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId,
                { maxAttempts: 1 }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
        });

        it('should handle invalid JSON responses', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => {
                    throw new Error('Invalid JSON');
                },
            });

            const mockPayload: NotificationPayload = {
                title: 'Test',
                body: 'Test',
                subscription: {} as any,
                reminderType: 'renewal',
                daysBefore: 3,
                renewalDate: '2026-05-27',
            };

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId,
                { maxAttempts: 1 }
            );

            expect(result.success).toBe(false);
        });

        it('should handle chat not found error', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: false,
                    error_code: 400,
                    description: 'Bad Request: chat not found',
                }),
            });

            const mockPayload: NotificationPayload = {
                title: 'Test',
                body: 'Test',
                subscription: {} as any,
                reminderType: 'renewal',
                daysBefore: 3,
                renewalDate: '2026-05-27',
            };

            const result = await service.sendRenewalReminder(
                mockUserId,
                mockPayload,
                mockChatId,
                { maxAttempts: 1 }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('chat not found');
            expect(result.metadata?.retryable).toBe(false);
        });
    });

    describe('Message Formatting', () => {
        it('should format renewal message with all details', async () => {
            const payload: NotificationPayload = {
                title: 'Renewal',
                body: 'Test',
                subscription: {
                    id: 'sub-123',
                    user_id: mockUserId,
                    name: 'Spotify Premium',
                    category: 'Music',
                    price: 9.99,
                    billing_cycle: 'monthly',
                    status: 'active',
                    provider: 'Spotify',
                    renewal_url: 'https://spotify.com/account',
                    is_trial: false,
                    trial_ends_at: null,
                    trial_converts_to_price: null,
                    credit_card_required: false,
                    website_url: 'https://spotify.com',
                    email_account_id: null,
                    merchant_id: null,
                    logo_url: null,
                    notes: null,
                    tags: [],
                    expired_at: null,
                    active_until: null,
                    next_billing_date: '2026-05-27',
                    created_at: '2026-01-01',
                    updated_at: '2026-04-27',
                },
                reminderType: 'renewal',
                daysBefore: 7,
                renewalDate: '2026-05-27',
            };

            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendRenewalReminder(mockUserId, payload, mockChatId);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            const message = body.text;

            expect(message).toContain('Spotify Premium');
            expect(message).toContain('Music');
            expect(message).toContain('$9.99/monthly');
            expect(message).toContain('7');
        });

        it('should use appropriate emoji for urgency', async () => {
            const urgentPayload: NotificationPayload = {
                title: 'Urgent',
                body: 'Test',
                subscription: {} as any,
                reminderType: 'renewal',
                daysBefore: 0,
                renewalDate: '2026-04-27',
            };

            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    result: { message_id: 12345, chat: { id: mockChatId } },
                }),
            });

            await service.sendRenewalReminder(mockUserId, urgentPayload, mockChatId);

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.text).toContain('🔔');
            expect(body.text).toContain('TODAY');
        });
    });
});
