/**
 * CSP Monitoring Service
 * 
 * Handles Content Security Policy violation monitoring, aggregation, and alerting.
 * Integrates with Sentry for real-time alerts and provides database persistence
 * for historical analysis and trend detection.
 */

import * as Sentry from '@sentry/node';
import { supabase, trackDbRequest } from '../config/database';
import logger from '../config/logger';

/**
 * CSP Violation Report structure from browser
 */
export interface CspViolationReport {
    'document-uri': string;
    'violated-directive': string;
    'blocked-uri'?: string;
    'source-file'?: string;
    'line-number'?: number;
    'column-number'?: number;
    'disposition'?: 'enforce' | 'report';
    'status-code'?: number;
    'script-sample'?: string;
}

/**
 * Request context for CSP violation
 */
export interface CspViolationContext {
    userAgent?: string;
    ipAddress?: string;
    referer?: string;
    userId?: string;
}

/**
 * Aggregated violation statistics
 */
export interface CspViolationStats {
    violation_signature: string;
    violated_directive: string;
    blocked_uri: string | null;
    disposition: string | null;
    occurrence_count: number;
    affected_users: number;
    affected_ips: number;
    first_seen: string;
    last_seen: string;
    count_24h: number;
    count_1h: number;
}

/**
 * Browser extension URI prefixes that are known false positives
 */
const EXTENSION_PATTERNS = [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension://',
    'ms-browser-extension://',
];

function isExtensionFalsePositive(blockedUri?: string): boolean {
    if (!blockedUri) return false;
    return EXTENSION_PATTERNS.some((p) => blockedUri.startsWith(p));
}

/**
 * Alert thresholds for CSP violations
 */
const ALERT_THRESHOLDS = {
    // Alert if a single violation type occurs more than this many times per hour
    HOURLY_RATE: parseInt(process.env.CSP_ALERT_HOURLY_RATE || '100', 10),

    // Alert if a violation affects more than this many unique users
    AFFECTED_USERS: parseInt(process.env.CSP_ALERT_AFFECTED_USERS || '50', 10),

    // Alert if a new violation type appears (first seen in last 5 minutes)
    NEW_VIOLATION_WINDOW_MS: 5 * 60 * 1000,
};

/**
 * Persist a CSP violation to the database
 */
export async function persistCspViolation(
    report: CspViolationReport,
    context: CspViolationContext
): Promise<{ success: boolean; error?: string }> {
    // Skip false positives from browser extensions before hitting the database
    if (isExtensionFalsePositive(report['blocked-uri'])) {
        return { success: true };
    }

    const release = trackDbRequest();

    try {
        const { error } = await supabase
            .from('csp_violations')
            .insert({
                document_uri: report['document-uri'],
                violated_directive: report['violated-directive'],
                blocked_uri: report['blocked-uri'] || null,
                source_file: report['source-file'] || null,
                line_number: report['line-number'] || null,
                column_number: report['column-number'] || null,
                disposition: report['disposition'] || null,
                status_code: report['status-code'] || null,
                script_sample: report['script-sample'] || null,
                user_agent: context.userAgent || null,
                ip_address: context.ipAddress || null,
                referer: context.referer || null,
                user_id: context.userId || null,
            });

        if (error) {
            logger.error('Failed to persist CSP violation to database', { error });
            return { success: false, error: error.message };
        }

        logger.info('CSP violation persisted to database', {
            directive: report['violated-directive'],
            blockedUri: report['blocked-uri'],
            disposition: report['disposition'],
        });

        return { success: true };
    } catch (error) {
        logger.error('Exception while persisting CSP violation', { error });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    } finally {
        release();
    }
}

/**
 * Send CSP violation to Sentry for real-time monitoring
 */
export function reportToSentry(
    report: CspViolationReport,
    context: CspViolationContext
): void {
    try {
        // Create a descriptive message for the violation
        const message = `CSP Violation: ${report['violated-directive']} blocked ${report['blocked-uri'] || 'inline/eval'}`;

        // Capture as a message with appropriate level
        Sentry.captureMessage(message, {
            level: report['disposition'] === 'enforce' ? 'error' : 'warning',
            tags: {
                csp_directive: report['violated-directive'],
                csp_disposition: report['disposition'] || 'unknown',
                csp_blocked_uri: report['blocked-uri'] || 'none',
            },
            contexts: {
                csp: {
                    document_uri: report['document-uri'],
                    violated_directive: report['violated-directive'],
                    blocked_uri: report['blocked-uri'],
                    source_file: report['source-file'],
                    line_number: report['line-number'],
                    column_number: report['column-number'],
                    disposition: report['disposition'],
                    status_code: report['status-code'],
                },
                request: {
                    user_agent: context.userAgent,
                    ip_address: context.ipAddress,
                    referer: context.referer,
                },
            },
            user: context.userId ? { id: context.userId } : undefined,
        });

        logger.debug('CSP violation reported to Sentry', {
            directive: report['violated-directive'],
            blockedUri: report['blocked-uri'],
        });
    } catch (error) {
        logger.error('Failed to report CSP violation to Sentry', { error });
    }
}

/**
 * Get aggregated CSP violation statistics
 */
