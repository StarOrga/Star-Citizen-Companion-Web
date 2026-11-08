import brand from '../../brand.json';

/**
 * The product's display name — the one place components read it from.
 * Change it with `node scripts/apply-brand.mjs "<New Name>"`, which also
 * rewrites the literal copies in i18n, index.html, the manifest and the
 * browser extension.
 */
export const BRAND_NAME: string = brand.name;

/** Initials of the name ("Verse Companion" → "VC"), for marks too small for the full name. */
export const BRAND_INITIALS: string = BRAND_NAME.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase();
