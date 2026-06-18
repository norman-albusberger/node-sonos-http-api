# Sonos Cloud Control API architecture evaluation

Status: concept and decision record  
Date: 2026-06-15  
Scope: Extend this fork of `node-sonos-http-api` with optional Sonos Cloud Control API support without breaking existing HTTP contracts for SonoX-Pro, SonoX-Music-Server, Loxone, and existing automations.

## SonoX appliance decision summary (verified, June 2026)

This summary was added after verifying the evaluation below against the official Sonos Control API documentation and the current local-API deprecation status. It is the product-level decision for the **SonoX appliance** (the LAN Sonos↔Loxone bridge). The detailed evaluation follows.

### Scope that actually matters
Only the endpoints SonoX exposes to Loxone need to be covered (`app/core/Sonox/endpoints.json`), not the full `node-sonos-http-api` surface. Mapped against the Cloud Control API namespaces:

- **Cloud-mappable today (~90% of the Loxone set):** play / pause / playpause / next / previous (`playback`), player + group volume and mute (`playerVolume` / `groupVolume`), favorites + playlists (`favorites` / `playlists`), grouping add/join/leave/isolate/ungroup (`groups`), `/zones`, `/{room}/state`, `pauseall` / `resumeall`, and `presetplay` (orchestrated from primitives).
- **Validate on real S2 hardware — the only core-feature risk:** clips and TTS announcements via `audioClip.loadAudioClip`. On the LAN the player can fetch the bridge's `http://<bridge-ip>:5005/(tts|clips)/…` URL; the clip ducks and auto-restores the current music. Caveats: a stereo pair plays on the left speaker only, "all"/group announcements require multiple fan-out calls (not perfectly synchronized), and the player must expose the `AUDIO_CLIP` capability.
- **Emulate app-side:** sleep timer — there is no Cloud equivalent, so the bridge runs its own timer and calls `playback.pause`.
- **Drop:** `/{room}/queue` and `/{room}/clearqueue` — no Cloud equivalent and not used by Loxone.
- **Moot — SonoX never exposed these to Loxone:** EQ (bass/treble/loudness), volume lock, raw `setAVTransportURI`, generic music search, local music library, alarms. The Control API lacks all of these, but it does not matter for this use case.

### Verified hard limits of the Cloud Control API
- **Quota: 1,000 requests/minute per application** (shared across every customer and household), plus a 100 requests/second spike arrest. Sonos explicitly requires a subscribe/event model over polling. Per-device polling therefore does not scale across a fleet.
- **Events require a publicly reachable HTTPS callback.** A LAN device behind NAT cannot receive Sonos cloud events directly; there is no event replay; subscriptions last at most three days.
- **The Control API is a deliberate subset of the local UPnP API** (no local library, no alarms, no player settings).

### Now-playing (the Loxone Text-Input-Sync feature)
- **Today it is local UPnP eventing:** the speaker pushes state changes to the bridge's LAN callback — instant, no cloud, no quota. This is exactly how the official Sonos S2 app works on the LAN.
- **In a cloud-only world** the bridge can still do it itself by polling `playbackMetadata.getMetadataStatus` (an outbound call that works through NAT) — fine for small numbers with a few seconds of latency. A hosted relay (a public callback that the bridge connects out to) is only required for instant updates at fleet scale, not on day one.

### Local-API deprecation status (the actual risk)
- Sonos is gradually deprecating the unofficial local UPnP control for S2 devices ("fewer features over time"), tied to an eventual end-of-life of the desktop controller apps. It is **not imminent, has no public timeline, and still works in 2026.**
- The local control that the 2024 app backlash forced Sonos to restore protects the *Sonos app*, not the *third-party UPnP API* that SonoX relies on — those are separable, so "the app still works locally" is not a guarantee for SonoX.
- **Watch signal:** when Sonos deprecates the desktop controller app, removal of UPnP from the speakers is the likely next step — raise the migration priority then.

### User experience and latency (why a cloud-only Sonos is a downgrade)
- Local SOAP/UPnP control is LAN-instant (~milliseconds). Every Cloud Control command is an internet round-trip, which is noticeably laggy for playback and volume, and worst for sliders (which are additionally rate-limited).
- Loved local-only behaviours — sleep timer, instant now-playing, EQ, volume lock — degrade or disappear. For an automation bridge, a cloud-only Sonos is therefore a real UX regression: more latency and fewer features.
- *(Likely rationale, speculative: Sonos is consolidating on a single account-bound, cloud-controlled surface for telemetry, lock-in, and to stop third parties reverse-engineering local control — shifting the UX cost onto users and integrators.)*

### Decision
1. **Keep local (UPnP/SOAP) as the primary path.** It is instant, feature-complete, and is what the official app uses on the LAN.
2. **Build the provider abstraction now** (`LocalSonosProvider` default, a limited `CloudSonosProvider`) as a serious hedge — the deprecation is active, not hypothetical. Priority: medium.
3. **Validate `audioClip` on real S2 hardware** — the only core-feature risk (announcement reachability, ducking/restore, group and stereo-pair behaviour).
4. **Keep cloud-native concepts server-side** (OAuth, event relay, cloud queue in SonoX-Pro / a hosted relay) — do not force them into the LAN bridge.
5. **No panic migration.** Re-prioritise when the desktop-app-deprecation watch signal fires.

## Executive decision

For a commercial product, the recommended primary direction is Alternative B: implement a first-class Sonos Cloud integration in SonoX-Pro and/or SonoX-Music-Server, while keeping this `node-sonos-http-api` fork as the stable local LAN bridge and compatibility layer.

A hybrid provider inside this repository is still useful, but only as a conservative compatibility bridge for selected cloud-safe operations. It should not try to emulate every local UPnP/SOAP behavior through the cloud API. The old API was designed around local player state, local queues, local event subscriptions, room-name routing, preset choreography, and LAN-hosted announcement audio. The official Sonos Cloud Control API has different domain concepts: OAuth accounts, households, ephemeral groups, player IDs, cloud playback sessions, cloud queues, event webhooks, quotas, and externally reachable media URLs.

The safest target is therefore:

- Keep existing endpoints and response shapes stable.
- Add a provider abstraction around core Sonos operations.
- Use `LocalSonosProvider` as the default and compatibility baseline.
- Add `CloudSonosProvider` only for operations with clear cloud mappings.
- Let SonoX-Pro/SonoX-Music-Server own cloud-native product flows such as OAuth onboarding, multi-household selection, cloud queue management, playback sessions, and commercial-grade token/security handling.
- Avoid unstable "fake compatibility" for queue, preset, notification, and event semantics where the cloud API differs materially.

Sonos is gradually deprecating the unofficial local UPnP/SOAP control for S2 devices (verified June 2026 — see the SonoX summary above: fewer features over time, no public timeline, still working today). As that erodes, the role of the cloud provider shifts from "optional remote feature" toward "S2 survival path". This does not change the recommended product architecture, but it changes the priority: the provider abstraction must be introduced early so S1/local-capable devices can continue through `LocalSonosProvider`, while S2/cloud-only devices can fall back to `CloudSonosProvider` for cloud-supported operations.

## SOAP end-of-life scenario for S2

The critical assumption is that local SSDP discovery might still exist for some time, while local SOAP control disappears or becomes incomplete for S2 devices. The architecture should not depend on that. It should treat local SOAP as one provider capability, not as the permanent source of truth.

Recommended posture:

