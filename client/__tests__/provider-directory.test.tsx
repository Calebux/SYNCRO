import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProviderDirectory } from '@/components/directory/ProviderDirectory';
import { ProviderDetail } from '@/components/directory/ProviderDetail';
import { DirectoryError, type DirectoryClient, type DirectoryProvider } from '@/lib/provider-directory';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function provider(overrides: Partial<DirectoryProvider> & { providerId: string }): DirectoryProvider {
  return {
    name: overrides.providerId,
    description: 'A paid API',
    category: 'inference',
    optedIn: true,
    manifest: {
      version: '1',
      upstreamBaseUrl: 'https://provider.example',
      routes: [{ method: 'POST', pathPattern: '/echo/*', unit: 'request', price: 1, asset: 'USDC' }],
    },
    uptime: { percent: 99.99, windowDays: 30, checkedAt: '2026-11-01T00:00:00.000Z' },
    ...overrides,
  };
}

const acme = provider({
  providerId: 'acme',
  name: 'Acme Inference',
  description: 'Fast text models',
  category: 'inference',
  manifest: {
    version: '2',
    upstreamBaseUrl: 'https://acme.example',
    routes: [
      { method: 'POST', pathPattern: '/chat/*', unit: 'token', price: 0.002, asset: 'USDC' },
      { method: 'GET', pathPattern: '/models', unit: 'request', price: 0.0005, asset: 'USDC' },
    ],
  },
});
const bucket = provider({
  providerId: 'bucket',
  name: 'Bucket Storage',
  description: 'Object storage by the byte',
  category: 'storage',
  manifest: {
    version: '1',
    upstreamBaseUrl: 'https://bucket.example',
    routes: [{ method: 'PUT', pathPattern: '/objects/*', unit: 'byte', price: 5, asset: 'XLM' }],
  },
  uptime: { percent: 97, windowDays: 30, checkedAt: null },
});
const crunch = provider({
  providerId: 'crunch',
  name: 'Crunch Compute',
  category: 'compute',
  manifest: {
    version: '1',
    upstreamBaseUrl: 'https://crunch.example',
    routes: [{ method: 'POST', pathPattern: '/run', unit: 'second', price: 12, asset: 'USDC' }],
  },
  uptime: { percent: null, windowDays: 30, checkedAt: null },
});

function listClient(providers: DirectoryProvider[]): DirectoryClient {
  return { list: vi.fn().mockResolvedValue(providers), get: vi.fn() };
}

