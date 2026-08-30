import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PaymentTimeline } from '@/components/ui/payment-timeline';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SubscriptionDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('id, name, price, status, billing_cycle, next_renewal, category')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !sub) redirect('/dashboard');

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Subscription summary */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">{sub.name}</h1>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd className="font-medium text-gray-900 capitalize">{sub.status ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Billing cycle</dt>
              <dd className="font-medium text-gray-900 capitalize">{sub.billing_cycle ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Next renewal</dt>
              <dd className="font-medium text-gray-900">
                {sub.next_renewal
                  ? new Date(sub.next_renewal).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Category</dt>
              <dd className="font-medium text-gray-900">{sub.category ?? '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Payment timeline — client component */}
        <PaymentTimeline subscriptionId={id} subscriptionName={sub.name} />
      </div>
    </main>
  );
}
