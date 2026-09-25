import api from '@/lib/api';
import type { PrincipalAnalytics } from '@syncro/shared/domain';

interface AnalyticsResponse {
    success: boolean;
    data: PrincipalAnalytics;
    error?: string;
}

export async function getPrincipalAnalytics(): Promise<PrincipalAnalytics> {
    const response = await api.get<AnalyticsResponse>('/api/analytics/v3/usage');
    if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to load principal analytics');
    }
    return response.data.data;
}
