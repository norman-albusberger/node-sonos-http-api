# AGENTS.md

## Purpose

This repository may be improved autonomously as long as existing API behavior stays stable.

The primary goal is to keep `node-sonos-http-api` reliable, testable, and compatible with modern Node.js without breaking existing consumers.

## Default Autonomy

The agent may work without asking for confirmation when changes are:

- additive
- low-risk
- backwards-compatible
- covered by existing or newly added tests

Examples of allowed autonomous work:

- add or improve tests
- increase endpoint coverage
- improve documentation
- improve Scalar/OpenAPI docs
- refactor internals without changing endpoint behavior
- optimize performance without changing API contracts
- add non-breaking optional endpoints
- modernize dependencies with low migration risk
- improve logging, validation, and error handling

## Must Ask First

The agent must stop and ask before making changes that could have non-obvious product or compatibility impact.

This includes:

- changing behavior of existing endpoints
- removing endpoints, parameters, aliases, or response fields
- changing defaults that clients may rely on
- changing authentication behavior
- changing config semantics in a breaking way
- replacing major core dependencies with migration risk
- introducing destructive scripts or cleanup steps
- modifying runtime behavior that could trigger unexpected playback side effects during live testing
- creating releases, tags, or publishing artifacts

## API Contract Rules

- Existing endpoints must remain backwards-compatible unless explicitly approved.
- Existing response shapes should remain stable.
- New endpoints should be additive.
- Aliases like `favorite`/`favourite` must be preserved.
- Docs must be updated when endpoint surface changes.

## Testing Rules

- Run tests after meaningful code changes.
- Prefer adding tests before or together with behavior-sensitive refactors.
- Prioritize endpoint-level tests over isolated implementation-only tests when possible.
- If a change affects favorites, playlists, queueing, presets, or announcements, add or update tests for those flows.
- If tests cannot be run, clearly state that in the final report.

## Performance Rules

- Prefer optimizations that do not change public behavior.
- Favor caching only when invalidation is clear and safe.
- Avoid speculative micro-optimizations unless they simplify code or remove clear waste.
- Prioritize improvements around favorites, playlists, queueing, presets, discovery, and announcement flows.

## Documentation Rules

- Keep `/docs` usable.
- Keep `static/docs/api-docs.json` aligned with the current public API.
- Prefer practical manual-testing documentation over perfect theoretical completeness.

## Branch And Change Hygiene

- Use `codex/` branches for agent work.
- Do not revert user changes unless explicitly asked.
- Keep changes focused and incremental.
- Prefer safe, reviewable patches over large rewrites.

## Preferred Workflow

1. Inspect current implementation.
2. Identify the highest-value safe improvement.
3. Implement conservatively.
4. Add or update tests.
5. Run tests.
6. Report what changed, what was verified, and any remaining risk.

## Current Project Priorities

- preserve endpoint compatibility
- improve tests and coverage
- harden and modernize the vendored `sonos-discovery` fork
- improve favorites and playlists behavior and performance
- keep Node 24 LTS compatibility
- keep the Scalar docs accurate and usable
