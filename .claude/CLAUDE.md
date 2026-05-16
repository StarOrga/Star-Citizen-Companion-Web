# SC Companion — Claude Context

See root [CLAUDE.md](../CLAUDE.md) for project conventions. This file is the index for repo-scoped Claude Code resources.

## Project memory

- Stack: Angular 21 + Supabase (`hcnqhvzlavdycidqyaai`, eu-central-1) + Vercel
- Phase: alpha — minimal MVP, expect schema churn until phase flips to `beta`
- Inspirations: erkul.games (loadout planner), Hatchit (sibling Angular+Supabase project under `C:/Users/Jerem/IdeaProjects/Hatchit`)

## When to use which agent

- `devops:frontend` — Angular components, styles, templates
- `devops:core` — Supabase migrations, RLS, edge functions
- `devops:ai` — P4K parsing logic, LLM-assisted feature extraction (future)
- `devops:research` — RSI/Star-Citizen API discovery, comparing approaches
- `devops:qa` — type-check, build, e2e

## Local LLM delegation

Mechanical generation (DTOs, i18n stubs, simple test scaffolds > 20 lines) → delegate via `local_generate`.
See `~/.claude/plugins/cache/dotclaude/devops/0.78.1/deep-knowledge/local-llm-delegation.md`.

## Token-config

`token-config.json` mirrors the Hatchit setup for `/devops-burn` budget tracking.
