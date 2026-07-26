//! Silent background self-update.
//!
//! Trust model — deliberately the data-uploader's, not a new one (there is still
//! NO code signing; see `.claude/deep-knowledge/starscape-release.md`).
//!
//! **The single trust anchor is the `desktop_releases` catalog row**, reached over
//! TLS through the `desktop-latest` edge function — the same feed electron-updater
//! polls for the uploader. Be honest about what that means: the expected SHA-256,
//! the byte size and the URL all come from that one row, so whoever can write it
//! (an admin JWT, or the service key) can hand us bytes that satisfy every check
//! below. There is no independent signature to fall back on. The checks are there
//! to stop a *tampered download*, a *wrong file* and a *corrupt transfer* — not a
//! compromised catalog. Closing that would need a baked public key over the
//! manifest, which is a deliberate Phase-2 omission, not an oversight.
//!
//! Given that anchor:
//!   * The build presents its baked `X-SC-Release-Token` (CI-generated per
//!     release, exactly like the uploader's vite `define`). `token_revoked` is the
//!     kill-switch for a leaked or bad build. For Starscape it is only proof of a
//!     known build — never a channel bypass.
//!   * The download URL must sit under the public binaries mirror's own
//!     owner/repo release path (`net::BINARY_URL_PREFIX`). A host-only allowlist
//!     would pin nothing: `github.com` serves release assets for every account.
//!   * The downloaded bytes must match the catalog's size AND SHA-256, and be a PE
//!     image, before anything is written over the running exe. All three are
//!     mandatory — a missing field fails the update rather than skipping a check.
//!   * A version that is not strictly newer is never installed (no downgrade), and
//!     a response the server clamped to a lower ring is never installed at all (no
//!     ring switch). The clamp is detected by comparing the ring we asked for
//!     against the `channel` the feed reports it actually served.
//!   * The swap itself is crash-safe: staged and flushed to `<exe>.new` first, then
//!     two metadata-only renames. See [`swap_running_exe`].
//!
//! Channel lock: the ring is decided by the download, never in the app — see
//! [`resolve_channel`]. There is deliberately no in-app channel picker.
//!
//! Surface: the tray menu, and nothing else. No balloons, no toasts, no dialogs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::crypto;
use crate::log;
use crate::net;
use crate::session;
use crate::util::{self, Channel};

/// The running build's version, from Cargo (also what CI bakes into VERSIONINFO).
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Per-release token baked in by CI (`SC_RELEASE_TOKEN`), mirroring the
/// data-uploader's `__SC_RELEASE_TOKEN__` build define. A local `cargo build`
/// gets the sentinel and simply omits the header.
pub const RELEASE_TOKEN: &str = match option_env!("SC_RELEASE_TOKEN") {
    Some(t) => t,
    None => "dev-token-unsigned",
};

const DEV_TOKEN: &str = "dev-token-unsigned";

/// Update-feed path. `product=starscape` selects the Starscape rings; the edge
/// function always resolves them through the role-clamped SQL resolver.
const FEED_PATH: &str = "/functions/v1/desktop-latest?product=starscape&channel=";

/// What the tray menu reports. Only ever changed by the update worker thread.
#[derive(Clone, PartialEq, Eq)]
pub enum State {
    /// No successful check yet (fresh start, or the feed was unreachable).
    Unknown,
    Checking,
    /// Confirmed up to date on the locked ring.
    Current,
    Available(String),
    Downloading,
    /// Verified and written over the running exe; active after the next start.
    /// Only ever seen when the relaunch was deferred (screensaver on screen).
    Installed(String),
    /// The locked ring is above the anonymous tier — a website sign-in is needed
    /// before this ring's builds are served.
    SignInRequired,
    /// Signed in, but the account's role does not reach the locked ring (e.g. a
    /// beta copy on a viewer account). Deliberately NOT actionable: clicking
    /// would only re-open a browser sign-in that cannot change the outcome.
    NotEntitled,
    /// Download / verification / install failed; clicking retries.
    Failed,
}

static STATE: Mutex<State> = Mutex::new(State::Unknown);

