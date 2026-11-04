# Contract: starting the SCC-App from the website

The HQ pages offer one action, "SCC-App starten" (`src/app/desktop/scc-app-launcher.service.ts`). It opens a URL the desktop app registers for itself. If nothing answers, the website downloads the installer.

## URL

```
star-citizen-companion://open
```

`open` is the only action, and it carries no parameters. The app treats the URL as "bring yourself to the front" and ignores anything else in it, because any website can open this URL.

## What the desktop app must do

- Register the scheme for the current user, pointing at the installed root launcher, which is never replaced by an update: `HKCU\Software\Classes\star-citizen-companion`.
- Register it in the installer for fresh installs, and on app start so existing installs get it through the auto-update.
- Remove the registration on uninstall.
- If the app is not running, start it normally. If it is already running, including tray-only, show the main window and take the focus.
- If the user is signed out, show the normal sign-in. The URL never carries a token or an account.

## How the website reads the result

A browser does not report whether a scheme has a handler. The website waits 2.5 s for a focus change, caused by the browser's "open this app?" prompt or by the app itself.

| Result | Website |
| --- | --- |
| Focus changed | Says the app is starting and remembers this for the browser |
| No change, and the app never answered in this browser | Starts the installer download and says so |
| No change, but the app answered here before | Starts nothing and offers the download |

The website's CSP must keep the scheme in `frame-src` (`vercel.json`), because the URL is opened through a hidden frame.
