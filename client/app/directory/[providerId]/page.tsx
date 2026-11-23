import { ProviderDetail } from '@/components/directory/ProviderDetail';

export const metadata = {
  title: 'Provider — SYNCRO directory',
  description: 'Manifest, uptime, and an example call for a listed provider.',
};

export default async function DirectoryProviderPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  return <ProviderDetail providerId={providerId} />;
}
