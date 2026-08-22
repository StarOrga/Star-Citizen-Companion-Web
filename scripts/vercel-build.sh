#!/usr/bin/env bash
# Vercel build with an exit guard for ng build's intermittent no-exit hang.
#
# ng build on Vercel's 2-core build box intermittently never exits AFTER
# writing the complete output: the log shows "Application bundle generation
# complete" plus the output location, then silence until
# BUILD_EXCEEDED_MAXIMUM_TIME kills the deployment 45 minutes later.
# Verified non-deterministic (2026-08-20/21): the same chunk graph hung 4x
# and passed 1x within minutes; a no-op rebuild of a green commit passes in
# 27s; i18n-only and styles-only overlays pass.
#
# The guard kills ng build 300s after start. A timeout kill (124/137) counts
# as success ONLY when the output is verifiably complete (index.html AND
# ngsw.json present) — every other non-zero exit still fails the deployment,
# and postbuild's stamp/CSP checks re-validate the artifact.
#
# Local builds (npm run build) are untouched — this script is referenced only
# by vercel.json's buildCommand. Root cause (builder race) is tracked in the
# loadout-migration follow-up issue; delete this script and restore
# buildCommand to "npm run build" once the upstream race is fixed.
set -u

npm run prebuild || exit $?

timeout -k 10 300 npx ng build --configuration production
ec=$?
echo "NG_EXIT=$ec"
if [ "$ec" -ne 0 ]; then
  if { [ "$ec" -eq 124 ] || [ "$ec" -eq 137 ]; } \
     && [ -f dist/sc-companion/browser/index.html ] \
     && [ -f dist/sc-companion/browser/ngsw.json ]; then
    echo "ng build hung after completing output — proceeding under exit guard"
  else
    exit "$ec"
  fi
fi

npm run postbuild
