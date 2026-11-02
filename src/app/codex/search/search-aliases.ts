// Search aliases — community abbreviations, nicknames and slang (concept
// 2026-11-02 line C6). Pure and framework-free.
// -----------------------------------------------------------------------------
// The datamined names are English ("Quantum Drive", "Hammerhead"), the way
// players talk is not: "QT", "Connie", "Hammie", "rep", "Bucc". An alias maps
// one (normalized) token to the English words the data actually contains, so
// the token expands like a synonym in the client matcher AND in the server's
// ILIKE patterns (see tokenAlternatives / ilikeTokenGroups in codex-search).
//
// Language rule (owner): the search reads the CURRENT UI language plus
// English; when the UI language is English, only English. So every entry
// carries `en` keys (valid everywhere) and optional `de` keys (valid while the
// UI is German). Expansions are always English — the data's language.
//
// Sources: starcitizen.tools (Acronyms, Ship components, Personal weapons),
// starcitizenhelp.com/glossary, starcitizen-community.de/glossar. Ship
// nicknames and weapon slang are community knowledge (confidence "mittel").
// Size words and S0-S10 are NOT aliases: they become chips (search-query-parse).

import type { Lang } from '../codex.types';

interface AliasEntry {
  /** Normalized tokens in every language (abbreviations, nicknames). */
  en: readonly string[];
  /** Normalized tokens that only count while the UI language is German. */
  de?: readonly string[];
  /** What they stand for in the data (English, lower case). */
  to: readonly string[];
}

const e = (en: string, to: string, de = ''): AliasEntry => ({
  en: en.split(',').filter(Boolean),
  de: de ? de.split(',') : undefined,
  to: to.split('|'),
});

