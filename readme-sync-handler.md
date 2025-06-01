# SonoX – TextInputSync Handler

This feature allows the transmission of current Sonos playback metadata (title, artist, radio station, and playback state) from SonoX to a Loxone Miniserver using HTTP virtual text inputs.

## What is sent?

For each Sonos zone, the following data is transmitted:

| Data             | Endpoint Format                                 | Example                              |
|------------------|--------------------------------------------------|--------------------------------------|
| Track Title      | `sonox_<zone>_current_title`                    | `sonox_kitchen_current_title`        |
| Track Artist     | `sonox_<zone>_current_artist`                   | `sonox_kitchen_current_artist`       |
| Radio Station    | `sonox_<zone>_current_radio`                    | `sonox_kitchen_current_radio`        |

If no radio station is playing (e.g. when using Spotify or local content), the value sent to `sonox_<zone>_current_radio` is an empty string (`""`). This can be used in logic blocks in Loxone to detect non-radio playback or to hide unused labels in the UI.
| Playback State   | `sonox_<zone>_current_state`                    | `sonox_kitchen_current_state`        |

### Playback State Labels

The `playbackState` from Sonos is mapped to readable strings:

- `PLAYING` → `Playing`
- `PAUSED_PLAYBACK` → `Paused`
- `STOPPED` → `Stopped`

Only these states trigger the transmission.

## Requirements

To use this feature, the following prerequisites must be met:

- A valid **SonoX Pro** license key must be present.
- TextInputSync must be **enabled** in `settings.json`.
- The IP, port, username, and password of your **Loxone Miniserver** must be configured.
- Corresponding **Virtual Text Inputs** must be created manually in Loxone Config with matching names (e.g., `sonox_kitchen_current_title`).
- The user configured in Loxberry must be part of the **Administrator** group in the Loxone Miniserver.

## Example Configuration Block in settings.json

```json
"textInputSync": {
  "enabled": true,
  "host": "192.168.0.200",
  "port": "80",
  "user": "admin",
  "pass": "password",
  "use_ssl": false
}
```

All data is sent via HTTP POST requests to the following endpoint on your Loxone Miniserver:

```
http://<miniserver-ip>:<port>/dev/sps/io/<virtual-text-input-name>?value=<encoded-value>
```

For example:
```
http://192.168.0.200:80/dev/sps/io/sonox_kitchen_current_title?value=Shake%20It%20Off
```

The virtual text input must exist in Loxone Config for the request to succeed. Otherwise, the Miniserver will return a 404 error.