const cardNames = () => screen.queryAllByTestId('provider-card').map((card) => within(card).getByRole('heading').textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProviderDirectory', () => {
  it('lists providers and shows the result count', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);

    expect(await screen.findByText('3 of 3 providers shown')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Acme Inference', 'Bucket Storage', 'Crunch Compute']);
  });

  it('lists only opted-in providers even if the API returns one that has not opted in', async () => {
    const hidden = provider({ providerId: 'hidden', name: 'Hidden Co', optedIn: false });
    // The default client strips these; a custom client that does not must still not leak them to the page.
    render(<ProviderDirectory client={listClient([acme, hidden])} />);

    // The count must not reveal that a non-opted-in provider exists.
    expect(await screen.findByText('1 of 1 provider shown')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Co')).toBeNull();
    expect(cardNames()).toEqual(['Acme Inference']);
  });

  it('does not offer filter values that belong only to a provider that has not opted in', async () => {
    const hidden = provider({ providerId: 'hidden', optedIn: false, category: 'secret-category' });
    render(<ProviderDirectory client={listClient([acme, hidden])} />);
    await screen.findByText(/providers? shown/);

    expect(within(screen.getByLabelText('Category')).queryByRole('option', { name: 'secret-category' })).toBeNull();
  });

  it('filters by category, asset and unit', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'storage' } });
    expect(cardNames()).toEqual(['Bucket Storage']);
    expect(screen.getByText('1 of 3 providers shown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: 'XLM' } });
    expect(cardNames()).toEqual(['Bucket Storage']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'second' } });
    expect(cardNames()).toEqual(['Crunch Compute']);
  });

  it('filters by price range', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '5' } });
    expect(cardNames()).toEqual(['Bucket Storage', 'Crunch Compute']);

    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '6' } });
    expect(cardNames()).toEqual(['Bucket Storage']);
  });

  it('searches by text', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'object storage' } });
    expect(cardNames()).toEqual(['Bucket Storage']);
  });

  it('flags an inverted price range accessibly and shows no results', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '1' } });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('minimum price is higher than the maximum price');
    for (const name of ['Minimum price', 'Maximum price']) {
      const input = screen.getByLabelText(name);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', alert.id);
    }
    expect(cardNames()).toEqual([]);
  });

  it('explains an empty result and clears filters', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/No providers match these filters/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cardNames()).toHaveLength(3);
  });

  it('says so when no provider has opted in yet', async () => {
    render(<ProviderDirectory client={listClient([])} />);
    expect(await screen.findByText(/No providers are listed yet/)).toBeInTheDocument();
  });

  it('shows status in words for each provider, not colour alone', async () => {
    render(<ProviderDirectory client={listClient([acme, bucket, crunch])} />);
    await screen.findByText('3 of 3 providers shown');

    expect(screen.getByText('Healthy — 99.99% over 30 days')).toBeInTheDocument();
    expect(screen.getByText('Degraded — 97.00% over 30 days')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('gives every control an accessible name and links each card to its detail page', async () => {
    render(<ProviderDirectory client={listClient([acme])} />);
    await screen.findByText('1 of 1 provider shown');

    expect(screen.getByRole('search', { name: 'Filter providers' })).toBeInTheDocument();
    for (const name of ['Search', 'Category', 'Asset', 'Unit', 'Minimum price', 'Maximum price']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Provider directory' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Inference' })).toHaveAttribute('href', '/directory/acme');
  });

  it('offers "Try in playground" on each card with a name that includes its visible text', async () => {
    render(<ProviderDirectory client={listClient([acme])} />);
    await screen.findByText('1 of 1 provider shown');

    const link = screen.getByRole('link', { name: /Try in playground/ });
    expect(link).toHaveAccessibleName('Try in playground: Acme Inference');
    expect(link).toHaveTextContent('Try in playground');
    expect(link).toHaveAttribute('href', '/playground?provider=acme');
  });

  it('announces loading, then shows an error with a request id and retries', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new DirectoryError('The directory is unavailable right now.', 503, 'req-42'))
      .mockResolvedValueOnce([acme]);
    render(<ProviderDirectory client={{ list, get: vi.fn() }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading providers…');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The directory is unavailable right now.');
    expect(alert).toHaveTextContent('req-42');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 of 1 provider shown')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('ProviderDetail', () => {
  const getClient = (result: DirectoryProvider | DirectoryError): DirectoryClient => ({
    list: vi.fn(),
    get: vi.fn().mockImplementation(() => (result instanceof DirectoryError ? Promise.reject(result) : Promise.resolve(result))),
  });

  it('shows the manifest, uptime and an example call', async () => {
    render(<ProviderDetail providerId="acme" client={getClient(acme)} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Inference' })).toBeInTheDocument();
    expect(screen.getByTestId('manifest-version')).toHaveTextContent('2');
    expect(screen.getByTestId('uptime')).toHaveTextContent('Healthy — 99.99% over 30 days');

    const table = screen.getByRole('table', { name: 'Priced routes for Acme Inference' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Method', 'Path', 'Unit', 'Price']);
    expect(within(table).getByText('/chat/*')).toBeInTheDocument();
    expect(within(table).getByText('0.002 USDC per token')).toBeInTheDocument();

    expect(screen.getByTestId('example-call')).toHaveTextContent("curl -X POST 'http://localhost:3001/api/v3/gateway/proxy/chat'");
    expect(screen.getByRole('region', { name: 'Manifest' })).toBeInTheDocument();
  });

  it('updates the example call and playground link when another route is chosen', async () => {
    render(<ProviderDetail providerId="acme" client={getClient(acme)} />);
    await screen.findByRole('heading', { level: 1, name: 'Acme Inference' });

    const playground = () => screen.getByRole('link', { name: 'Try in playground' });
    const first = new URL(playground().getAttribute('href') ?? '', 'https://x.example');
    expect(first.searchParams.get('path')).toBe('/chat/*');

    fireEvent.change(screen.getByLabelText('Route'), { target: { value: '1' } });

    expect(screen.getByTestId('example-call')).toHaveTextContent("curl -X GET 'http://localhost:3001/api/v3/gateway/proxy/models'");
    const second = new URL(playground().getAttribute('href') ?? '', 'https://x.example');
    expect(second.searchParams.get('provider')).toBe('acme');
    expect(second.searchParams.get('method')).toBe('GET');
    expect(second.searchParams.get('path')).toBe('/models');
  });

  it('copies the example call and announces the result', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ProviderDetail providerId="bucket" client={getClient(bucket)} />);
    await screen.findByRole('heading', { level: 1, name: 'Bucket Storage' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy example call' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("curl -X PUT 'http://localhost:3001/api/v3/gateway/proxy/objects'")));
    expect(await screen.findByText('Example call copied to clipboard.')).toBeInTheDocument();
  });

  it('tells the user when copying fails instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<ProviderDetail providerId="bucket" client={getClient(bucket)} />);
    await screen.findByRole('heading', { level: 1, name: 'Bucket Storage' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy example call' }));

    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  });

  it('shows the degraded and no-data uptime states in words', async () => {
    const { unmount } = render(<ProviderDetail providerId="bucket" client={getClient(bucket)} />);
    expect(await screen.findByTestId('uptime')).toHaveTextContent('Degraded — 97.00% over 30 days');
    unmount();

    render(<ProviderDetail providerId="crunch" client={getClient(crunch)} />);
    expect(await screen.findByTestId('uptime')).toHaveTextContent('No data');
  });

  it('shows not found for a provider that is missing or has not opted in', async () => {
    render(<ProviderDetail providerId="ghost" client={getClient(new DirectoryError('Provider not found.', 404))} />);

    expect(await screen.findByRole('heading', { name: 'Provider not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to provider directory' })).toHaveAttribute('href', '/directory');
  });

  it('shows an error with a request id and retries', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new DirectoryError('The directory is unavailable right now.', 500, 'req-7'))
      .mockResolvedValueOnce(acme);
    render(<ProviderDetail providerId="acme" client={{ list: vi.fn(), get }} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('req-7');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Inference' })).toBeInTheDocument();
  });

  it('handles a provider that has published no routes', async () => {
    const bare = provider({
      providerId: 'bare',
      name: 'Bare Provider',
      manifest: { version: '1', upstreamBaseUrl: 'https://bare.example', routes: [] },
    });
    render(<ProviderDetail providerId="bare" client={getClient(bare)} />);

    expect(await screen.findByText('This provider has not published any priced routes.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Example call' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Try in playground' })).toBeNull();
  });
});
