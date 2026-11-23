import { ProviderDirectory } from '@/components/directory/ProviderDirectory';

export const metadata = {
  title: 'Provider directory — SYNCRO',
  description: 'Find paid APIs from opted-in providers and copy integration snippets.',
};

export default function DirectoryPage() {
  return <ProviderDirectory />;
}
