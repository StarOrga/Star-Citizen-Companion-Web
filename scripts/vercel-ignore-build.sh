#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
# Vercel semantics: exit 0 = SKIP the build, exit 1 = BUILD.
#
# Dependabot branches are skipped. Every Dependabot push got its own preview
# build, and those builds failed on peer-dependency conflicts or the prebuild
# guards before the grouped bump was reconciled; each failure sent a Vercel
# failure mail (~16 of ~28 failed deploys in September 2026). The bumps are
# already validated by GitHub CI, and they reach production only through a
# merge to main, which Vercel builds normally.
#
# Feature branches are skipped too (2026-10-23). Every pushed branch, including
# each agent worktree branch, left a full preview deployment behind, and the
# Hobby team hit 100% of its 10 GB Deployment Storage. Only main builds.
ref="${VERCEL_GIT_COMMIT_REF:-}"

case "$ref" in
  main)
    echo "Building ref '$ref'."
    exit 1
    ;;
  dependabot/*)
    echo "Skipping Vercel build for Dependabot branch '$ref' (validated by GitHub CI)."
    exit 0
    ;;
esac

echo "Skipping Vercel preview build for '${ref:-<unknown>}' (only main deploys)."
exit 0
