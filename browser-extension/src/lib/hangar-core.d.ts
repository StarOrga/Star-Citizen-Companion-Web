// Type surface for hangar-core.js. The runtime module is plain ESM JavaScript
// (MV3 content scripts cannot consume TypeScript), but the web app's Karma
// suite imports it for the unit tests, so the API is declared here instead of
// enabling allowJs for the whole project.

export declare const COMPANION_ORIGINS: readonly string[];
export declare const COMPANION_IMPORT_PATH: string;
export declare const DISMISS_COOLDOWN_MS: number;
export declare const MAX_PAGES: number;
export declare const MAX_SHIPS: number;
export declare const PAYLOAD_VERSION: number;

export interface ParsedShip {
  name: string;
  pledgeName: string | null;
  pledgeId: string | null;
}

export interface NudgeState {
  lastImport: { fingerprint: string; at: number } | null;
  dismissals: Record<string, number>;
}

export interface CompanionPayload {
  version: number;
  source: string;
  capturedAt: number;
  fingerprint: string;
  ships: {
    name: string;
    ship_name: string | null;
    ship_code: null;
    entity_type: 'ship';
  }[];
}

export declare function isLoggedInHangar(doc: Document, url: string): boolean;
export declare function cleanShipName(raw: string): string;
export declare function parseHangarDocument(doc: Document): {
  ships: ParsedShip[];
  pagination: { current: number; last: number };
};
export declare function readPagination(doc: Document): { current: number; last: number };
export declare function buildPageUrls(baseUrl: string, lastPage: number): string[];
export declare function countShips(ships: { name: string }[]): { name: string; count: number }[];
export declare function fingerprintShips(ships: { name: string }[]): string;
export declare function emptyState(): NudgeState;
export declare function normalizeState(raw: unknown): NudgeState;
export declare function shouldOfferImport(
  state: NudgeState,
  fingerprint: string,
  now: number,
): { offer: boolean; reason: 'first-import' | 'changed' | 'unchanged' | 'dismissed' };
export declare function recordDismissal(
  state: NudgeState,
  fingerprint: string,
  now: number,
): NudgeState;
export declare function recordImport(state: NudgeState, fingerprint: string, now: number): NudgeState;
export declare function clearDismissal(state: NudgeState, fingerprint: string): NudgeState;
export declare function toCompanionPayload(
  ships: { name: string; pledgeName: string | null }[],
  capturedAt: number,
): CompanionPayload;
export declare function companionImportUrl(origin: string): string;
