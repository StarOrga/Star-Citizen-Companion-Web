declare interface Env {
  readonly NODE_ENV: string;
  readonly NG_APP_POSTHOG_PROJECT_TOKEN: string;
  readonly NG_APP_POSTHOG_HOST: string;
}

declare interface ImportMeta {
  // Optional: no env-substituting builder is wired (no @ngx-env/builder),
  // so at runtime `import.meta.env` is undefined — every access must be
  // optional-chained or the module throws during evaluation and the app
  // never boots (observed as a white screen + Karma "Cannot read
  // properties of undefined" on every spec).
  readonly env?: Env;
}