/// True while a cycle owns the update path. `STATE` cannot serve as the in-flight
/// lock: reading it and then setting `Checking` is check-then-act, so the 6 h poll
/// and a tray click can both pass. Two concurrent [`swap_running_exe`] calls are
/// genuinely destructive — one thread's `remove_file(<exe>.old)` deletes the other
/// thread's only copy of the original — so this is a real `compare_exchange`.
static CYCLE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Releases [`CYCLE_RUNNING`] however the cycle leaves — including a panic, which
/// would otherwise wedge the updater for the life of the process.
struct CycleGuard;

impl Drop for CycleGuard {
    fn drop(&mut self) {
        CYCLE_RUNNING.store(false, Ordering::SeqCst);
    }
}

pub fn state() -> State {
    STATE.lock().map(|s| s.clone()).unwrap_or(State::Unknown)
}

fn set_state(next: State) {
    if let Ok(mut s) = STATE.lock() {
        *s = next;
    }
}

/// A resolved build from the release catalog.
pub struct Release {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

/// The ring an asset name declares, or `None` when it carries no ring marker.
///
/// The website serves each ring under its own asset name
/// (`starscape-wallpaper-<ver>-beta.exe`), which is the only channel signal that
/// survives a plain single-file download — the binary itself is identical across
/// rings, because a ring is a promotion pointer, not a build.
fn channel_from_stem(stem: &str) -> Option<Channel> {
    let stem = stem.to_lowercase();
    if stem.contains("-alpha") {
        Some(Channel::Alpha)
    } else if stem.contains("-beta") {
        Some(Channel::Beta)
    } else if stem.contains("-stable") {
        Some(Channel::Stable)
    } else {
        None
    }
}

/// Ring declared by this copy's own filename, if any.
fn channel_from_exe_name() -> Option<Channel> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
        .as_deref()
        .and_then(channel_from_stem)
}

/// Decide the ring this install follows, given whatever was persisted before.
///
/// Precedence, and why:
///   1. **An explicit ring marker in our own filename wins.** That marker only
///      exists on a file downloaded from the website's per-ring link, i.e. it is
///      a ring choice the user made — before the download, on the website, which
///      is exactly where the choice is supposed to be made. A stable user who
///      deliberately fetches `…-beta.exe` therefore lands on beta instead of
///      having their download silently ignored. It cannot be an escalation: the
///      feed clamps every response to the account's role, so marking a copy
///      `-alpha` as a viewer buys nothing but [`State::NotEntitled`].
///   2. **Otherwise the persisted ring.** The version-less `latest` alias, a
///      `starscape-wallpaper (1).exe`, or a user rename carries no marker, so it
///      must never move an existing install between rings.
///   3. **Otherwise stable** — the safest ring, and the documented default.
///
/// There is still no in-app switch, which is the deliberate difference from the
/// data-uploader's runtime channel picker.
pub fn resolve_channel(stored: Option<Channel>) -> Channel {
    pick_channel(channel_from_exe_name(), stored)
}

/// The precedence rule of [`resolve_channel`], separated from the filesystem so
/// it can be tested exhaustively.
fn pick_channel(from_name: Option<Channel>, stored: Option<Channel>) -> Channel {
    from_name.or(stored).unwrap_or(Channel::Stable)
}

/// Tray label for the current state — the SCC "status readout" voice, and the
/// only place the updater ever talks to the user.
pub fn tray_label(channel: Channel) -> String {
    let ring = channel.as_str();
    match state() {
        State::Checking => util::t("◈ Suche nach Updates…", "◈ Checking for updates…"),
        State::Current => util::t(
            &format!("◈ Aktuell · v{CURRENT_VERSION} · {ring}"),
            &format!("◈ Up to date · v{CURRENT_VERSION} · {ring}"),
        ),
        State::Available(v) => util::t(
            &format!("▲ Update verfügbar · v{v}"),
            &format!("▲ Update available · v{v}"),
        ),
        State::Downloading => util::t("▼ Update wird geladen…", "▼ Downloading update…"),
        State::Installed(v) => util::t(
            &format!("◈ v{v} installiert · aktiv beim nächsten Start"),
            &format!("◈ v{v} installed · active on next start"),
        ),
        State::SignInRequired => util::t(
            &format!("◈ Anmelden für {ring}-Updates"),
            &format!("◈ Sign in for {ring} updates"),
        ),
        State::NotEntitled => util::t(
            &format!("◈ v{CURRENT_VERSION} · {ring} für dieses Konto nicht freigegeben"),
            &format!("◈ v{CURRENT_VERSION} · {ring} not enabled for this account"),
        ),
        State::Failed => util::t("▲ Update fehlgeschlagen · erneut versuchen", "▲ Update failed · retry"),
        State::Unknown => util::t(
            &format!("◈ Starscape v{CURRENT_VERSION} · {ring}"),
            &format!("◈ Starscape v{CURRENT_VERSION} · {ring}"),
        ),
    }
}

