/**
 * Build recipes — the version of the code that turns P4K bytes into a cached,
 * generated artifact (a 3D model, a silhouette).
 *
 * Every generated artifact is cached under a content key: the bytes of the
 * P4K files it reads plus the recipe of its kind. A new patch or hotfix
 * therefore only rebuilds what changed in `Data.p4k`, and a new uploader only
 * rebuilds the kinds whose recipe went up — a refactor, a log line or an
 * upload fix rebuilds nothing. The Python sidecar falls back to hashing its
 * own modules when it is run without a recipe (dev / CLI runs).
 *
 * Bump a recipe by hand whenever a change alters what that kind of artifact
 * looks like. `scripts/check-subtheme-revisions.mjs` (CI) refuses a branch
 * that touches a recipe's `sources` without bumping it or acknowledging it with
 * a `Recipe-Unchanged: <key>, …` commit trailer — a forgotten bump would keep
 * serving the old artifacts.
 *
 * Separate from the subtheme revisions (`subthemes.ts`): those decide what is
 * uploaded again, these what is generated again. The codex catalog has no
 * recipe — the DataCore is parsed in full every run, its rows are compared by
 * their own content.
 *
 * Pure data — no Node, no Electron — so the main process and the CI script
 * share one definition.
 */

export type BuildRecipeKey = 'model3d' | 'silhouette';

export interface BuildRecipe {
  key: BuildRecipeKey;
  /** Bump when a change alters the generated artifacts. Positive integer. */
  revision: number;
  /** Repo-relative path prefixes whose changes can alter the artifacts — read by the CI guard only. */
  sources: readonly string[];
}

export const BUILD_RECIPES: readonly BuildRecipe[] = [
  {
    key: 'model3d',
    // Hulls, parts and interiors (glb). The converter binary and the bundled
    // gltf-transform / meshoptimizer versions are keyed separately.
    revision: 1,
    sources: [
      'data-uploader/python/sc_extract/hull3d.py',
      'data-uploader/python/sc_extract/glb_materials.py',
      'data-uploader/python/sc_extract/mesh_integrity.py',
      'data-uploader/python/sc_extract/gltf_worker',
      'data-uploader/python/sc_extract/build_cache.py',
      'data-uploader/python/sc_extract/assets3d/parts.py',
      'data-uploader/python/sc_extract/assets3d/ships.py',
    ],
  },
  {
    key: 'silhouette',
    // The mesh → silhouette blob step; anchors are re-derived every run.
    revision: 1,
    sources: [
      'data-uploader/python/sc_extract/silhouette.py',
      'data-uploader/python/sc_extract/silhouette_export.py',
      'data-uploader/python/sc_extract/silhouette_gpu.py',
    ],
  },
];

/** `model3d@1` — the form the sidecar's `--recipe` takes. */
export function recipeTag(key: BuildRecipeKey): string {
  const r = BUILD_RECIPES.find((x) => x.key === key);
  if (!r) throw new Error(`unknown build recipe ${key}`);
  return `${r.key}@${r.revision}`;
}
