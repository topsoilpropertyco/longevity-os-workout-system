/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ['@longevity/engine', '@longevity/db', '@longevity/integrations'],
  experimental: {
    // Server actions are used for logging sets / finishing sessions.
    serverActions: { bodySizeLimit: '1mb' },
  },
  images: {
    // Exercise media is remote (Gym Visual via GitHub raw). No paid image CDN.
    remotePatterns: [
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  webpack(config) {
    // The workspace packages are ESM TypeScript source and import each other
    // with explicit `.js` specifiers (the correct NodeNext form). Teach webpack
    // to resolve those onto the `.ts` files it is already transpiling.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