/// True when clicking the tray entry does something.
pub fn is_actionable() -> bool {
    matches!(state(), State::Available(_) | State::SignInRequired | State::Failed)
}

/// One full cycle: resolve the ring, and install straight away when a genuinely
/// newer build is offered. Runs on a worker thread; never touches the UI.
///
/// `interactive` marks a cycle the user started from the tray — only then may a
/// browser sign-in be opened. The periodic poll stays completely silent.
///
/// Returns `true` when a new build was written over the running exe and the app
/// should relaunch. The caller owns the relaunch because only the UI thread may
/// drop the tray icon and release the single-instance mutex first.
pub fn run_cycle(interactive: bool, channel: Channel, on_signed_in: &dyn Fn()) -> bool {
    // Single-flight, atomically: the poll thread and a tray click race here.
    if CYCLE_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return false;
    }
    let _guard = CycleGuard;

    // A build is already written over the running exe and only the relaunch is
    // outstanding. Checking again would re-download and re-swap the same asset on
    // every poll, because our own version string is still the old one.
    if matches!(state(), State::Installed(_)) {
        return false;
    }
    set_state(State::Checking);

    let mut token = session::ensure_access_token();
    let mut outcome = check(channel, token.as_deref());

    // Clamped while we believed we were signed in? A locally-unexpired JWT proves
    // nothing about server-side state — a web logout or password change revokes it
    // and the feed then reads us as anonymous, which looks exactly like "your role
    // is too low". Ask the auth server once: a rejected refresh clears the store
    // and turns this into the sign-in case below, which is the honest answer.
    if matches!(outcome, Outcome::Clamped) && token.is_some() {
        token = session::revalidate();
        if token.is_some() {
            outcome = check(channel, token.as_deref());
        }
    }

    // Ring above our tier and the user asked for it → sign in, then retry once.
    // Only worth a browser trip when we have NO usable session: being clamped with
    // a live one means the account's role, not its sign-in state, is the limit, and
    // re-authenticating as the same user cannot change that.
    if interactive && token.is_none() && matches!(outcome, Outcome::Clamped) {
        if let Some(fresh) = crate::auth::run_oauth_flow() {
            fresh.save();
            on_signed_in();
            token = Some(fresh.access_token);
            outcome = check(channel, token.as_deref());
        }
    }

    match outcome {
        Outcome::Clamped if token.is_some() => {
            log::line("update: signed in, but this account's role does not reach the locked ring");
            set_state(State::NotEntitled);
            false
        }
        Outcome::Clamped => {
            log::line("update: ring above the anonymous tier — website sign-in required");
            set_state(State::SignInRequired);
            false
        }
        Outcome::Failed => {
            // Offline / feed hiccup. Stay quiet: report the plain version, never
            // an error the user cannot act on.
            set_state(State::Unknown);
            false
        }
        Outcome::Current => {
            set_state(State::Current);
            false
        }
        Outcome::Newer(rel) => {
            log::line(&format!("update: v{} available on {}", rel.version, channel.as_str()));
            set_state(State::Available(rel.version.clone()));
            install(&rel)
        }
    }
}

enum Outcome {
    /// Feed unreachable or unparseable.
    Failed,
    /// The server clamped us to a lower ring than the locked one.
    Clamped,
    Current,
    Newer(Release),
}

