import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable Next.js telemetry by default to avoid sending build/runtime usage data.
  env: {
    NEXT_TELEMETRY_DISABLED: '1',
  },
  transpilePackages: ['@syncro/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    reactCompiler: true,
  },
  // Next.js 16: tree-shake heavy barrels so chart/wallet/pdf stay out of the
  // shared graph. Combined with `next/dynamic` on those routes.
  optimizePackageImports: ['lucide-react', 'recharts', '@tremor/react', 'date-fns'],
  webpack: (webpackConfig, { isServer }) => {
    if (!isServer && webpackConfig.optimization) {
      const existing = webpackConfig.optimization.splitChunks
      const cacheGroups = existing && typeof existing === 'object' ? existing.cacheGroups || {} : {}
      webpackConfig.optimization.splitChunks = {
        ...(typeof existing === 'object' ? existing : {}),
        cacheGroups: {
          ...cacheGroups,
          charts: {
            test: /[\\/]node_modules[\\/](recharts|@tremor[\\/]react|victory-vendor)[\\/]/,
            name: 'charts',
            chunks: 'async',
            priority: 40,
          },
          pdf: {
            test: /[\\/]node_modules[\\/]@react-pdf[\\/]/,
            name: 'pdf',
            chunks: 'async',
            priority: 40,
          },
          wallet: {
            test: /[\\/](stellar-wallet|key-rotation-client|use-wallet)/,
            name: 'wallet',
            chunks: 'async',
            priority: 40,
          },
        },
      }
    }
    return webpackConfig
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
}

let config = withSentryConfig(
  nextConfig,
  {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  },
  {
    widenClientFileUpload: true,
    transpileClientSDK: true,
    tunnelRoute: '/monitoring',
    hideSourceMaps: true,
    disableLogger: true,
    automaticVercelMonitors: true,
  }
);

if (process.env.ANALYZE === 'true') {
  try {
    const withBundleAnalyzer = (await import('@next/bundle-analyzer')).default({
      enabled: true,
      openAnalyzer: false,
    });
    config = withBundleAnalyzer(config);
  } catch {
    console.warn('⚠️  @next/bundle-analyzer not available. Install with: npm install --save-dev @next/bundle-analyzer');
  }
}

export default config;
