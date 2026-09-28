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
# Every other ref (main / production, feature branches) builds.
ref="${VERCEL_GIT_COMMIT_REF:-}"

case "$ref" in
  dependabot/*)
    echo "Skipping Vercel build for Dependabot branch '$ref' (validated by GitHub CI)."
    exit 0
    ;;
esac

echo "Building ref '${ref:-<unknown>}'."
exit 1
