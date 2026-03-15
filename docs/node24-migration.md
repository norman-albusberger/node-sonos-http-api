## Node 22/24 Compatibility

This repository is being aligned to modern LTS Node.js releases without changing the existing HTTP API contract.

### Current status

- The application code now has automated endpoint and action tests under `test/`.
- Core request handling has been updated away from deprecated `Buffer` usage.
- `request-promise` has been removed in favor of built-in `fetch`-based helpers.
- AWS Polly now uses the modular `@aws-sdk/client-polly` package instead of `aws-sdk` v2.
- `sonos-discovery` is now consumed from the vendored `file:vendor/sonos-discovery` fork in this repository.
- Local smoke-tests against a real Sonos system succeeded for `zones`, `state`, `volume`, `groupvolume`, `bass`, `treble`, `mute`, and `unmute`.

### Remaining risk

The main remaining risk is the vendored `sonos-discovery` fork:

- The fork now runs in practice on Node 22 and Node 24, but it still contains older implementation patterns in secondary paths and legacy tests.
- The fork does not yet have its own focused compatibility test matrix.
- The current app appears stable on modern Node, but the dependency still needs more internal cleanup before it can be treated as fully modernized.

### Recommended next steps

1. Continue cleaning the vendored `sonos-discovery` fork, especially secondary legacy paths and old test fixtures.
2. Add a minimal compatibility test matrix for Node 22 and Node 24 against the fork.
3. Add targeted tests for the newly modernized helper paths such as Polly synthesis and library search loading.
4. Review the remaining stale utility dependencies and upgrade or replace them where low-risk.

### Goal

Recommended runtime for this repository: Node 24 LTS.

Supported runtimes for this repository: Node 22 LTS and Node 24 LTS, with no breaking changes to existing endpoints.