- Keep the current local implementation for devices and firmware versions where it works.
- Add active capability detection per player and per operation.
- Route cloud-supported commands to `CloudSonosProvider` when local SOAP is unavailable.
- Preserve the public HTTP endpoints as long as the operation can be performed with equivalent user-visible behavior.
- Return explicit unsupported-provider errors when cloud behavior would be materially different.
- Prefer SonoX-Pro/SonoX-Music-Server as the owner of OAuth, cloud account linking, household selection, and cloud queue/session concepts.

This means a hybrid provider inside this repository becomes strategically important, but still not unlimited. It should be a compatibility bridge for S2 continuity, not a promise that every local SOAP-era feature can be reproduced exactly.

### S2 continuity categories

| Category | Cloud fallback viability | Notes |
| --- | --- | --- |
| Basic playback | High | `play`, `pause`, `playpause`, `next`, `previous`, play modes can map to cloud group playback commands. |
| Volume and mute | High | Player and group volume namespaces are a good fit, but sliders need throttling/rate limiting. |
| Zones/groups | Medium/High | Cloud households/groups/players can replace local topology, but group IDs are ephemeral. |
| Favorites/playlists | Medium/High | Cloud APIs exist, but schema and list contents differ from local ContentDirectory. |
| Local queue | Low | Cloud queue is not the same as the legacy local Sonos queue. |
| Presets | Low/Medium | Only cloud-safe preset subsets should be supported. |
| Local clips/TTS announcements | Medium | Possible through `audioClip` for supported players, but not identical to current local announcement behavior. |
| Raw local URI commands | None | `setAVTransportURI` and local `x-rincon`/queue URI concepts should stay local-only. |
| Volume locking | None | Cloud latency/rate limits make lock/revert behavior unsafe. |
| Music search/service shortcuts | Low | Better handled in SonoX-Pro/SonoX-Music-Server as product-level music logic. |

## Local audio clips and TTS without SOAP

Today, this repository can generate or serve local audio files and then use local transport mechanisms to play and restore announcements. If local SOAP disappears, the playback instruction must move to the Sonos Cloud Control API. The most relevant official mechanism is `audioClip.loadAudioClip`.

### What the Cloud API supports

The `audioClip` namespace can schedule short clips on a player. The command is player-targeted and can use either a Sonos built-in clip type or a custom `streamUrl`.

Relevant documented properties:

- `name`: required user-identifiable clip name.
- `appId`: required application identifier, ideally reverse-DNS style.
- `priority`: optional `LOW` or `HIGH`.
- `clipType`: optional built-in type such as `CHIME`, `CUSTOM`, or `VOICE_ASSISTANT`.
- `streamUrl`: optional custom audio URL.
- `httpAuthorization`: optional Authorization header for secure URL fetching.
- `volume`: optional clip playback volume from 0 to 100.
- `clipLEDBehavior`: optional LED behavior.

Important constraints:

- Not all devices support audio clips; supported players expose the `AUDIO_CLIP` capability.
- Custom clips are limited to MP3 or WAV.
- The command schedules a clip and returns immediately.
- It is designed for short clips, not long-form playback.
- Clip status is reported through `audioClipStatus` events if subscribed.

### Can local clips still work?

Likely yes for many LAN deployments, but it must be validated on real S2 hardware.

The important distinction is that the command is sent through the cloud, but the player still needs to fetch the `streamUrl`. If the player can reach a URL served by this API on the same LAN, local clips may continue to work as custom `audioClip` streams even without SOAP transport commands.

Potential modes:

- LAN clip URL: `http://<bridge-lan-ip>:5005/clips/chime.mp3`
- LAN TTS URL: `http://<bridge-lan-ip>:5005/tts/<generated>.mp3`
- Public HTTPS URL: required when controlling a household remotely or when the player cannot reach the local bridge URL.
- CDN/object-storage URL: safest for commercial remote/cloud deployments.

The official `audioClip` documentation does not make this equivalent to the current local announcement implementation. Therefore this must be treated as a new `CloudAnnouncementProvider`, not as an invisible replacement for the current `say`/`clip` internals.

### Can TTS still work?

Yes, with a changed pipeline:

```text
Text input
  -> existing TTS provider generates MP3/WAV
  -> file is exposed through a player-reachable URL
  -> CloudSonosProvider calls players/{playerId}/audioClip
  -> optional audioClipStatus events update diagnostics
```

This preserves the external endpoint idea, for example `/{room}/say/...`, but not necessarily every detail of current behavior.

Expected differences:

- The cloud version should target players with `AUDIO_CLIP` capability.
- Group-wide announcements may require sending `audioClip` to multiple players, because the command is player-targeted. Perfect group synchronization should not be promised until verified.
- Audio clip priority replaces some of the old local interruption/restore logic.
- Playback restore semantics are owned by Sonos audioClip behavior, not by the old local queue/transport choreography.
- Clip duration should remain short.
- The generated file must be MP3 or WAV.
- Remote households require a URL reachable by the remote players, usually HTTPS.

### What if audioClip is unavailable?

There are only degraded alternatives:

- Use regular playback through a stream URL or cloud queue/playback session. This interrupts the current source and is not equivalent to an announcement.
- Use a Sonos built-in `clipType` where a custom message is not required.
- Return a clear unsupported-provider error for `say`/`clip`.

The implementation should not pretend that long TTS, queue-based playback, or stream playback is the same as local announcement playback. That would create brittle behavior and surprise users.

### Recommended announcement architecture

Add a provider-level announcement abstraction:

```text
AnnouncementService
  LocalAnnouncementProvider
    - current local SOAP/AVTransport based say/clip behavior
  CloudAnnouncementProvider
    - TTS generation reused
    - player-reachable URL resolver
    - AUDIO_CLIP capability check
    - audioClip.loadAudioClip call
    - audioClipStatus diagnostics
```

The HTTP endpoints can remain:

- `/{room}/say/...`
- `/sayall/...`
- `/saypreset/...`
- `/{room}/clip/...`
- `/clipall/...`
- `/clipavailable`
- `/clippreset/...`

But the response should include provider/capability diagnostics in debug mode, and docs should state that cloud mode depends on `AUDIO_CLIP` support and URL reachability.

## Official Sonos Cloud API sources

The evaluation is based on the current official Sonos documentation:

