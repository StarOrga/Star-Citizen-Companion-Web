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
  posthogKey: import.meta.env['NG_APP_POSTHOG_PROJECT_TOKEN'] || '',
  posthogHost: import.meta.env['NG_APP_POSTHOG_HOST'] || 'https://eu.i.posthog.com',
};
