export const environment = {
  production: true,
  appPhase: 'alpha' as const,
  supabase: {
    url: 'https://hcnqhvzlavdycidqyaai.supabase.co',
    publishableKey: 'sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ',
  },
  storage: {
    p4kBucket: 'p4k-uploads',
    maxP4kSizeMb: 200,
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
