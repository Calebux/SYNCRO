import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PrincipalOverview } from './principal-overview';

export default async function PrincipalOverviewPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/auth/login');

    return <PrincipalOverview />;
}