/// Ask the release catalog what the locked ring currently serves.
fn check(channel: Channel, access_token: Option<&str>) -> Outcome {
    let mut headers = vec![
        format!("apikey: {}", net::API_KEY),
        "Accept: application/json".to_string(),
        format!("X-SC-Tool-Version: {CURRENT_VERSION}"),
    ];
    // The token proves "a known, non-revoked build"; the JWT is what unlocks a
    // ring above stable. Both are sent — the edge function always resolves
    // Starscape through the role-clamped RPC, so the token can never widen access.
    if RELEASE_TOKEN != DEV_TOKEN {
        headers.push(format!("X-SC-Release-Token: {RELEASE_TOKEN}"));
    }
    // Only ever send a real user JWT. Sending the publishable key as a Bearer
    // token would look like a signed-in caller with an unverifiable identity;
    // no header at all is what makes the server resolve us as anon → stable.
    if let Some(jwt) = access_token {
        headers.push(format!("Authorization: Bearer {jwt}"));
    }

    let path = format!("{FEED_PATH}{}", channel.as_key());
    let Some((status, text)) = net::https_text("GET", net::API_HOST, &path, &headers, None) else {
        log::line("update: feed request failed");
        return Outcome::Failed;
    };
    if status != 200 {
        log::line(&format!("update: feed HTTP {status}"));
        return Outcome::Failed;
    }

    // The server echoes the ring it actually resolved. A lower one means the
    // caller's tier was clamped — never install across rings on that basis.
    let served = net::json_str(&text, "channel").unwrap_or_default();
    if !served.is_empty() && served != channel.as_key() {
        return Outcome::Clamped;
    }

    let Some(version) = net::json_str(&text, "version") else {
        log::line("update: feed carried no version");
        return Outcome::Failed;
    };
    if !is_newer(&version, CURRENT_VERSION) {
        return Outcome::Current;
    }

    // Already installed once and still reporting the old version: the catalog's
    // version does not match what the binary actually is (a tag/binary drift).
    // Installing again would loop forever, once per poll, swapping the exe each
    // time. Refuse instead — loudly, since it needs a release-side fix.
    if already_installed(&version) {
        log::line(&format!(
            "update: v{version} was already installed but this build still reports \
             v{CURRENT_VERSION} — catalog/binary version drift, refusing to reinstall"
        ));
        return Outcome::Current;
    }

    // Prefer the ring-specific asset so the installed file keeps its ring-marked
    // name; fall back to the generic key for catalog rows registered before the
    // per-ring assets existed. No `platforms` object at all is a malformed feed —
    // scanning the whole document instead would let a sibling field masquerade as
    // an asset.
    let Some(platforms) = net::json_object(&text, "platforms") else {
        log::line("update: feed carried no platforms object");
        return Outcome::Failed;
    };
    let keyed = format!("win-x64-{}", channel.as_key());
    let asset = net::json_object(platforms, &keyed)
        .or_else(|| net::json_object(platforms, "win-x64"));
    let Some(asset) = asset else {
        log::line("update: feed carried no win-x64 asset");
        return Outcome::Failed;
    };
    // url, sha256 AND size_bytes are all mandatory. Defaulting a missing size to
    // 0 used to disable the size check silently — one of the four verification
    // layers vanishing without so much as a log line.
    let (Some(url), Some(sha256), Some(size_bytes)) = (
        net::json_str(asset, "url"),
        net::json_str(asset, "sha256"),
        net::json_u64(asset, "size_bytes"),
    ) else {
        log::line(
            "update: asset is missing url, sha256 or size_bytes — refusing an unverifiable update",
        );
        return Outcome::Failed;
    };
    Outcome::Newer(Release { version, url, sha256, size_bytes })
}

/// Path of the "what we last wrote over ourselves" marker.
fn installed_marker() -> std::path::PathBuf {
    util::data_dir().join("installed-version.txt")
}

/// True when `version` was already written over the running exe by a previous
/// install. Only ever consulted when the running build still reports an older
/// version, i.e. when the marker and reality disagree.
fn already_installed(version: &str) -> bool {
    std::fs::read_to_string(installed_marker())
        .map(|s| s.trim() == version)
        .unwrap_or(false)
}

