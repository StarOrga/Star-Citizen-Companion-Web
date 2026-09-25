export const environment = {
  production: false,
  appPhase: 'alpha' as const,
  supabase: {
    url: 'https://hcnqhvzlavdycidqyaai.supabase.co',
    publishableKey: 'sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ',
  },
  storage: {
    p4kBucket: 'p4k-uploads',
    maxP4kSizeMb: 200,
  },
  // Public read host for the Cloudflare R2 assets bucket
  // (cloudflare/assets-worker, e.g. 'https://sc-assets.<account>.workers.dev').
  // Empty = ship hulls and icons load from the Supabase `ship-skins` bucket.
  // Setting it also needs the host in vercel.json's CSP (connect-src + img-src).
  assets: {
    r2BaseUrl: 'https://sc-assets.sc-assets-worker.workers.dev',
  },
  // Anonymous product analytics (#139). The project key is a public, write-only
  // ingest key — same class as the Supabase publishable key above, not a secret.
  // Empty = analytics stays inert: the library is never loaded and no event is
  // sent, regardless of consent. Fill in to activate. EU region per admin call.
  posthog: {
    key: 'phc_Am939BozLUF73xus4GT5KKEKRx44xL5syfXHZDvL97iZ',
    host: 'https://eu.i.posthog.com',
  },
};