/** The alias table. Keys are normalized (lower case, no diacritics, `&` dropped). */
export const SEARCH_ALIASES: readonly AliasEntry[] = [
  // ── components ────────────────────────────────────────────────────────────
  e('qt,qd,qdrive', 'quantum drive', 'quantenantrieb,quantenantriebe,quantum antrieb'),
  e('pp,powerplant', 'power plant', 'reaktor'),
  e('sg,shieldgen', 'shield generator', 'schildgenerator,schildgeneratoren'),
  e('cooler,cooling', 'cooler', 'kuhlung'),
  e('jd,jump', 'jump drive', 'sprungantrieb'),
  e('qed,qi', 'quantum enforcement'),
  e('mil,milspec', 'military', 'militar,militarisch'),
  e('stealth', 'stealth', 'tarnung,tarn'),
  e('ind', 'industrial', 'industrie,industriell'),
  e('civ', 'civilian', 'zivil'),
  e('comp', 'competition', 'wettkampf'),
  e('radar,scanner', 'radar', 'sensor'),
  e('lifesupport,ls', 'life support', 'lebenserhaltung'),
  e('fuel,fueltank', 'fuel tank', 'tank,treibstofftank'),
  e('mining,miningscan', 'mining', 'abbau'),
  e('ecm,jammer', 'ecm', 'storsender'),
  e('cm,flares,chaff', 'countermeasure', 'abwehrmassnahme,leurre'),
  e('thruster,thrusters', 'thruster', 'schubduse'),
  e('gimbal', 'gimbal', 'kardan'),
  e('fixed', 'fixed', 'starr,fest'),
  // ── size words (the chip parser handles numbers) ──────────────────────────
  e('', 'small', 'klein,kleine'),
  e('', 'medium', 'mittel,mittlere,mittleres'),
  e('', 'large', 'gross,grosse,grosses'),
  // ── ships: nicknames ──────────────────────────────────────────────────────
  e('connie,connies', 'constellation'),
  e('cutty,cutter', 'cutlass'),
  e('hammie,hh,hammer', 'hammerhead'),
  e('polly,pol', 'polaris'),
  e('tali,reta', 'retaliator'),
  e('herc,hercs', 'hercules'),
  e('c2', 'c2 hercules'),
  e('m2', 'm2 hercules'),
  e('a2', 'a2 hercules'),
  e('gladdy,glad', 'gladius'),
  e('valk,valky', 'valkyrie'),
  e('cat,caty', 'caterpillar'),
  e('bucc,buccy', 'buccaneer'),
  e('msr', 'mercury star runner'),
  e('bmm', 'merchantman'),
  e('sh', 'super hornet'),
  e('hornet,f7', 'hornet'),
  e('f7a', 'f7a hornet'),
  e('f7c', 'f7c hornet'),
  e('mole', 'mole'),
  e('mpuv', 'mpuv'),
  e('srv', 'srv'),
  e('raft', 'raft'),
  e('warden,harbinger,sentinel,hoplite', 'vanguard'),
  e('carrack,carrick', 'carrack'),
  e('corsair,cors', 'corsair'),
  e('reclaimer,reclaim', 'reclaimer'),
  e('redeemer', 'redeemer'),
  e('terrapin,terra', 'terrapin'),
  e('prospector,prosp', 'prospector'),
  e('freelancer,freel,fl', 'freelancer'),
  e('starlancer,sl', 'starlancer'),
  e('starfarer,sf', 'starfarer'),
  e('khartu,khartuAl', 'khartu-al'),
  e('nox', 'nox'),
  e('aurora,auro', 'aurora'),
  e('mustang,musty', 'mustang'),
  e('avenger,aven', 'avenger'),
  e('scorpius,scorp', 'scorpius'),
  e('eclipse,eclip', 'eclipse'),
  e('ironclad,iron', 'ironclad'),
  e('idris,idr', 'idris'),
  e('javelin,jav', 'javelin'),
  e('bengal', 'bengal'),
  e('890j,890', '890 jump'),
  e('600i,600', '600i'),
  e('400i,400', '400i'),
  e('300i,315p,325a,350r', '300 series'),
  // ── manufacturers: short forms ────────────────────────────────────────────
  e('rsi', 'roberts space industries'),
  e('misc', 'musashi industrial'),
  e('cnou', 'consolidated outland'),
  e('cru', 'crusader'),
  e('argo', 'argo'),
  e('krig', 'kruger'),
  e('kw,klaus', 'klaus'),
  e('ar,amon', 'amon'),
  e('aegs,aegis', 'aegis'),
  e('anvl,anvil', 'anvil'),
  e('drak,drake', 'drake'),
  e('orig,origin', 'origin'),
  e('behr', 'behring'),
  e('kbar', 'kastak'),
  e('gats', 'gatac'),
  e('gama', 'gallenson'),
  e('apar', 'apocalypse arms'),
  e('hrst', 'hurston'),
  e('tmbl', 'tumbril'),
  e('grin', 'greycat'),
  e('banu', 'banu'),
  e('esperia', 'esperia'),
  e('tyrol', 'tyrol'),
  // ── ship weapons: slang ───────────────────────────────────────────────────
  e('rep,reps,repeater', 'repeater', 'repetierer'),
  e('gat,gats,gatling', 'gatling', 'gatling'),
  e('ball,ballistic', 'ballistic', 'ballistisch,ballistik'),
  e('dist,distortion', 'distortion', 'verzerrung'),
  e('torp,torps', 'torpedo', 'torpedos'),
  e('ff', 'fire and forget'),
  e('df,dumbfire', 'dumbfire', 'ungelenkt'),
  e('las,laser', 'laser'),
  e('neutron', 'neutron'),
  e('scattergun,scatter', 'scattergun'),
  e('missile,missiles,msl', 'missile', 'raketen'),
  e('turret,turrets', 'turret', 'geschutzturm,turm'),
  e('emp', 'emp'),
  e('pdc', 'point defense'),
  // ── FPS gear ──────────────────────────────────────────────────────────────
  e('p4', 'p4-ar'),
  e('p8', 'p8-ar'),
  e('karna', 'karna'),
  e('gallant', 'gallant'),
  e('demeco', 'demeco'),
  e('f55', 'f55'),
  e('arrowhead', 'arrowhead'),
  e('atzkav', 'atzkav'),
  e('medpen,pen', 'medpen'),
  e('cmt', 'medical'),
  e('multitool,mt', 'multi-tool', 'multiwerkzeug'),
  e('smg', 'smg', 'mp'),
  e('lmg', 'lmg'),
  e('ar', 'assault rifle', 'sturmgewehr'),
  e('armor,armour', 'armor', 'ruestung'),
  e('helmet,helm', 'helmet'),
  e('core,torso', 'core', 'korper'),
  e('legs', 'legs', 'beinschutz'),
  e('arms', 'arms', 'armschutz'),
  e('undersuit,suit', 'undersuit'),
  e('backpack,pack', 'backpack'),
  // ── game mechanics (words that name searchable things) ────────────────────
  e('scu', 'scu', 'frachteinheit'),
  e('cargo', 'cargo', 'fracht'),
  e('ifcs', 'flight'),
  e('mfd', 'display'),
  e('asop', 'quantum'),
  e('scm', 'scm'),
  e('esp', 'esp'),
  e('aim,aimed', 'aim'),
  e('hud', 'hud'),
  e('mobi,mobiglas', 'mobiglas'),
  e('om1,om-1', 'om-1'),
  e('crate,box', 'crate', 'kiste'),
  e('bp,bps', 'blueprint', 'bauplan'),
  e('blueprint', 'blueprint', 'blaupause,blaupausen'),
  e('craft', 'crafting', 'herstellung'),
  e('liv,livery,paint', 'livery', 'lackierung,lackierungen'),
  e('ammo', 'ammunition', 'munition'),
  e('mag,mags', 'magazine', 'magazin'),
];