/// Download, verify and swap in `rel`. Every failure leaves the running build
/// untouched and merely flips the tray state. `true` ⇒ relaunch to pick it up.
fn install(rel: &Release) -> bool {
    set_state(State::Downloading);
    let Some(bytes) = net::download_release_binary(&rel.url) else {
        set_state(State::Failed);
        return false;
    };
    if bytes.len() as u64 != rel.size_bytes {
        log::line(&format!(
            "update: size mismatch — catalog says {}, got {}",
            rel.size_bytes,
            bytes.len()
        ));
        set_state(State::Failed);
        return false;
    }
    let Some(actual) = crypto::sha256_hex(&bytes) else {
        log::line("update: SHA-256 could not be computed — refusing to install");
        set_state(State::Failed);
        return false;
    };
    if !actual.eq_ignore_ascii_case(rel.sha256.trim()) {
        log::line("update: SHA-256 mismatch against the release catalog — download discarded");
        set_state(State::Failed);
        return false;
    }
    // Cheap sanity check: whatever we verified must at least be a PE image.
    if !bytes.starts_with(b"MZ") {
        log::line("update: verified payload is not a Windows executable — discarded");
        set_state(State::Failed);
        return false;
    }

    if swap_running_exe(&bytes) {
        log::line(&format!("update: v{} written over the running exe", rel.version));
        // Record it BEFORE the relaunch: if the new build turns out to report a
        // different version than the catalog claimed, `already_installed` is what
        // stops the next poll from installing it all over again.
        let _ = std::fs::write(installed_marker(), rel.version.as_bytes());
        set_state(State::Installed(rel.version.clone()));
        true
    } else {
        set_state(State::Failed);
        false
    }
}

/// Replace the running executable, crash-safely.
///
/// Windows refuses to delete or overwrite a running image but permits RENAMING
/// it. The naive order — rename ourselves aside, then write the new bytes at the
/// original path — has a hole an autostart app cannot afford: a power loss or a
/// kill *during* the write leaves a truncated file exactly where the `HKCU\…\Run`
/// value points, and the rollback branch never runs. The user is then left with no
/// startable executable and a deliberately-unrunnable `.old` beside it.
///
/// So the new bytes are fully written and **flushed** to a side file first, and
/// only then are two renames used to put it in place. Renames are metadata-only,
/// so the window in which neither name resolves is as small as the filesystem can
/// make it, and no step can produce a partially-written image at the live path:
///
///   1. write `<exe>.new`, `sync_all()` it (NTFS may otherwise persist the rename
///      metadata before the data blocks),
///   2. rename `<exe>` → `<exe>.old`   (frees the live path; we are still running
///      from the open image, which Windows keeps mapped),
///   3. rename `<exe>.new` → `<exe>`   (metadata-only; if it fails, step 2 is
///      undone and the original is back).
fn swap_running_exe(bytes: &[u8]) -> bool {
    use std::io::Write;

    let Ok(current) = std::env::current_exe() else {
        log::line("update: current_exe() failed — cannot self-replace");
        return false;
    };
    let backup = suffixed_path(&current, ".old");
    let staged = suffixed_path(&current, ".new");

    // 1. Stage the full image and force it to disk before anything moves.
    let _ = std::fs::remove_file(&staged);
    let staged_ok = std::fs::File::create(&staged).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    if let Err(e) = staged_ok {
        log::line(&format!("update: staging the new exe failed ({e}) — nothing changed"));
        let _ = std::fs::remove_file(&staged);
        return false;
    }

    // 2. Free the live path. Until this succeeds the install is a pure no-op.
    let _ = std::fs::remove_file(&backup);
    if let Err(e) = std::fs::rename(&current, &backup) {
        log::line(&format!("update: could not move the running exe aside ({e})"));
        let _ = std::fs::remove_file(&staged);
        return false;
    }

    // 3. Metadata-only move into place; on failure put the original back.
    if let Err(e) = std::fs::rename(&staged, &current) {
        log::line(&format!("update: could not move the new exe into place ({e}) — rolling back"));
        if let Err(e2) = std::fs::rename(&backup, &current) {
            // Both names are now off the live path. Say so loudly: this is the
            // one state a user has to repair by hand.
            log::line(&format!(
                "update: ROLLBACK FAILED ({e2}) — the working build is at {}, rename it back to {}",
                backup.display(),
                current.display()
            ));
        }
        let _ = std::fs::remove_file(&staged);
        return false;
    }
    true
}