- [Authorize](https://docs.sonos.com/docs/authorize.md)
- [Control](https://docs.sonos.com/docs/control.md)
- [Discover](https://docs.sonos.com/docs/discover.md)
- [Subscribe](https://docs.sonos.com/docs/subscribe.md)
- [Volume](https://docs.sonos.com/docs/volume.md)
- [Playback Sessions](https://docs.sonos.com/docs/playback-sessions.md)
- [Cloud Queue](https://docs.sonos.com/docs/cloud-queue-play-audio.md)
- [Quotas and Spike Arrests](https://docs.sonos.com/docs/quotas-and-spike-arrests.md)
- [AudioClip loadAudioClip](https://docs.sonos.com/reference/audioclip-loadaudioclip-playerid.md)
- [Favorites getFavorites](https://docs.sonos.com/reference/favorites-getfavorites-householdid.md)
- [Playlists getPlaylists](https://docs.sonos.com/reference/playlists-getplaylists-householdid.md)

## Existing implementations worth evaluating

There does not appear to be a mature, drop-in Node.js replacement for this repository that already implements the official Sonos Cloud Control API as a backwards-compatible `node-sonos-http-api` provider. The useful public projects are reference implementations and migration aids, not ready-made replacements.

| Project | Language | Relevance | Usefulness | Caveats |
| --- | --- | --- | --- | --- |
| [sonos/sonos-audioclip-tts](https://github.com/sonos/sonos-audioclip-tts) | JavaScript/Node | Official Sonos sample for OAuth, households, `AUDIO_CLIP` capability detection, and `players/{playerId}/audioClip` | Very high for the first TTS/audioClip proof of concept | Old sample app, old dependencies, not production-ready token storage |
| [jjlawren/sonos_cloud](https://github.com/jjlawren/sonos_cloud) | Python/Home Assistant | Practical Home Assistant integration using Cloud `audioClip` for TTS/alerts | Very high as behavior reference: volume-per-clip, media URL handling, bonded speaker caveats, fallback limitations | Python/HA-specific, not a general Control API client, license/reuse must be checked |
| [sonos-control](https://www.npmjs.com/package/sonos-control) | TypeScript/Node | NPM package described as a Sonos Control API client | Medium as a code-reading reference for early OAuth/client modeling | Last published in 2019, repository appears unavailable, dependency stack is old, do not depend on it directly |
| [duncan3dc/sonos-cloud](https://github.com/duncan3dc/sonos-cloud) | PHP | Official Sonos API client concepts in another language | Medium for API modeling and OAuth structure | Old and PHP-only; not directly reusable in Node |
| [hubwareHouse/sonos](https://github.com/hubwareHouse/sonos) | PHP | PHP Sonos Cloud API implementation | Low/Medium for endpoint modeling | Old, not Node, likely limited modern coverage |
| [sonos](https://www.npmjs.com/package/sonos) / [bencevans/node-sonos](https://github.com/bencevans/node-sonos) | JavaScript/Node | Widely used local Sonos control library | Medium for local SOAP/UPnP behavior comparison | Local-first, not a Cloud Control API migration path |
| [@svrooij/sonos](https://www.npmjs.com/package/@svrooij/sonos) / [node-sonos-ts](https://github.com/svrooij/node-sonos-ts) | TypeScript/Node | Modern local Sonos library patterns | Medium for local-provider inspiration and TypeScript modeling | Local UPnP-focused, not a Cloud Control API migration path |
| [node-red-contrib-sonos-plus](https://www.npmjs.com/package/node-red-contrib-sonos-plus) | JavaScript/Node-RED | Active local Sonos automation nodes | Medium for automation semantics and endpoint expectations | Local network control, not cloud provider code |
| [homebridge-zp](https://www.npmjs.com/package/homebridge-zp) | JavaScript/Homebridge | Active local Sonos/HomeKit integration | Medium for device modeling and long-running integration behavior | Local Sonos, framework-specific |
| [ioBroker.sonos](https://www.npmjs.com/package/iobroker.sonos) | JavaScript/ioBroker | Local Sonos adapter for smart-home automation | Medium for automation/user expectations | Local Sonos, framework-specific |
| Public forks of [jishi/node-sonos-http-api](https://github.com/jishi/node-sonos-http-api) | JavaScript/TypeScript | May contain modernization or endpoint changes | Low/Medium for cherry-picking tests/refactors | No strong evidence of a complete Cloud Control provider; most are local API forks |

Recommended use:

- Use `sonos/sonos-audioclip-tts` to build the first `CloudAnnouncementProvider` PoC in Node.
- Use `jjlawren/sonos_cloud` to validate real-world TTS/alert behavior, especially limitations around device support, local/media URLs, bonded speakers, volume, and restore semantics.
- Use `sonos-control` only as a historical Node reference if its tarball is inspected; do not take it as a dependency.
- Use local libraries and automation integrations to compare local behavior and test expectations, not as cloud migration code.
- Do not import any project wholesale into this repository.
- Build a small internal `SonosCloudClient` around `fetch`, official docs, and endpoint-level tests instead of depending on an abandoned or incomplete third-party Cloud API wrapper.
- Treat public `node-sonos-http-api` forks as cherry-pick sources only after diff review and tests.

### Reuse potential by migration area

| Migration area | Reuse candidates | Recommendation |
| --- | --- | --- |
| OAuth / token flow | Sonos official sample, `sonos-control`, PHP cloud libraries | Reimplement internally; reuse only flow shape and edge-case notes. |
| Households / groups / players | Sonos official sample, Home Assistant `sonos_cloud` | Reimplement internally; this is small and central enough to own. |
| Playback / volume / mute | Official Sonos docs, `sonos-control` if inspected | Reimplement internally; direct endpoint wrappers are safer than third-party dependency. |
| Favorites / playlists | Official Sonos docs | Reimplement internally; no strong public reusable implementation found. |
| Event subscriptions | Official Sonos docs | Reimplement internally; needs product-specific HTTPS callback, signature validation, renewal, and diagnostics. |
| AudioClip / announcements | Sonos official sample, Home Assistant `sonos_cloud` | Reuse heavily as reference; implement own `CloudAnnouncementProvider`. |
| Cloud Queue / playback sessions | Official Sonos docs | Build product-specific implementation; no mature reusable Node library found. |
| Legacy HTTP compatibility | This fork and `jishi/node-sonos-http-api` forks | Own this in this repository with endpoint regression tests. |
| Local provider modernization | `@svrooij/sonos`, `sonos`, Homebridge/Node-RED/ioBroker adapters | Use as comparison/reference only; keep current vendored provider stable unless a separate migration is planned. |

### Implementation lessons from existing projects

From the official `sonos-audioclip-tts` sample:

- OAuth Authorization Code Flow can be implemented with standard OAuth libraries, but production token storage must be stronger than local sample persistence.
- `GET /households` and `GET /households/{householdId}/groups` are enough to discover players and filter by `AUDIO_CLIP`.
- `POST /players/{playerId}/audioClip` with `{ streamUrl, name, appId }` is the minimal custom TTS/clip command.

From the Home Assistant `sonos_cloud` integration:

- `audioClip` is a good practical replacement for alert/TTS use cases because it can duck current music and return to the previous level.
- Device support varies; older models may have limited or no `audioClip` support.
- Stereo pairs and home theater setups are not a perfect group target: the API targets single players, and multi-device playback may require multiple calls that are not perfectly synchronized.
- Media URLs must be resolvable and directly reachable by the Sonos speakers.
- A built-in `CHIME` clip is useful as a first connectivity test before debugging custom URLs.

## Repository architecture analysis

### HTTP API layer

The public HTTP surface is concentrated in `lib/sonos-http-api.js`.

Key behavior:

- All files in `lib/actions/` are loaded through `require-dir`.
- Actions register aliases through `api.registerAction(name, handler)`.
- Requests are parsed as either `/:room/:action/:values...` or `/:action/:values...`.
- If no room is supplied, the API falls back to `discovery.getAnyPlayer()`.
- Empty or stream responses are normalized to `{ "status": "success" }`.
- Errors are surfaced through the existing API error flow.
- `/events` is special-cased and exposes a local Server-Sent Events stream.
- `/zones` and `/state` expose locally maintained Sonos state.

This file is the natural place to introduce a `ProviderResolver`, but it should not become cloud-aware itself. The router should remain thin and stable.

### Local Sonos discovery and state

The local integration is based on the vendored `sonos-discovery` fork under `vendor/sonos-discovery/lib/`.

Important components:

- `SonosSystem.js`: SSDP discovery, topology tracking, player registry, zone model, favorites/playlists cache, local notification subscription orchestration.
- `Player.js`: player state model and event handling for local rendering, transport, queue, and content directory events.
- `Player/AVTransport.js`: local playback, queue, URI, seek, group, and transport SOAP commands.
- `Player/RenderingControl.js`: local volume, mute, EQ, loudness, and related SOAP commands.
- `Player/GroupRenderingControl.js`: group volume and group mute SOAP commands.
- `Player/ContentDirectory.js`: local favorites, playlists, queue browsing, and related list operations.
- `Player/MediaRenderer.js` and service helpers: local UPnP service wrappers.
- `Subscriber.js` and `NotificationListener.js`: local UPnP event subscription and callback handling.

This is LAN-first and event-cache-heavy. Many existing endpoints do not query Sonos synchronously; they return or mutate local state that has been maintained by UPnP subscriptions.

### Action modules and functional areas

The public endpoint behavior is implemented in `lib/actions/`.

Discovery and state:

- `zones`
- `state`
- `debug`
- `debug/tts`
- `services`
- `sub`

Playback:

- `play`
- `pause`
- `playpause`
- `next`
- `previous`
- `repeat`
- `shuffle`
- `crossfade`
- `seek`
- `timeseek`
- `trackseek`
- `setavtransporturi`

Volume and audio settings:

- `volume`
- `groupvolume`
- `mute`
- `unmute`
- `groupmute`
- `groupunmute`
- `mutegroup`
- `unmutegroup`
- `togglemute`
- `lockvolumes`
- `unlockvolumes`
- `bass`
- `treble`
- `nightmode`
- `speechenhancement`

Favorites, playlists, queues, and services:

- `favorite`
- `favourite`
- `favorites`
- `favourites`
- `playlist`
- `playlists`
- `queue`
- `clearqueue`
- `musicsearch`
- service-specific shortcuts such as `spotify`, `tunein`, `applemusic`, `amazonmusic`, `napster`, `pandora`, `siriusxm`, `aldilifemusic`, `bbcsounds`

Grouping:

- `join`
- `add`
- `leave`
- `isolate`
- `ungroup`

Presets and automation:

- `preset`
- `presetplay`
- `pauseall`
- `resumeall`

Notifications and TTS:

- `say`
- `sayall`
- `saypreset`
- `clip`
- `clipall`
- `clipavailable`
- `clippreset`

Library maintenance and special local operations:

- `reindex`
- `linein`

### Local protocol dependency map

| Area | Current implementation model | Local dependency |
| --- | --- | --- |
| Discovery | SSDP multicast discovery and local device XML parsing | UPnP/SSDP |
| Player state | Cached from local AVTransport, RenderingControl, ContentDirectory, and GroupRenderingControl events | UPnP event subscriptions |
| Zones/groups | Local topology events and `x-rincon` coordinator URIs | Sonos local topology/AVTransport |
| Playback | SOAP commands on local coordinator | AVTransport SOAP |
| Queue | Local queue browse and mutation | AVTransport + ContentDirectory SOAP |
| Favorites/playlists | Local ContentDirectory browse and local cache | ContentDirectory SOAP |
| Presets | Choreography of grouping, source loading, volume/mute, play modes, seek, sleep, and playback | Multiple local SOAP services |
| Notifications/TTS | Generate local files, host them through this server, play/restore via local announcement helpers | Local HTTP + AVTransport |
| Events | Local UPnP events translated to internal events and SSE/webhook | UPnP callbacks |
| Music services | Sonos service IDs/types plus local URI construction | Sonos local service metadata |

## Existing API contract patterns

The public API is intentionally simple and URL-driven:

- Most commands are `GET /{room}/{action}/{value...}`.
- Several global commands are `GET /{action}` or `GET /{action}/{value...}`.
- Success commonly returns `{ "status": "success" }`.
- Some commands return additional command-specific fields, for example `playpause` returns `paused`, `togglemute` returns `muted`.
- List endpoints often return compact title arrays by default and full objects with `/detailed`.
- Aliases are part of the contract, especially `favorite`/`favourite` and `favorites`/`favourites`.
- Scalar/OpenAPI docs live in `static/docs/api-docs.json` and must remain aligned.

Any provider abstraction must preserve these patterns at the HTTP boundary.

## Cloud API domain summary

The Sonos Cloud Control API introduces concepts that do not map 1:1 to the local API:

- OAuth 2.0 Authorization Code Flow is required.
- Access tokens expire after 24 hours.
- Refresh tokens must be stored securely and refreshed server-side.
- A Sonos account can expose multiple households.
- Households contain players and groups.
- Player IDs are stable; group IDs and playback session IDs are ephemeral.
- Playback transport commands target groups, not room names.
- Group membership can change outside this API.
- Event subscriptions require a public HTTPS callback, signature verification, renewal, and quick 200 responses.
- Subscriptions last at most 3 days and do not provide backlog/replay.
- Cloud queues require the application to host a Sonos Cloud Queue API server.
- Audio clips require player capability and, for custom streams, player-reachable MP3/WAV URLs. In LAN mode this may be a local bridge URL; in remote/cloud-only mode this usually means HTTPS/CDN/object storage.
- API consumers must handle rate limits and spike arrests.
- Cloud command ordering is not guaranteed by the cloud transport.

These differences are the core reason a pure "drop-in cloud backend" would be fragile.

## Endpoint to Cloud API mapping

Compatibility levels:

- High: Can be mapped with low risk while preserving the old HTTP response shape.
- Medium: Can be mapped, but requires cache, normalization, fallback, or semantic compromises.
- Low: Cloud support would be incomplete or behaviorally different.
- None: No clean Cloud API equivalent should be promised.

Cloud paths below are abbreviated by Sonos domain namespace. Implementation must use the exact current reference path and namespace version required by Sonos.

| Existing endpoint family | Current local behavior | Cloud API mapping | Compatibility | Adapter logic | Main risk |
| --- | --- | --- | --- | --- | --- |
| `/zones` | Returns local zones, coordinators, players, state snapshots | `GET /households`, `GET /households/{id}/groups` plus cached volume/metadata subscriptions | Medium | Normalize households/groups/players into legacy zone shape | Cloud group IDs are ephemeral; local response contains richer UPnP state |
| `/state` and `/{room}/state` | Returns cached local player state | Playback status, playback metadata, player volume, group volume, group/subscription cache | Medium | Build a legacy state object from multiple cloud namespaces | Response completeness depends on subscribed/cache state |
| `/events` | Local SSE stream from UPnP-derived events | Cloud event webhook -> internal event bus -> SSE | Medium | Verify signatures, renew subscriptions, normalize events | Requires public HTTPS callback; no backlog/replay |
| `/debug` | Local system diagnostics | Local debug plus optional cloud account/household diagnostics | Medium | Add redacted cloud diagnostics only | Must never leak tokens |
| `/debug/tts` | Local TTS/provider/server diagnostics | No direct cloud equivalent; can include audioClip readiness | Low | Report local TTS plus cloud clip capability/config | Different concepts |
| `/services` | Local Sonos music service metadata | No direct equivalent with same shape | Low | Keep local-only or expose cloud capability metadata separately | Existing service IDs/types are local Sonos concepts |
| `/{room}/play` | Local coordinator play | Group playback `play` | High | Resolve room -> current group -> command | Group may have changed; command ordering not guaranteed |
| `/{room}/pause` | Local coordinator pause | Group playback `pause` | High | Resolve room -> current group -> command | Same |
| `/{room}/playpause` | Toggle based on local state and return `paused` | Group playback `togglePlayPause` or cached state + play/pause | Medium | Prefer cloud toggle; compute legacy `paused` from post-state if needed | Race if state changes externally |
| `/{room}/next` | Local next track | Group playback `skipToNextTrack` | High | Resolve group | Not available for all sources |
| `/{room}/previous` | Local previous track | Group playback `skipToPreviousTrack` | High | Resolve group | Not available for all sources |
| `/{room}/repeat/{mode}` | Local play mode mutation | Group playback `setPlayModes` | High | Translate legacy modes to Sonos playModes | Source capability differences |
| `/{room}/shuffle/{on|off}` | Local shuffle mutation | Group playback `setPlayModes` | High | Translate booleans | Source capability differences |
| `/{room}/crossfade/{on|off}` | Local crossfade mutation | Group playback `setPlayModes` if supported | Medium | Translate booleans and preserve response | Crossfade support may vary |
| `/{room}/seek` and `/{room}/timeseek` | Absolute time seek | Group playback `seek` | Medium | Parse legacy time format into milliseconds/ISO value expected by cloud | Source/session support varies |
| `/{room}/trackseek/{trackNo}` | Seek by local queue track index | Playback session skip/item APIs only for compatible sessions | Low | Only supported for cloud sessions/known item IDs | Legacy local queue index is not a cloud primitive |
| `/{room}/volume/{value}` | Player volume absolute/relative | `playerVolume.setVolume` or `setRelativeVolume` | High | Resolve room -> player; parse relative values | Rate limits during sliders |
| `/{room}/groupvolume/{value}` | Group volume absolute/relative | `groupVolume.setVolume` or `setRelativeVolume` | High | Resolve room -> group | Group ID changes |
| `/{room}/mute`, `/unmute`, `/togglemute` | Player mute | `playerVolume.setMute` | High for mute/unmute, Medium for toggle | Toggle needs cached/get volume state | State race |
| `/{room}/groupmute`, `/groupunmute`, `/mutegroup`, `/unmutegroup` | Group mute aliases | `groupVolume.setMute` | High | Preserve aliases | Group ID changes |
| `/lockvolumes`, `/unlockvolumes` | Local event listener reverts volume changes | No safe cloud equivalent | None | Keep local-only | Cloud latency/rate limits make enforcement unreliable |
| `/{room}/bass`, `/{room}/treble` | Local EQ | Cloud equivalent not clearly available in Control API core docs | Low/None | Keep local-only unless official EQ endpoint is confirmed | Unsupported feature promise |
| `/{room}/nightmode`, `/{room}/speechenhancement` | Local home theater settings | Cloud equivalent not clearly available in Control API core docs | Low/None | Keep local-only unless official endpoint is confirmed | Device/source specificity |
| `/{room}/queue` | Browse local Sonos queue | Cloud queue is app-hosted and session-scoped, not legacy shared queue browse | Low | Only expose app cloud queue diagnostics separately | Misleading old queue response |
| `/{room}/clearqueue` | Clear local Sonos queue | No general cloud equivalent for legacy queue | Low/None | Only for app-owned cloud sessions if explicitly scoped | Could clear wrong conceptual queue |
| `/{room}/favorite/{name}` and `/favourite` | Load local favorite by title and play | `GET favorites`, group `loadFavorite` | Medium/High | Cache favorites by household, resolve name/id, call load | Favorite list excludes pinned items; title collisions |
| `/favorites` and `/favourites` | List local favorites, compact or detailed | `GET /households/{id}/favorites` | High for list, Medium for exact shape | Normalize to legacy title array/full object | Cloud favorite schema differs; limit 70 |
| `/{room}/playlist/{name}` | Load Sonos playlist by title and play | `GET playlists`, group `loadPlaylist` | Medium/High | Cache playlists by household, resolve name/id, call load | Title collisions; cloud schema differs |
| `/playlists` | List Sonos playlists | `GET /households/{id}/playlists` | High for list, Medium for exact shape | Normalize to legacy title array/full object | Playlist list excludes favorites |
| `/{room}/add/{room2}` and `/{room}/join/{room2}` | Join player to local group | Groups create/modify/set group members | Medium | Resolve both rooms to players/groups and apply membership | Group IDs are ephemeral; operations affect real household state |
| `/{room}/leave`, `/isolate`, `/ungroup` | Remove player from group or isolate | Groups modify/set group members | Medium | Translate to desired member set | Edge cases for coordinator changes |
| `/{room}/linein/{source}` | Load local line-in stream URI | Playback `loadLineIn` if supported | Medium | Resolve source player and target group | Capability/source availability |
| `/pauseall` | Pause all playing local zones and remember paused UUIDs | Iterate cloud groups and pause | Medium | Store paused group/player IDs; refresh topology | Group IDs may expire before resume |
| `/resumeall` | Resume previously paused zones | Iterate stored paused targets and play | Medium/Low | Resolve stored players to current groups | External state may have changed |
| `/preset` | List/apply complex local presets | No single cloud equivalent | Low | Break into compatible operations; unsupported steps must be explicit | High risk of behavioral drift |
| `/presetplay` | License-gated preset plus favorite/playlist playback | Partial: loadFavorite/loadPlaylist plus volume/group ops | Low/Medium | Only support cloud-safe preset subset | Choreography and timing differ |
| `/{room}/say`, `/sayall`, `/saypreset` | Generate TTS file, host locally, announce with restore behavior | `audioClip.loadAudioClip` for short clips if the player supports `AUDIO_CLIP` and can fetch the generated MP3/WAV URL | Medium/Low | Separate `AnnouncementProvider`; use cloud audioClip only when compatible | Restore semantics, group sync, and URL reachability differ |
| `/{room}/clip`, `/clipall`, `/clipavailable`, `/clippreset` | Play local static clips | `audioClip.loadAudioClip` for supported players | Medium | Map clip files to HTTPS URLs or built-in clip types | Capability, priority, format, public URL requirements |
| `/{room}/setavtransporturi/{uri}` | Raw local AVTransport URI | No safe generic cloud equivalent | None | Keep local-only | Exposes local protocol internals |
| `/{room}/reindex` | Local music library reindex | No cloud equivalent | None | Keep local-only | Unsupported |
| `/{room}/sub` | Local subscription/debug action | Cloud subscriptions differ entirely | Low/None | Provide separate cloud diagnostics | Different lifecycle/security |
| `/{room}/musicsearch/...` | Local/music service search wrappers | No generic Cloud Control API search equivalent | None/Low | Keep existing implementation; cloud-native search belongs in SonoX services | Service-specific licensing/auth |
| `/{room}/spotify`, `/{room}/applemusic`, `/{room}/amazonmusic`, etc. | Service-specific local URI construction/loading | Possible only through supported cloud content-loading APIs if valid IDs are available | Low/Medium | Prefer direct SonoX music-domain integration | Hard to preserve legacy URL semantics |

## Provider abstraction points

A provider abstraction is useful at the domain-command level, not at the raw HTTP route level.

Good abstraction points:

- Topology: zones, rooms, players, coordinators, group membership.
- Playback: play, pause, toggle, next, previous, seek, play modes.
- Volume: player volume, group volume, mute.
- Library lists: favorites, playlists.
- Source loading: load favorite, load playlist, line-in where supported.
- Announcements: local TTS/clip and cloud audioClip behind a capability-aware announcement interface.
- Events: local UPnP events and cloud webhook events normalized into one internal event bus.

Poor abstraction points:

- Raw local `setAVTransportURI`.
- Legacy queue browse/mutation as if it were the same as cloud queue.
- Presets as one cloud command.
- Volume locking through cloud.
- Music search across arbitrary services.
- Debug/service metadata that exposes local Sonos internals.

## Alternative A: Hybrid provider inside this API

### Concept

The existing HTTP API remains unchanged. Internally, route handlers call a provider abstraction. A resolver decides whether to use `LocalSonosProvider` or `CloudSonosProvider` globally, per room, or per action.

Example configuration:

```json
{
  "sonosProviders": {
    "default": "local",
    "fallback": "cloud",
    "rooms": {
      "Wohnzimmer": { "preferred": "local", "fallback": "cloud" },
      "Ferienhaus": { "preferred": "cloud" }
    },
    "unsupportedCloudActions": "return-error"
  }
}
```

### Strengths

- Maximum backwards compatibility for existing clients.
- Loxone and URL-based automations can keep using the old endpoints.
- Local LAN behavior remains the baseline.
- Cloud can help in remote or split-network scenarios for simple playback/volume/favorites.
- Incremental migration is possible with endpoint-level tests.

### Weaknesses

- The abstraction is leaky because local and cloud Sonos models differ.
- OAuth/token storage moves into a bridge originally not designed as an identity system.
- Cloud eventing needs public HTTPS callback infrastructure.
- Complex endpoints such as presets, queue, and announcements can only be partially emulated.
- Room-name routing has to map to households, groups, and players that can change externally.
- Two state caches can diverge.

### Best use

Alternative A is useful as a compatibility adapter and fallback layer, not as the main product architecture.

Recommended scope for a first hybrid implementation:

- `/zones`
- `/state`
- `play`, `pause`, `playpause`, `next`, `previous`
- `volume`, `groupvolume`, `mute`, `groupmute`
- `repeat`, `shuffle`, `crossfade`
- `favorites`, `favorite`, `playlists`, `playlist`
- basic group membership operations
- `linein` if capability is confirmed
- `clip`/`say` only through an explicit cloud-audioClip capability path

Explicitly out of scope for transparent hybrid emulation:

- raw queue compatibility
- raw `setavtransporturi`
- `lockvolumes`
- generic `musicsearch`
- service-specific URI shortcuts unless converted through a product-owned music service layer
- full preset parity

## Alternative B: Direct Cloud API in SonoX-Pro/SonoX-Music-Server

### Concept

This repository remains the local Sonos bridge. SonoX-Pro and/or SonoX-Music-Server implement a cloud-native `CloudSonosService` with OAuth onboarding, token storage, household selection, event webhooks, cloud queue support, and a product-domain API.

The old `node-sonos-http-api` API remains available for LAN/Loxone/local automation compatibility.

### Strengths

- Cloud-specific concepts are represented cleanly instead of being squeezed into legacy URL routes.
- OAuth, refresh tokens, multi-account, multi-household, and user consent fit better into the SonoX product UI/backend.
- Cloud queue and playback sessions can be implemented correctly.
- Commercial security and privacy requirements are easier to satisfy.
- Better future-proofing for official Sonos API changes.
- Easier to show users clear state: local mode, cloud mode, offline, token expired, household unavailable.

### Weaknesses

- SonoX-Pro/SonoX-Music-Server need new service-layer work.
- There is a risk of duplicate local/cloud Sonos logic unless a shared domain model is designed.
- Loxone integrations still need the local bridge or a compatibility gateway.
- More product decisions are required around user onboarding, account linking, and remote access.

### Best use

Alternative B is the recommended commercial product architecture. It keeps this API stable and lets the product layer use Sonos Cloud features properly.

## Decision matrix

| Criterion | Alternative A: Hybrid in this API | Alternative B: Direct in SonoX |
| --- | --- | --- |
| Existing API compatibility | Very high for compatible operations | High if old bridge remains available |
| Loxone compatibility | Best | Requires bridge or separate compatibility endpoint |
| Maintainability | Medium/Low as scope grows | High if service boundaries are clean |
| Implementation effort | Medium initially, high for edge cases | Higher initially, lower long-term complexity |
| Risk of behavioral regressions | Medium/High | Low for old API, medium for new product features |
| OAuth/token complexity | Awkward inside bridge | Natural in product backend/UI |
| Offline/LAN capability | Excellent with local-first | Excellent if local bridge remains |
| Cloud-only/remote capability | Partial | Strong |
| Cloud queue/session correctness | Weak if forced into legacy API | Strong |
| Event subscription model | Possible but infrastructure-heavy | Better fit for product backend |
| Commercial product fit | Limited as primary architecture | Strong |
| Technical debt risk | High if overextended | Medium if local/cloud domains are unified |
| User onboarding | Hard in headless bridge | Good in product UI |
| Future Sonos API evolution | Harder to absorb | Easier to absorb |

## Recommended target architecture

### High-level shape

```text
SonoX-Pro / SonoX-Music-Server
  CloudSonosService
    AuthService
    TokenStore
    HouseholdService
    GroupService
    PlayerService
    PlaybackService
    VolumeService
    EventSubscriptionService
    CloudQueueService

node-sonos-http-api
  Existing HTTP routes
  CompatibilityAdapter
  ProviderResolver
    LocalSonosProvider
    CloudSonosProvider (limited compatibility provider)
  Existing SSE /events
```

### Provider interface

```js
class SonosProvider {
  get id() {
    throw new Error('Not implemented')
  }

  get capabilities() {
    return {}
  }

  async getZones() {}
  async getState(roomName) {}

  async play(roomName) {}
  async pause(roomName) {}
  async togglePlayPause(roomName) {}
  async next(roomName) {}
  async previous(roomName) {}
  async seek(roomName, position) {}
  async setPlayModes(roomName, modes) {}

  async setPlayerVolume(roomName, value) {}
  async setGroupVolume(roomName, value) {}
  async setPlayerMute(roomName, muted) {}
  async setGroupMute(roomName, muted) {}

  async getFavorites(options = {}) {}
  async loadFavorite(roomName, favoriteNameOrId) {}
  async getPlaylists(options = {}) {}
  async loadPlaylist(roomName, playlistNameOrId) {}

  async join(roomName, targetRoomName) {}
  async leave(roomName) {}

  async applyPreset(preset) {}
  async announce(roomName, announcement) {}

  async subscribeEvents(eventSink) {}
}
```

### CloudSonosProvider pseudocode

```js
class CloudSonosProvider extends SonosProvider {
  constructor({
    cloudClient,
    topologyCache,
    favoriteCache,
    playlistCache,
    compatibilityAdapter,
    errorMapper
  }) {
    super()
    this.client = cloudClient
    this.topology = topologyCache
    this.favorites = favoriteCache
    this.playlists = playlistCache
    this.compat = compatibilityAdapter
    this.errors = errorMapper
  }

  get id() {
    return 'cloud'
  }

  get capabilities() {
    return {
      playback: true,
      playerVolume: true,
      groupVolume: true,
      favorites: true,
      playlists: true,
      audioClip: true,
      legacyQueue: false,
      rawAvTransportUri: false,
      volumeLock: false
    }
  }

  async getZones() {
    const household = await this.topology.getSelectedHousehold()
    const groups = await this.client.get(`/households/${household.id}/groups`)
    return this.compat.toLegacyZones(groups)
  }

  async play(roomName) {
    const group = await this.topology.resolveGroupByRoom(roomName)
    await this.client.post(`/groups/${group.id}/playback/play`, {})
    return { status: 'success' }
  }

  async pause(roomName) {
    const group = await this.topology.resolveGroupByRoom(roomName)
    await this.client.post(`/groups/${group.id}/playback/pause`, {})
    return { status: 'success' }
  }

  async setPlayerVolume(roomName, value) {
    const player = await this.topology.resolvePlayerByRoom(roomName)
    const command = value.startsWith('+') || value.startsWith('-')
      ? 'setRelativeVolume'
      : 'setVolume'
    const body = command === 'setRelativeVolume'
      ? { volumeDelta: Number(value) }
      : { volume: Number(value) }

    await this.client.post(`/players/${player.id}/playerVolume/${command}`, body)
    return { status: 'success' }
  }

  async loadFavorite(roomName, favoriteNameOrId) {
    const group = await this.topology.resolveGroupByRoom(roomName)
    const favorite = await this.favorites.resolve(favoriteNameOrId)

    await this.client.post(`/groups/${group.id}/favorites/loadFavorite`, {
      favoriteId: favorite.id
    })

    return { status: 'success' }
  }

  async applyPreset(preset) {
    const unsupported = this.compat.findUnsupportedPresetSteps(preset, this.capabilities)
    if (unsupported.length > 0) {
      throw new UnsupportedFeatureError('Preset contains cloud-unsupported steps', {
        unsupported
      })
    }

    return this.compat.applyCloudSafePreset(this, preset)
  }
}
```

### Cloud client and auth pseudocode

```js
class SonosCloudClient {
  constructor({ tokenStore, authService, rateLimiter, logger }) {
    this.tokenStore = tokenStore
    this.auth = authService
    this.rateLimiter = rateLimiter
    this.logger = logger
  }

  async request(method, path, body) {
    await this.rateLimiter.waitForSlot()

    let token = await this.tokenStore.getValidAccessToken()

    try {
      return await this.send(method, path, body, token)
    } catch (err) {
      if (!isUnauthorized(err)) {
        throw err
      }

      token = await this.auth.refreshAccessToken()
      return this.send(method, path, body, token)
    }
  }

  async send(method, path, body, token) {
    // Sends JSON request to https://api.ws.sonos.com/control/api/v1
    // Adds Authorization: Bearer <token>, Content-Type, User-Agent,
    // and maps Sonos errors through ErrorMapper at the provider boundary.
  }
}
```

## Proposed module structure

Inside this repository, if Alternative A is implemented as limited hybrid compatibility:

```text
lib/providers/
  SonosProvider.js
  ProviderResolver.js
  local/
    LocalSonosProvider.js
  cloud/
    CloudSonosProvider.js
    CloudAnnouncementProvider.js
    SonosCloudClient.js
    AuthService.js
    TokenStore.js
    HouseholdService.js
    GroupService.js
    PlayerService.js
    PlaybackService.js
    VolumeService.js
    FavoritesService.js
    PlaylistService.js
    AudioClipService.js
    EventSubscriptionService.js
    CloudEventWebhook.js
    RateLimiter.js
  compat/
    CompatibilityAdapter.js
    LegacyResponseMapper.js
    ErrorMapper.js
    UnsupportedFeatureError.js
  config/
    ProviderConfig.js
```

Potential SonoX-Pro/SonoX-Music-Server structure for Alternative B:

```text
src/sonos/
  cloud/
    CloudSonosService.ts
    SonosOAuthController.ts
    SonosTokenStore.ts
    SonosHouseholdRepository.ts
    SonosEventWebhookController.ts
    SonosPlaybackFacade.ts
    SonosCloudQueueServer.ts
  local/
    NodeSonosHttpApiClient.ts
  domain/
    SonosRoom.ts
    SonosGroup.ts
    SonosPlaybackState.ts
    SonosCapability.ts
    SonosError.ts
```

## Existing files likely affected by a hybrid implementation

Low-risk additions:

- `lib/providers/**`
- `test/providers/**`
- `test/cloud-provider.test.js`
- `test/provider-resolver.test.js`
- `docs/**`
- `static/docs/api-docs.json` if new optional auth/diagnostic endpoints are added

Controlled route integration:

- `lib/sonos-http-api.js`
- selected files in `lib/actions/` only after a provider interface exists

High-risk files to touch cautiously:

- `lib/actions/preset.js`
- `lib/actions/presetplay.js`
- `lib/actions/say.js`
- `lib/actions/clip.js`
- `lib/actions/queue.js`
- `lib/actions/favorite.js`
- `lib/actions/playlist.js`
- `vendor/sonos-discovery/lib/SonosSystem.js`
- `vendor/sonos-discovery/lib/Player.js`
- `vendor/sonos-discovery/lib/Player/AVTransport.js`
- `vendor/sonos-discovery/lib/Player/RenderingControl.js`
- `vendor/sonos-discovery/lib/Player/ContentDirectory.js`

The vendored local discovery fork should remain the local provider backend. It should not be polluted with cloud concepts.

## Configuration layer

Required configuration concepts:

- provider mode: `local`, `cloud`, `local-first`, `cloud-first`
- per-room provider override
- selected Sonos account
- selected household
- OAuth client ID and secret
- OAuth redirect URI
- cloud event callback URL
- token storage backend
- cloud event subscription renewal interval
- rate limit settings
- fallback policy
- unsupported feature policy: `return-error`, `fallback-local`, or `ignore` where safe

Sensitive values must not be exposed through `/debug`, Scalar examples, logs, or error responses.

## Security and privacy requirements

OAuth tokens:

- Store refresh tokens server-side only.
- Encrypt tokens at rest.
- Support token rotation and revocation.
- Redact all tokens in logs and debug output.
- Use a refresh lock to avoid parallel refresh races.
- Separate tokens by Sonos account and household.
- Do not expose OAuth secrets to browser-only clients.

Event webhooks:

- Require HTTPS with a trusted certificate.
- Verify Sonos event signatures.
- Respond quickly and process asynchronously.
- Reject unknown household/account combinations.
- Log only redacted event metadata.
- Renew subscriptions before expiration.

Data protection:

- Treat room names, household IDs, player IDs, account IDs, playback metadata, and favorites/playlists as user data.
- Provide diagnostics that can be shared without leaking account or token secrets.

## Fallback strategy

Recommended modes:

- `local`: current behavior only.
- `local-first`: use local provider when available; cloud fallback only for safe commands.
- `cloud-first`: use cloud provider for selected product contexts; local fallback only where semantics match.
- `cloud`: cloud only; unsupported legacy endpoints return explicit unsupported errors.

Fallback must not silently change semantics for:

- queue operations
- preset operations with unsupported steps
- TTS/clip operations requiring playback restore parity
- volume locking
- raw URI playback
- cloud queue/playback session operations

In those cases, returning a precise unsupported-provider error is safer than returning fake success.

## Risk analysis

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Legacy API behavior changes | Breaks SonoX-Pro, Loxone, automations | Keep HTTP route contract stable; add endpoint-level regression tests |
| Leaky provider abstraction | Hard-to-debug behavior differences | Capability model and explicit unsupported errors |
| OAuth/token mishandling | Security incident | Product-owned AuthService, encrypted TokenStore, redaction, refresh locks |
| Cloud group IDs expire/change | Commands target wrong group or fail | Resolve group by room/player before command; handle 404/410 by refreshing topology |
| Event subscriptions expire | Stale state | Renewal scheduler, health checks, fallback polling where safe |
| Public webhook unavailable | No cloud events | Surface degraded state; do not pretend cloud events are live |
| Rate limits | Command failures and poor UX | Debounce sliders, local state batching, rate limiter, backoff on 429 |
| Command ordering not guaranteed | Race conditions | Serialize commands per group in client where needed |
| Queue semantic mismatch | Broken playback assumptions | Do not map legacy queue to cloud queue except for app-owned sessions |
| Preset semantic mismatch | Unexpected playback/grouping side effects | Cloud-safe preset subset and tests |
| Two Sonos access layers diverge | Confusing state and duplicate bugs | Shared domain model in SonoX; bridge remains compatibility boundary |
| Local LAN unavailable | Old API loses core value | Cloud fallback for safe commands only |
| Cloud outage | Remote control unavailable | Local-first mode and clear diagnostics |

## Implementation plan

### Phase 1: Analysis and API mapping

- Freeze the current public endpoint list from `lib/actions/` and `static/docs/api-docs.json`.
- Add a machine-readable endpoint inventory test if feasible.
- Create a compatibility matrix for each endpoint and alias.
- Confirm exact Sonos Cloud reference paths and namespace versions for selected commands.
- Define cloud-safe and local-only categories.

### Phase 2: Provider abstraction

- Introduce `SonosProvider`, `LocalSonosProvider`, and `ProviderResolver`.
- Wrap existing local calls without changing behavior.
- Add tests proving local provider responses match current action behavior.
- Keep route handlers backward-compatible.

### Phase 3: OAuth/AuthService

- Implement OAuth Authorization Code Flow outside public playback routes.
- Add encrypted `TokenStore`.
- Implement refresh handling, refresh locking, redaction, and token diagnostics.
- Add account and household selection model.

### Phase 4: CloudSonosProvider for core functions

- Implement topology, playback, volume, favorites, playlists.
- Add rate limiter and error mapper.
- Add event subscription service only after a callback URL is configured.
- Do not implement queue/preset/TTS parity yet.

### Phase 5: Compatibility adapter

- Map cloud provider responses to existing JSON shapes.
- Preserve aliases and default compact/detailed behavior.
- Add explicit unsupported errors for local-only operations.
- Add optional fallback policy.

### Phase 6: Tests against existing SonoX-Pro usage

- Build endpoint-level tests for the known SonoX-Pro and Loxone call patterns.
- Mock local and cloud providers.
- Verify response shapes, status codes, aliases, and error behavior.
- Add regression tests for favorites, playlists, presets, queue, and announcements.

### Phase 7: Feature-gap analysis

- Run each existing endpoint through the provider capability matrix.
- Identify which gaps should stay local-only.
- Identify which gaps belong in SonoX-Pro/SonoX-Music-Server cloud-native services.
- Decide whether audioClip can safely power `clip`/`say` variants.

### Phase 8: Hybrid vs direct cloud decision checkpoint

- Use test results and product requirements to decide final product boundary.
- If commercial cloud features are central, move cloud-native logic to SonoX.
- Keep this repository as local bridge plus limited compatibility cloud fallback.

### Phase 9: Documentation and migration strategy

- Update README and Scalar docs.
- Add setup docs for local-only, local-first, cloud-first, and cloud-only modes.
- Add clear unsupported endpoint documentation.
- Document OAuth setup, webhook requirements, token storage, and diagnostics.
- Provide migration notes for SonoX-Pro, SonoX-Music-Server, and Loxone users.

## Test strategy

Endpoint contract tests:

- Snapshot existing responses for core endpoints.
- Test aliases: `favorite`/`favourite`, `favorites`/`favourites`, group mute aliases.
- Test compact vs detailed list endpoints.
- Test error responses for unknown rooms/actions.

Provider tests:

- `LocalSonosProvider` wraps current discovery/player behavior.
- `CloudSonosProvider` maps commands to expected Sonos Cloud calls.
- `ProviderResolver` chooses the correct provider by config, room, and fallback policy.
- `CompatibilityAdapter` converts provider responses into legacy JSON.

Cloud client tests:

- OAuth code exchange.
- Token refresh.
- Parallel refresh lock.
- 401 retry once after refresh.
- 429 backoff and `Retry-After`.
- 404/410 topology refresh.
- Redacted logging.

Event tests:

- Sonos webhook signature verification.
- Subscription renewal scheduling.
- Cloud event to internal event mapping.
- Internal event to `/events` SSE format.

Feature-sensitive tests:

- Favorites title resolution and collision handling.
- Playlist title resolution and collision handling.
- Preset cloud-safe subset.
- Unsupported preset steps.
- AudioClip capability checks.
- Local fallback behavior when cloud is unavailable.

Integration tests:

- Mock Sonos Cloud API with HTTP fixtures.
- Mock local discovery with existing test helpers.
- Run known SonoX-Pro and Loxone endpoint sequences.
- Add manual tests for real Sonos hardware behind an opt-in environment flag.

## Migration plan

Recommended migration path:

1. Keep all existing local endpoints unchanged.
2. Add provider abstraction behind tests without enabling cloud by default.
3. Add cloud auth and diagnostics as opt-in.
4. Add cloud support for safe core commands only.
5. Add provider capability reporting.
6. Let SonoX-Pro consume cloud-native APIs directly for advanced features.
7. Use this API only as local compatibility bridge or limited cloud fallback.
8. Update Scalar docs to make provider support explicit per endpoint.

Do not migrate existing users automatically to cloud mode. Cloud mode should require explicit configuration and user authorization.

## Open questions for the Product Owner

- Should cloud support be a SonoX-Pro premium/commercial feature, or a general bridge feature?
- Should Loxone users ever be allowed to send commands through cloud fallback, or should Loxone remain LAN-only?
- Is remote control outside the local network a product requirement?
- Is multi-household support required at launch?
- Is multi-Sonos-account support required at launch?
- Should SonoX-Pro own OAuth onboarding UI?
- Where should tokens be stored in deployed installations?
- Is there an existing secure storage mechanism in SonoX-Pro/SonoX-Music-Server?
- Are cloud event webhooks feasible for typical customer deployments?
- Should the product require a public HTTPS endpoint, or should events be optional?
- Which preset features are truly required in cloud mode?
- Should `say`/`clip` use Sonos `audioClip` even if restore semantics differ from local announcements?
- Are cloud queues needed, or is favorites/playlists/stream loading enough?
- Which exact SonoX-Pro endpoint calls must be guaranteed before any provider switch?
- Should unsupported cloud endpoints return HTTP errors, local fallback, or documented no-op behavior?

## Final recommendation

Build Alternative B as the commercial-grade architecture: a dedicated cloud-native Sonos service in SonoX-Pro/SonoX-Music-Server. Use this repository for what it is best at: local Sonos LAN control, Loxone-friendly URL endpoints, and backwards-compatible automation.

Implement Alternative A only as a limited compatibility layer inside this repository, with a strict capability matrix and explicit unsupported behavior. This gives existing users continuity without forcing cloud-only concepts into an API that was designed for local UPnP/SOAP control.
