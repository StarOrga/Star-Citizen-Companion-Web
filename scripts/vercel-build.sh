#!/usr/bin/env bash
# Vercel build — shares the exit guard for ng build's intermittent no-exit
# hang with local builds (npm run build).
#
# ng build intermittently never exits AFTER writing the complete output:
# the log shows "Application bundle generation complete" plus the output
# location, then silence — on Vercel's 2-core build box until
# BUILD_EXCEEDED_MAXIMUM_TIME kills the deployment 45 minutes later, and in
# local worktrees under heavy parallel-agent load (seen 2026-09-20/21).
# Verified non-deterministic (2026-08-20/21): the same chunk graph hung 4x
# and passed 1x within minutes; a no-op rebuild of a green commit passes in
# 27s; i18n-only and styles-only overlays pass.
#
# scripts/build-with-exit-guard.mjs kills ng build 300s (default) after the
# completion marker's 30s (default) grace period expires. A guard-triggered
# kill counts as success ONLY when the output is verifiably complete
# (index.html AND ngsw.json present) — every other non-zero exit still fails
# the build, and postbuild's stamp/CSP checks re-validate the artifact.
#
# Both npm run build (local) and this script (Vercel, via vercel.json's
# buildCommand) now call the same guard — see scripts/build-with-exit-guard.mjs
# for the shared implementation and env overrides
# (NG_BUILD_EXIT_GRACE_MS / NG_BUILD_TIMEOUT_MS).
set -u

npm run prebuild || exit $?

node scripts/build-with-exit-guard.mjs || exit $?

npm run postbuild