/// `<exe><suffix>` — appended AFTER `.exe`, so the leftover is not runnable and
/// [`cleanup_backup`] can recognise it on the next start.
fn suffixed_path(current: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut name = current.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    current.with_file_name(name)
}

fn backup_path(current: &std::path::Path) -> std::path::PathBuf {
    suffixed_path(current, ".old")
}

/// Delete the previous build left behind by a self-update. Called once at start,
/// when the old image is no longer mapped.
pub fn cleanup_backup() {
    let Ok(current) = std::env::current_exe() else { return };
    let backup = backup_path(&current);
    if backup.exists() && std::fs::remove_file(&backup).is_ok() {
        log::line("update: removed the previous build left by the last self-update");
    }
    // A `.new` still on disk means the process died between staging and the
    // renames. The staged bytes were never verified against a *current* catalog
    // response, so they are discarded rather than reused.
    let staged = suffixed_path(&current, ".new");
    if staged.exists() && std::fs::remove_file(&staged).is_ok() {
        log::line("update: discarded a staged update left by an interrupted install");
    }
}

/// Strictly-greater dotted-numeric comparison. Any non-numeric suffix on a
/// segment is ignored (`0.4.0-rc1` ranks as `0.4.0`), and a missing segment
/// counts as 0. Equal versions are NOT newer — that is the downgrade guard.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let a = parse_version(candidate);
    let b = parse_version(current);
    a > b
}

