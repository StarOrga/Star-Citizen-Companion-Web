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
};