let aliasLang: Lang = 'de';

/** The UI language the alias table reads (the engine sets it on every search). */
export function setAliasLanguage(lang: Lang): void {
  aliasLang = lang;
}

export function getAliasLanguage(): Lang {
  return aliasLang;
}

/** Lower case, no diacritics, `&`/spaces/hyphens/dots dropped — same fold as the matcher. */
function fold(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[\s&.\-_]/g, '');
}

type Index = Map<string, readonly string[]>;

function buildIndex(includeGerman: boolean): Index {
  const idx = new Map<string, string[]>();
  const add = (key: string, to: readonly string[]) => {
    const k = fold(key);
    if (!k) return;
    const list = idx.get(k) ?? [];
    for (const t of to) if (!list.includes(t)) list.push(t);
    idx.set(k, list);
  };
  for (const entry of SEARCH_ALIASES) {
    for (const k of entry.en) add(k, entry.to);
    if (includeGerman) for (const k of entry.de ?? []) add(k, entry.to);
  }
  return idx;
}

const INDEX_DE = buildIndex(true);
const INDEX_EN = buildIndex(false);

/** Number of distinct alias keys readable in a language (for the acceptance count). */
export function aliasKeyCount(lang: Lang): number {
  return (lang === 'en' ? INDEX_EN : INDEX_DE).size;
}

/**
 * What a token stands for, in the data's language (English), or [] when it is
 * no alias. `lang` defaults to the language the engine set. An expansion that
 * contains the token is dropped: the matcher is a substring match, so it adds nothing
 * ("torp" already finds "torpedo", "p4" finds "P4-AR").
 */
export function aliasExpansions(token: string, lang: Lang = aliasLang): readonly string[] {
  const k = fold(token);
  if (!k) return [];
  const hit = (lang === 'en' ? INDEX_EN : INDEX_DE).get(k);
  if (!hit) return [];
  return hit.filter((t) => !fold(t).includes(k));
}