fn parse_version(v: &str) -> [u64; 3] {
    let mut out = [0u64; 3];
    for (i, seg) in v.trim().trim_start_matches('v').split('.').take(3).enumerate() {
        let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
        out[i] = digits.parse::<u64>().unwrap_or(0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_are_detected() {
        assert!(is_newer("0.4.0", "0.3.3"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("0.3.10", "0.3.9")); // numeric, not lexicographic
    }

    #[test]
    fn equal_or_older_is_never_newer() {
        assert!(!is_newer("0.3.3", "0.3.3"));
        assert!(!is_newer("0.3.2", "0.3.3"));
        assert!(!is_newer("0.3", "0.3.1"));
    }

    #[test]
    fn version_parsing_tolerates_prefixes_and_suffixes() {
        assert_eq!(parse_version("v0.4.0"), [0, 4, 0]);
        assert_eq!(parse_version("0.4.0-rc.1"), [0, 4, 0]);
        assert_eq!(parse_version("0.4"), [0, 4, 0]);
        assert_eq!(parse_version("garbage"), [0, 0, 0]);
        assert_eq!(parse_version("0.4.0.9"), [0, 4, 0]); // extra segments ignored
    }

    #[test]
    fn a_garbage_feed_version_never_triggers_an_update() {
        assert!(!is_newer("", CURRENT_VERSION));
        assert!(!is_newer("garbage", CURRENT_VERSION));
    }

    #[test]
    fn backup_path_appends_after_the_extension() {
        let p = std::path::Path::new("C:\\tools\\starscape-wallpaper-beta.exe");
        assert_eq!(
            backup_path(p),
            std::path::PathBuf::from("C:\\tools\\starscape-wallpaper-beta.exe.old")
        );
        // The staging file must ALSO be non-runnable and must not collide with the
        // backup, or an interrupted install could be mistaken for a good build.
        assert_eq!(
            suffixed_path(p, ".new"),
            std::path::PathBuf::from("C:\\tools\\starscape-wallpaper-beta.exe.new")
        );
        assert_ne!(suffixed_path(p, ".new"), backup_path(p));
    }

    /// The crash-safety property of [`swap_running_exe`], exercised on throwaway
    /// paths: the live path only ever holds a COMPLETE image, because the bytes are
    /// written to `.new` and moved in with a metadata-only rename.
    #[test]
    fn a_swap_never_leaves_a_partial_image_at_the_live_path() {
        let dir = std::env::temp_dir().join(format!("scc-swap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmp dir");
        let live = dir.join("app.exe");
        std::fs::write(&live, b"MZ-original").expect("seed");

        let staged = suffixed_path(&live, ".new");
        let backup = backup_path(&live);
        let payload = b"MZ-brand-new-build";

        // The three steps swap_running_exe performs, on a path we can inspect.
        std::fs::write(&staged, payload).expect("stage");
        std::fs::rename(&live, &backup).expect("aside");
        std::fs::rename(&staged, &live).expect("into place");

        assert_eq!(std::fs::read(&live).expect("live"), payload);
        assert_eq!(std::fs::read(&backup).expect("backup"), b"MZ-original");
        assert!(!staged.exists(), "the staging file must be consumed by the rename");

        // And the rollback direction restores the original byte-for-byte.
        std::fs::rename(&live, &staged).expect("undo");
        std::fs::rename(&backup, &live).expect("rollback");
        assert_eq!(std::fs::read(&live).expect("rolled back"), b"MZ-original");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cycle_is_single_flight() {
        // Mirrors run_cycle's entry gate: the second concurrent caller must lose.
        CYCLE_RUNNING.store(false, Ordering::SeqCst);
        assert!(CYCLE_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        assert!(
            CYCLE_RUNNING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err(),
            "two threads must never both enter the install path"
        );
        // The guard releases it however the cycle leaves, panic included.
        {
            let _g = CycleGuard;
        }
        assert!(!CYCLE_RUNNING.load(Ordering::SeqCst));
    }

    #[test]
    fn actionable_states_are_the_clickable_ones() {
        set_state(State::Current);
        assert!(!is_actionable());
        set_state(State::Available("0.4.0".into()));
        assert!(is_actionable());
        set_state(State::SignInRequired);
        assert!(is_actionable());
        set_state(State::Downloading);
        assert!(!is_actionable());
        // Clicking cannot grant a role, so this one must not invite a browser trip.
        set_state(State::NotEntitled);
        assert!(!is_actionable());
        set_state(State::Unknown);
    }

    #[test]
    fn only_an_explicit_ring_marker_is_read_off_a_filename() {
        assert_eq!(channel_from_stem("starscape-wallpaper-0.4.0-beta"), Some(Channel::Beta));
        assert_eq!(channel_from_stem("starscape-wallpaper-0.4.0-alpha"), Some(Channel::Alpha));
        assert_eq!(channel_from_stem("starscape-wallpaper-0.4.0-stable"), Some(Channel::Stable));
        assert_eq!(channel_from_stem("STARSCAPE-WALLPAPER-0.4.0-BETA"), Some(Channel::Beta));
        // No marker: the `latest` alias, a plain versioned asset, a browser rename.
        assert_eq!(channel_from_stem("starscape-wallpaper"), None);
        assert_eq!(channel_from_stem("starscape-wallpaper-0.4.0"), None);
        assert_eq!(channel_from_stem("starscape-wallpaper (1)"), None);
        assert_eq!(channel_from_stem(""), None);
    }

    #[test]
    fn a_ring_marked_download_wins_over_the_stored_ring() {
        // A deliberate per-ring download re-locks the install…
        assert_eq!(pick_channel(Some(Channel::Beta), Some(Channel::Stable)), Channel::Beta);
        assert_eq!(pick_channel(Some(Channel::Stable), Some(Channel::Alpha)), Channel::Stable);
    }

    #[test]
    fn an_unmarked_copy_never_moves_an_install_between_rings() {
        // …but an unmarked file (the `latest` alias, a rename) does not.
        assert_eq!(pick_channel(None, Some(Channel::Beta)), Channel::Beta);
        assert_eq!(pick_channel(None, Some(Channel::Alpha)), Channel::Alpha);
    }

    #[test]
    fn a_first_start_with_no_signal_at_all_is_stable() {
        assert_eq!(pick_channel(None, None), Channel::Stable);
    }
}
