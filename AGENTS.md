# AGENTS.md — Iron Ledger (Pelagio & Wanix KB Tracker)

## What this is
A small offline-first PWA for logging kettlebell workouts for two people
(Pelagio and Wanix). Firestore is the source of truth (offline-capable,
syncs automatically), and every save also mirrors — best-effort, queued
on failure — to a Google Sheet via an Apps Script web app.

The design, exercise programming, and backend wiring are already decided.
The only open task is **hosting this on GitHub Pages** so it can be
installed on both phones. Don't redesign the app, the exercise plan, or
the data model as part of that — just ship it.

## Already done outside this repo — do not redo or "fix"
- Firebase project created, Firestore enabled. Security rules
  (`firestore.rules`) require Google sign-in and restrict read/write to
  the two approved emails (`chavezheras@gmail.com`,
  `aramayo.pilar@gmail.com`). Those emails are duplicated in
  `ALLOWED_EMAILS` in `app.js` — keep the two lists in sync.
- Google sign-in is enabled in Firebase Authentication, and
  `chavezheras.github.io` is on the Authorized-domains list.
- `firebaseConfig` in `app.js` is already filled with real values. If you
  see `REPLACE_ME` there, ask before touching it — don't regenerate or
  blank it out.

## Auth: use signInWithPopup, NOT signInWithRedirect
The app is served from `chavezheras.github.io` but Firebase's
`authDomain` is `iron-ledger-fb61a.firebaseapp.com`. Modern browsers
partition storage across those two domains, so `signInWithRedirect`
never completes — the user authenticates at Google, comes back, and
lands on the sign-in screen again. `signInWithPopup` keeps the OAuth
hand-off on Firebase's own domain and works. Redirect is kept only as a
fallback for environments with no popup support. GitHub Pages can't
proxy `/__/auth/`, so this can't be "fixed" by switching back to
redirect — only by moving hosting onto the Firebase `authDomain`.
- `SHEETS_WEBHOOK_URL` in `app.js` is already filled with the deployed
  Apps Script URL.
- The live Apps Script lives in the Google Sheet's own script editor —
  `sheets-export.gs` in this repo is a reference copy only. Editing it
  here does nothing until it's re-pasted into the Sheet by hand.

## App shape
`app.js` renders a single-page **workout wizard** driven by `ui.page`:
- **Page 0** — welcome: date picker, big Pelagio/Wanix switch, that
  profile's session count + last-workout date, "Start / Continue" button.
- **Pages 1–3** — one superset each; a big "Next" button opens a
  fullscreen 1:00 countdown, then auto-advances.
- **Page 4** — finisher (two optional rep fields) + "Save workout".

Entered values live in `draft` (raw strings), mirrored to
`localStorage['iron-wizard']` on every keystroke so navigation, reloads,
and failed saves never lose them. A save is only shown green ("WORKOUT
SAVED") after the doc is read back from the server; offline shows amber,
real errors show red — all keep the draft. There is no History view
(charts/progress) — it was removed; `getLastEntry` still drives the
"last time" hints and weight pre-fill.

Firestore writes use a **nested `entries` map** with `set({merge:true})`.
Do NOT switch to flat `{ 'entries.<id>': ... }` keys — `set()` doesn't
treat dots as field paths (only `update()` does), so that form creates a
literal `"entries.<id>"` field, leaves no `entries` map, and every write
fails `firestore.rules`' `validSession()` with `permission-denied`.

## File map
| File | Role |
|---|---|
| `index.html` | App shell — loads Firebase SDK, `app.js`, registers `sw.js`; countdown-overlay markup + all CSS |
| `app.js` | All logic: exercise definitions, wizard rendering, draft persistence, Firestore reads/writes, Sheets-sync queue, countdown timer |
| `sw.js` | Service worker — caches the app shell so it opens instantly offline |
| `manifest.json` | PWA metadata (name, colors, icons) — what makes "Add to Home Screen" work |
| `icon-192.png` / `icon-512.png` | Home-screen icons |
| `sheets-export.gs` | Reference copy of the Apps Script — not deployed from here |

## Hard constraints
- **Stay static, no build step.** Vanilla HTML/CSS/JS only — no bundler,
  no framework, no `npm install`. It must work by opening `index.html`
  directly (aside from the service worker needing `http(s)`, see below).
- **Keep all paths relative** (`./app.js`, not `/app.js`). GitHub Pages
  project sites serve from a subpath
  (`https://<user>.github.io/<repo>/`), and absolute paths will 404
  there even though they work fine on localhost.
- **Bump `CACHE_NAME` in `sw.js`** (currently `iron-ledger-v13`) any time
  `index.html`, `app.js`, `sw.js`, or an icon changes. The service worker
  otherwise keeps serving the old cached files forever, even after a new
  deploy — this is the #1 cause of "I pushed a fix but the phone still
  shows the old version."
- **Don't touch the visual design tokens** (the CSS variables in
  `index.html`'s `<style>` — `--accent-pelagio`, `--accent-wanix`, fonts,
  etc.) unless explicitly asked. The color-coding and layout are
  intentional, not defaults.
