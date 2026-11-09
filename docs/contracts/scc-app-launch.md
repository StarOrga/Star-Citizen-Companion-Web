# Contract: starting the SCC-App from the website

The Jetzt and Statistik pages offer one action, "SCC-App starten" (`src/app/desktop/scc-app-launcher.service.ts`). It opens a URL the desktop app registers for itself. If nothing answers, the website downloads the installer.

The HQ Start page names the action by what it knows. With no game signal on the account and no memory in this browser it says "SCC-App downloaden" and its click downloads the installer without trying the URL. With a game signal on the account or a memory in this browser it says "SCC-App starten" and works as described below.

## URL

```
star-citizen-companion://open
```

The scheme keeps its pre-rename name on purpose (Verse Companion rename, stage 2). Installed apps up to v0.104 register only `star-citizen-companion://`; a click on a new scheme would find no handler there and fall through to the installer download. The desktop release that registers both `star-citizen-companion` and `verse-companion` is in progress. The website switches to `verse-companion://open` once that release is the oldest supported one; until then the old name is the only one the website calls.

`open` is the only action, and it carries no parameters. The app treats the URL as "bring yourself to the front" and ignores anything else in it, because any website can open this URL.

## What the desktop app must do

- Register the scheme for the current user, pointing at the installed root launcher, which is never replaced by an update: `HKCU\Software\Classes\star-citizen-companion`.
- Register it in the installer for fresh installs, and on app start so existing installs get it through the auto-update.
- Remove the registration on uninstall.
- If the app is not running, start it normally. If it is already running, including tray-only, show the main window and take the focus.
- If the user is signed out, show the normal sign-in. The URL never carries a token or an account.

## How the website reads the result

A browser does not report whether a scheme has a handler. The website waits for a focus change, caused by the browser's "open this app?" prompt or by the app itself: 2.5 s while the app never answered in this browser (a download hangs on the result), 15 s once it did (nothing hangs on it, and a browser that always allows the app shows no prompt, so only the app's own window can take the focus, after its cold start).

| Result | Website |
| --- | --- |
| Focus changed | Says the app is starting and remembers this for the browser |
| No change, and the app never answered in this browser | Starts the installer download and says so |
| No change, but the app answered here before | Starts nothing, says it got no word (the app may still be running: it may not take the focus) and offers the download |

The memory in this browser (`sc.sccApp.launchedBefore`) is set when the app answers a launch and when the website sees the game running on the account through the app's live signal.

The website's CSP must keep the scheme in `frame-src` (`vercel.json`), because the URL is opened through a hidden frame.
