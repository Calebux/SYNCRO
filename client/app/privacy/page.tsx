import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — SYNCRO',
  description: 'How SYNCRO collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-indigo-600 text-sm hover:underline">
        &larr; Back to home
      </Link>

      <h1 className="text-3xl font-bold mt-8 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: March 28, 2026</p>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-10">
        <p className="text-sm text-blue-900">
          <strong>🔐 Want to maximize your payment privacy?</strong> Check out our{' '}
          <a
            href="https://github.com/Calebux/SYNCRO/blob/main/docs/privacy/user-privacy-guide.md"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 hover:underline"
          >
            Privacy Guide
          </a>{' '}
          for step-by-step instructions on using stealth addresses, encrypted metadata, Tor,
          payment channels, and more.
        </p>
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. What We Collect</h2>
        <p className="mb-2 text-gray-700">
          We collect the minimum data necessary to operate the SYNCRO platform:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Account information (email address, display name, and authentication credentials)</li>
          <li>Subscription data you create and manage within the platform</li>
          <li>Connected email accounts used for subscription detection (with your explicit consent)</li>
          <li>Blockchain activity associated with your Stellar wallet address</li>
          <li>Device and IP address information stored in audit logs for security purposes</li>
          <li>Notification preferences and communication settings</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">2. How We Use Your Data</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Subscription management — creating, updating, and tracking your recurring payments</li>
          <li>Renewal reminders — sending timely notifications before subscriptions renew</li>
          <li>Monthly digests — summarizing your subscription activity and spending</li>
          <li>Security — detecting unauthorized access and maintaining audit trails</li>
          <li>Blockchain sync — coordinating on-chain state with your Stellar wallet</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">3. Third-Party Processors</h2>
        <p className="mb-2 text-gray-700">
          We share data with the following sub-processors to deliver our service:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            <strong>Supabase</strong> — database and authentication infrastructure (PostgreSQL,
            Auth, Storage)
          </li>
          <li>
            <strong>SMTP provider</strong> — transactional email delivery for reminders and digests
          </li>
          <li>
            <strong>Stellar Network</strong> — decentralized blockchain used for on-chain
            subscription logic. SYNCRO is self-custodial: we never hold or control your funds or
            private keys.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">4. Data Retention</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Active account data is retained for as long as your account remains active</li>
          <li>
            Upon account deletion, your personal data is permanently removed within a 30-day grace
            period
          </li>
          <li>
            Audit logs are retained in anonymized form after deletion to support security and
            compliance obligations
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">5. Your Rights</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            <strong>Export</strong> — request a machine-readable copy of all data we hold about you
          </li>
          <li>
            <strong>Delete</strong> — request permanent deletion of your account and associated data
          </li>
          <li>
            <strong>Unsubscribe</strong> — opt out of non-essential communications at any time via
            your notification settings
          </li>
          <li>
            <strong>Cookie consent</strong> — manage optional cookie preferences through the consent
            banner
          </li>
        </ul>
        <p className="mt-3 text-gray-700">
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:privacy@syncro.app" className="text-indigo-600 hover:underline">
            privacy@syncro.app
          </a>
          .
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Cookies</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>
            <strong>Authentication cookies</strong> — necessary for maintaining your logged-in
            session (HTTP-only, cannot be disabled)
          </li>
          <li>
            <strong>Consent cookie</strong> — stores your cookie preferences (necessary)
          </li>
          <li>
            <strong>Analytics cookies</strong> — optional; used to understand how users interact
            with the platform. You may decline these via the consent banner.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Security</h2>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Row-Level Security (RLS) enforced at the database layer via Supabase</li>
          <li>All data in transit encrypted with TLS</li>
          <li>Session tokens stored in HTTP-only cookies to prevent XSS access</li>
          <li>Two-factor authentication (2FA) available for all accounts</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">8. Contact</h2>
        <p className="text-gray-700">
          For privacy inquiries, contact us at{' '}
          <a href="mailto:privacy@syncro.app" className="text-indigo-600 hover:underline">
            privacy@syncro.app
          </a>
          . If your organization requires a Data Processing Agreement, see our{' '}
          <Link href="/dpa" className="text-indigo-600 hover:underline">
            DPA page
          </Link>
          .
        </p>
      </section>

      <hr className="my-8 border-gray-200" />

      <p className="text-sm text-gray-500">
        Also see:{' '}
        <Link href="/terms" className="text-indigo-600 hover:underline">
          Terms of Service
        </Link>{' '}
        &middot;{' '}
        <Link href="/dpa" className="text-indigo-600 hover:underline">
          Data Processing Agreement
        </Link>{' '}
        &middot;{' '}
        <a
          href="https://github.com/Calebux/SYNCRO/blob/main/docs/privacy/user-privacy-guide.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:underline"
        >
          Privacy Guide
        </a>
      </p>
    </main>
  )
}
