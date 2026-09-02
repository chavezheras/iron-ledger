# Iron Ledger

Iron Ledger is a small offline-first progressive web app for logging kettlebell workouts. I created it because I was frustrated with bloated apps that have too many features I don't need, are expensive, or have loads of adds and are data hungry. I was also suprised of how many apps want a permament connection to the internet to even be usable. Iron Ledger runs as a static HTML/CSS/JavaScript app, stores workout sessions in Firestore, and mirrors saves to a Google Sheet through an Apps Script web app.

## Features

- Separate workout profiles for two people behind Google sign-in
- Date-based workout sessions
- Exercise weights and reps tracking (fixed 5 month programme)
- Latest workout date in the session view
- Save confirmation for synced and offline workouts
- Protection against empty saves and duplicate save clicks
- One-minute rest timers between strength supersets
- One-minute conditioning finisher
- History view with weight trend charts and recent logs
- Offline app shell and Firestore persistence
- Installable PWA for phones

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html` | App shell, styles, Firebase SDK loading, and service-worker registration |
| `app.js` | Workout definitions, rendering, Firestore persistence, Sheets sync, and UI behavior |
| `manifest.json` | PWA metadata and install icon configuration |
| `sw.js` | Offline app-shell cache and cache versioning |
| `sheets-export.gs` | Reference Apps Script for mirroring sessions to Google Sheets |
| `firestore.rules` | Firestore rules requiring authenticated users and valid session data |
| `firebase.json` | Firebase CLI configuration for deploying Firestore rules |
| `new_icon.png` | Current PWA and home-screen icon |

## Local Development

No build step or package installation is required.

From the repository directory, run:

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a browser. A local HTTP server is recommended because service workers do not work from `file://` URLs.

## Deployment

The app is deployed from the `main` branch root using GitHub Pages.

Live app: [https://chavezheras.github.io/iron-ledger/](https://chavezheras.github.io/iron-ledger/)

To deploy an update:

1. Commit the changes.
2. Push to `main`.
3. Wait for GitHub Pages to publish the new files.
4. Reload the app. Installed phone versions may need to be closed and reopened so the service worker updates.

Increment `CACHE_NAME` in `sw.js` whenever `index.html`, `app.js`, `sw.js`, `manifest.json`, or an icon changes.

## Data and Sync

Firestore is the source of truth and supports offline persistence. Each session uses the document shape:

```text
{ profile, date, entries }
```

Every save is also sent to the configured Apps Script webhook. If the Sheets request fails, it is placed in a local retry queue and retried when connectivity returns.

The Firebase client configuration and Sheets webhook URL are stored in `app.js`. The Apps Script reference in `sheets-export.gs` must be pasted into the Google Sheet's Apps Script editor when setting up a new deployment.

Google sign-in must be enabled in Firebase Authentication. Access is restricted to the two approved Google email addresses in `ALLOWED_EMAILS` and `firestore.rules`.

## Version History

| Version | Status | Changes |
| --- | --- | --- |
| `0.1.0` | Released | Initial workout tracker with Pelagio and Wanix profiles, Firestore storage, Sheets mirror, history view, and PWA shell. |
| `0.2.0` | Released | Added save feedback, empty-workout protection, duplicate-click prevention, offline messaging, and the latest workout date. |
| `0.3.0` | Released | Replaced the continuous five-minute finisher with alternating two-minute swing and halo segments. |
| `0.4.0` | Released | Added one-minute rest timers between strength supersets. |
| `0.5.0` | Released | Reduced the finisher to one minute, changed Pelagio to blue `#393D7E`, changed Wanix to pink `#F05A7E`, improved mobile readability, and added the new icon. |
| `0.6.0` | Released | Prevented remote saves from clearing active workout forms and preserved existing exercise entries during partial saves. |
| `0.7.0` | In progress | Added Google sign-in, client and Apps Script validation, save throttling, safe rendering, and progress-to-ceiling cards in History. |

## License

This repository is a private household training tool. No license is currently specified.

## Security Note

The app requires Google sign-in, and Firestore rules restrict access to the two approved Google accounts. Deploy both the app and `firestore.rules` before storing sensitive health or personal information. The Firebase client configuration is public browser configuration, not a secret; the access rules and Apps Script webhook are the important security boundaries.