export async function getCspViolationStats(
    options: {
        limit?: number;
        minOccurrences?: number;
        directive?: string;
    } = {}
): Promise<CspViolationStats[]> {
    const release = trackDbRequest();

    try {
        let query = supabase
            .from('csp_violation_stats')
            .select('*')
            .order('occurrence_count', { ascending: false });

        if (options.minOccurrences) {
            query = query.gte('occurrence_count', options.minOccurrences);
        }

        if (options.directive) {
            query = query.eq('violated_directive', options.directive);
        }

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            logger.error('Failed to fetch CSP violation stats', { error });
            return [];
        }

        return data || [];
    } catch (error) {
        logger.error('Exception while fetching CSP violation stats', { error });
        return [];
    } finally {
        release();
    }
}

/**
 * Refresh the materialized view for CSP violation statistics
 * Should be called periodically (e.g., via cron job every 5 minutes)
 */
export async function refreshCspViolationStats(): Promise<boolean> {
    const release = trackDbRequest();

    try {
        const { error } = await supabase.rpc('refresh_csp_violation_stats');

        if (error) {
            logger.error('Failed to refresh CSP violation stats', { error });
            return false;
        }

        logger.info('CSP violation stats refreshed successfully');
        return true;
    } catch (error) {
        logger.error('Exception while refreshing CSP violation stats', { error });
        return false;
    } finally {
        release();
    }
}

/**
 * Check for alert conditions and send notifications
 */
export async function checkCspAlerts(): Promise<void> {
    try {
        const stats = await getCspViolationStats({ minOccurrences: 1 });
        const now = Date.now();

        for (const stat of stats) {
            // Check for high hourly rate
            if (stat.count_1h >= ALERT_THRESHOLDS.HOURLY_RATE) {
                const message = `High CSP violation rate: ${stat.violated_directive} (${stat.count_1h} violations in last hour)`;

                Sentry.captureMessage(message, {
                    level: 'error',
                    tags: {
                        alert_type: 'high_rate',
                        csp_directive: stat.violated_directive,
                        csp_blocked_uri: stat.blocked_uri || 'none',
                    },
                    contexts: {
                        alert: {
                            violation_signature: stat.violation_signature,
                            hourly_count: stat.count_1h,
                            threshold: ALERT_THRESHOLDS.HOURLY_RATE,
                            affected_users: stat.affected_users,
                            affected_ips: stat.affected_ips,
                        },
                    },
                });

                logger.warn(message, {
                    violationSignature: stat.violation_signature,
                    hourlyCount: stat.count_1h,
                    threshold: ALERT_THRESHOLDS.HOURLY_RATE,
                });
            }

            // Check for high user impact
            if (stat.affected_users >= ALERT_THRESHOLDS.AFFECTED_USERS) {
                const message = `CSP violation affecting many users: ${stat.violated_directive} (${stat.affected_users} users)`;

                Sentry.captureMessage(message, {
                    level: 'error',
                    tags: {
                        alert_type: 'high_user_impact',
                        csp_directive: stat.violated_directive,
                        csp_blocked_uri: stat.blocked_uri || 'none',
                    },
                    contexts: {
                        alert: {
                            violation_signature: stat.violation_signature,
                            affected_users: stat.affected_users,
                            threshold: ALERT_THRESHOLDS.AFFECTED_USERS,
                            total_occurrences: stat.occurrence_count,
                        },
                    },
                });

                logger.warn(message, {
                    violationSignature: stat.violation_signature,
                    affectedUsers: stat.affected_users,
                    threshold: ALERT_THRESHOLDS.AFFECTED_USERS,
                });
            }

            // Check for new violation types
            const firstSeenTime = new Date(stat.first_seen).getTime();
            if (now - firstSeenTime < ALERT_THRESHOLDS.NEW_VIOLATION_WINDOW_MS) {
                const message = `New CSP violation detected: ${stat.violated_directive}`;

                Sentry.captureMessage(message, {
                    level: 'warning',
                    tags: {
                        alert_type: 'new_violation',
                        csp_directive: stat.violated_directive,
                        csp_blocked_uri: stat.blocked_uri || 'none',
                    },
                    contexts: {
                        alert: {
                            violation_signature: stat.violation_signature,
                            first_seen: stat.first_seen,
                            occurrence_count: stat.occurrence_count,
                        },
                    },
                });

                logger.info(message, {
                    violationSignature: stat.violation_signature,
                    firstSeen: stat.first_seen,
                });
            }
        }
    } catch (error) {
        logger.error('Exception while checking CSP alerts', { error });
    }
}

/**
 * Get recent CSP violations for a specific user (for debugging)
 */
export async function getUserCspViolations(
    userId: string,
    limit: number = 50
): Promise<any[]> {
    const release = trackDbRequest();

    try {
        const { data, error } = await supabase
            .from('csp_violations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to fetch user CSP violations', { error, userId });
            return [];
        }

        return data || [];
    } catch (error) {
        logger.error('Exception while fetching user CSP violations', { error, userId });
        return [];
    } finally {
        release();
    }
}

/**
 * Clean up old CSP violations (retention policy)
 * Keep violations for 90 days by default
 */
export async function cleanupOldCspViolations(
    retentionDays: number = 90
): Promise<number> {
    const release = trackDbRequest();

    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const { data, error } = await supabase
            .from('csp_violations')
            .delete()
            .lt('created_at', cutoffDate.toISOString())
            .select('id');

        if (error) {
            logger.error('Failed to cleanup old CSP violations', { error });
            return 0;
        }

        const deletedCount = data?.length || 0;
        logger.info(`Cleaned up ${deletedCount} old CSP violations`, {
            retentionDays,
            cutoffDate: cutoffDate.toISOString(),
        });

        return deletedCount;
    } catch (error) {
        logger.error('Exception while cleaning up old CSP violations', { error });
        return 0;
    } finally {
        release();
    }
}