- **Don't change the Firestore document shape**
  (`{ profile, date, entries }`) or the exercise ids (`squat`, `row`,
  `deadlift`, `press`, `lunge`, `pushup`, `swing`) without also updating
  `sheets-export.gs` to match — the two are coupled, and a mismatch means
  the Sheet silently stops reflecting new exercises.

## GitHub Pages deployment
1. Put `index.html`, `app.js`, `sw.js`, `manifest.json`, and both icons at
   the **repo root**. GitHub Pages' "Deploy from a branch" option only
   offers `/ (root)` or `/docs` as source folders — root is simplest.
2. Commit and push to a **public** repo (Pages on the free plan requires
   public; private-repo Pages needs GitHub Pro/Team/Enterprise).
3. Repo → Settings → Pages → Source: "Deploy from a branch" → branch
   `main`, folder `/ (root)` → Save.
4. GitHub serves it at `https://<username>.github.io/<repo>/` within a
   minute or two.
5. On each phone, open that URL and use the browser's "Add to Home
   Screen" (iOS Safari) or "Install app" (Android Chrome).
6. Test offline before calling it done: open the installed app, enable
   airplane mode, confirm it still opens and a save queues locally; turn
   connectivity back on and confirm the Sheet picks up the entry.

## Local testing before pushing
Service workers require `http(s)`, not `file://`:
```bash
cd path/to/repo
python3 -m http.server 8000
```
Then open `http://localhost:8000` in a browser.

## Security note
The open Firestore rule and the public `firebaseConfig` are a deliberate,
low-stakes choice for a private 2-person tool — Firebase's own client
config is meant to be public; the real access control is the Firestore
rule, not hiding the key. If asked to "harden" this later, that means
adding Firebase Anonymous Auth plus rules keyed to specific UIDs — not
obscuring the config or moving it server-side.

## If something breaks
- **Sign-in loops back to the sign-in screen** → `signInWithRedirect`
  is being used, or `chavezheras.github.io` was dropped from Firebase
  Authorized domains. See the auth section above.
- **Save shows "NOT SAVED (permission-denied)"** → either the write
  payload lost its nested `entries` map (see App shape), or the signed-in
  Google account isn't in both `ALLOWED_EMAILS` and `firestore.rules`.
- **Blank screen / console errors mentioning `firebase`** → check
  `firebaseConfig` wasn't accidentally reverted to `REPLACE_ME`.
- **Saves not showing up in the Sheet** → check `SHEETS_WEBHOOK_URL`, or
  that the Apps Script deployment's access is still "Anyone." Both live
  in the Google account, not this repo, so they can't be fixed by
  editing code here.
- **Phone shows an old version after a deploy** → bump `CACHE_NAME` in
  `sw.js`, then close and reopen the installed app once (or
  uninstall/reinstall) to force the new service worker to take over.
