import type { AppLanguage, DateOrder, RegionCode } from './locale.types';

/**
 * Region reference data: which countries write the month first, which write the
 * year first, which run a 12-hour clock, and how an IANA time zone maps back
 * onto a country.
 *
 * The time-zone table is the last-resort region signal: a browser that reports
 * a bare `de` (no region subtag) still reports `Europe/Vienna`, which is a far
 * better guess for "how does this user read a date" than the language default.
 * It is deliberately curated rather than exhaustive — an unknown zone simply
 * falls through to the next step of the chain.
 */

/** Month-first regions (`July / 31 / 2026`). */
const MDY_REGIONS: ReadonlySet<RegionCode> = new Set([
  'US', 'CA', 'PH', 'FM', 'MH', 'PW', 'GU', 'AS', 'VI', 'MP', 'PR',
]);

/** Year-first regions (`2026 / July / 31`). */
const YMD_REGIONS: ReadonlySet<RegionCode> = new Set([
  'CN', 'JP', 'KR', 'KP', 'TW', 'HU', 'LT', 'MN', 'BT',
]);

/**
 * Regions whose everyday clock is 12-hour. Set explicitly instead of letting
 * `Intl` infer it, so a `de-US` combination (German UI, US region) stays
 * deterministic across ICU versions.
 */
const TWELVE_HOUR_REGIONS: ReadonlySet<RegionCode> = new Set([
  'US', 'CA', 'AU', 'NZ', 'PH', 'IN', 'PK', 'BD', 'MY', 'EG', 'SA', 'MX', 'CO', 'NG',
]);

/** App fallback when nothing at all is detectable: English, day-first. */
export const FALLBACK_LANGUAGE: AppLanguage = 'en';

/**
 * `GB` rather than `US` on purpose: the product's stated default date style is
 * day / spelled-out month / year, so the "we know nothing" case must be
 * day-first. US users still get `July / 31 / 2026` — via their browser region,
 * their time zone, or their explicit setting.
 */
export const FALLBACK_REGION: RegionCode = 'GB';

/** Region assumed when the language is known but the region is not. */
const REGION_FOR_LANGUAGE: Readonly<Record<AppLanguage, RegionCode>> = {
  de: 'DE',
  en: FALLBACK_REGION,
};

/**
 * Regions offered in the settings picker. Curated: every entry needs a
 * translated display name in `public/i18n/{de,en}.json`, and the list covers
 * all three date orders plus both clock conventions.
 */
export const PICKER_REGIONS: readonly RegionCode[] = [
  'DE', 'AT', 'CH', 'GB', 'IE', 'US', 'CA', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE',
  'LU', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'HU', 'RO', 'GR', 'TR', 'RU', 'UA',
  'BR', 'MX', 'AR', 'AU', 'NZ', 'ZA', 'IN', 'JP', 'CN', 'KR', 'SG', 'AE',
];

/** IANA time zone → country, for browsers that report no region subtag. */
const REGION_BY_TIME_ZONE: Readonly<Record<string, RegionCode>> = {
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
  'Europe/Luxembourg': 'LU',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Rome': 'IT',
  'Europe/Vatican': 'IT',
  'Europe/Copenhagen': 'DK',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Bratislava': 'SK',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR',
  'Europe/Moscow': 'RU',
  'Europe/Kaliningrad': 'RU',
  'Europe/Samara': 'RU',
  'Asia/Yekaterinburg': 'RU',
  'Asia/Novosibirsk': 'RU',
  'Asia/Vladivostok': 'RU',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/Minsk': 'BY',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Tallinn': 'EE',
  'Europe/Ljubljana': 'SI',
  'Europe/Zagreb': 'HR',
  'Europe/Belgrade': 'RS',
  'Europe/Sarajevo': 'BA',
  'Europe/Malta': 'MT',
  'Atlantic/Reykjavik': 'IS',
  'America/New_York': 'US',
  'America/Detroit': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX',
  'America/Monterrey': 'MX',
  'America/Tijuana': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Fortaleza': 'BR',
  'America/Manaus': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Caracas': 'VE',
  'America/Montevideo': 'UY',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Macau': 'MO',
  'Asia/Taipei': 'TW',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Manila': 'PH',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Kathmandu': 'NP',
  'Asia/Colombo': 'LK',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Tehran': 'IR',
  'Asia/Jerusalem': 'IL',
  'Asia/Baghdad': 'IQ',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Accra': 'GH',
  'Africa/Casablanca': 'MA',
  'Africa/Tunis': 'TN',
  'Africa/Algiers': 'DZ',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
};

/** Uppercased 2-letter code, or `null` when the input is not a region code. */
export function normalizeRegion(raw: string | null | undefined): RegionCode | null {
  const s = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** The supported UI language a raw BCP-47 tag maps onto, or `null`. */
export function normalizeLanguage(raw: string | null | undefined): AppLanguage | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const primary = s.split(/[-_]/)[0];
  if (primary === 'de') return 'de';
  if (primary === 'en') return 'en';
  return null;
}

/** The region subtag of a BCP-47 tag (`de-AT` → `AT`), or `null`. */
export function regionFromLanguageTag(tag: string | null | undefined): RegionCode | null {
  const parts = (tag ?? '').trim().split(/[-_]/);
  // Skip the primary subtag; a region is the first 2-letter part after it.
  // (`zh-Hant-TW` → skip `Hant`, take `TW`.)
  for (const part of parts.slice(1)) {
    const region = normalizeRegion(part);
    if (region) return region;
  }
  return null;
}

/** The country an IANA time zone belongs to, or `null` when unmapped. */
export function regionFromTimeZone(timeZone: string | null | undefined): RegionCode | null {
  const tz = (timeZone ?? '').trim();
  return tz ? (REGION_BY_TIME_ZONE[tz] ?? null) : null;
}

/** How this region orders the calendar fields. Unknown regions are day-first. */
export function dateOrderForRegion(region: RegionCode | null | undefined): DateOrder {
  const r = normalizeRegion(region);
  if (!r) return 'dmy';
  if (MDY_REGIONS.has(r)) return 'mdy';
  if (YMD_REGIONS.has(r)) return 'ymd';
  return 'dmy';
}

/** `true` when the region's everyday clock runs 12-hour with AM/PM. */
export function usesTwelveHourClock(region: RegionCode | null | undefined): boolean {
  const r = normalizeRegion(region);
  return r ? TWELVE_HOUR_REGIONS.has(r) : false;
}

/** The region assumed for a language when nothing better is known. */
export function regionForLanguage(language: AppLanguage): RegionCode {
  return REGION_FOR_LANGUAGE[language] ?? FALLBACK_REGION;
}
