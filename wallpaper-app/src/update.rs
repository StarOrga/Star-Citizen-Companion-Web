//! Silent background self-update.
//!
//! Trust model — deliberately the data-uploader's, not a new one (there is still
//! NO code signing; see `.claude/deep-knowledge/starscape-release.md`):
//!
//!   * The manifest comes from the `desktop-latest` edge function over TLS, the
//!     same feed electron-updater polls for the uploader. It is answered from the
//!     `desktop_releases` catalog — never from the download host — so the expected
//!     SHA-256 and byte size are held by a server we control.
//!   * The build presents its baked `X-SC-Release-Token` (CI-generated per
//!     release, exactly like the uploader's vite `define`). `token_revoked` is the
//!     kill-switch for a leaked or bad build.
//!   * The download URL host is pinned to the public binaries mirror
//!     (`net::download_release_binary`), so a tampered catalog row cannot aim the
//!     updater somewhere else.
//!   * The downloaded bytes are checked against the catalog's size AND SHA-256,
//!     and must be a PE image, before anything is written over the running exe.
//!   * A version that is not strictly newer is never installed (no downgrade),
//!     and a clamped response is never installed at all (no ring switch).
//!
//! Channel lock: the ring is chosen ONCE, on the website, before the download —
//! the asset filename carries it (`…-beta.exe`), the app reads it on first start
//! and persists it. There is deliberately no in-app channel picker.
//!
//! Surface: the tray menu, and nothing else. No balloons, no toasts, no dialogs.

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
    match state() {
        // A cycle is already in flight.
        State::Downloading | State::Checking => return false,
        // A build is already staged over the running exe and only the relaunch is
        // outstanding. Checking again would keep re-downloading the same asset
        // every poll, because our own version string is still the old one.
        State::Installed(_) => return false,
        _ => {}
    }
    set_state(State::Checking);

    let mut token = session::ensure_access_token();
    let mut outcome = check(channel, token.as_deref());

    // Ring above our tier and the user asked for it → sign in, then retry once.
    // Only worth a browser trip when we had NO usable session: being clamped with
    // a valid token means the account's role, not its sign-in state, is the limit,
    // and re-authenticating as the same user cannot change that.
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

    // Prefer the ring-specific asset so the installed file keeps its ring-marked
    // name; fall back to the generic key for catalog rows registered before the
    // per-ring assets existed.
    let platforms = net::json_object(&text, "platforms").unwrap_or(text.as_str());
    let keyed = format!("win-x64-{}", channel.as_key());
    let asset = net::json_object(platforms, &keyed)
        .or_else(|| net::json_object(platforms, "win-x64"));
    let Some(asset) = asset else {
        log::line("update: feed carried no win-x64 asset");
        return Outcome::Failed;
    };
    let (Some(url), Some(sha256)) = (net::json_str(asset, "url"), net::json_str(asset, "sha256"))
    else {
        log::line("update: asset is missing url or sha256 — refusing an unverifiable update");
        return Outcome::Failed;
    };
    Outcome::Newer(Release {
        version,
        url,
        sha256,
        size_bytes: net::json_u64(asset, "size_bytes").unwrap_or(0),
    })
}

/// Download, verify and swap in `rel`. Every failure leaves the running build
/// untouched and merely flips the tray state. `true` ⇒ relaunch to pick it up.
fn install(rel: &Release) -> bool {
    set_state(State::Downloading);
    let Some(bytes) = net::download_release_binary(&rel.url) else {
        set_state(State::Failed);
        return false;
    };
    if rel.size_bytes > 0 && bytes.len() as u64 != rel.size_bytes {
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
        set_state(State::Installed(rel.version.clone()));
        true
    } else {
        set_state(State::Failed);
        false
    }
}

/// Replace the running executable in place.
///
/// Windows refuses to delete or overwrite a running image but permits RENAMING
/// it, so: move ourselves aside, write the new bytes at the original path, and
/// let the caller relaunch. Any failure is rolled back, so a half-applied update
/// cannot leave the user without an executable.
fn swap_running_exe(bytes: &[u8]) -> bool {
    let Ok(current) = std::env::current_exe() else {
        log::line("update: current_exe() failed — cannot self-replace");
        return false;
    };
    let backup = backup_path(&current);
    let _ = std::fs::remove_file(&backup);
    if let Err(e) = std::fs::rename(&current, &backup) {
        log::line(&format!("update: could not move the running exe aside ({e})"));
        return false;
    }
    if let Err(e) = std::fs::write(&current, bytes) {
        log::line(&format!("update: writing the new exe failed ({e}) — rolling back"));
        let _ = std::fs::rename(&backup, &current);
        return false;
    }
    true
}

/// `<exe>.old` — the trailing extension keeps Windows from treating the leftover
/// as runnable, and [`cleanup_backup`] removes it on the next start.
fn backup_path(current: &std::path::Path) -> std::path::PathBuf {
    let mut name = current.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".old");
    current.with_file_name(name)
}

/// Delete the previous build left behind by a self-update. Called once at start,
/// when the old image is no longer mapped.
pub fn cleanup_backup() {
    let Ok(current) = std::env::current_exe() else { return };
    let backup = backup_path(&current);
    if backup.exists() && std::fs::remove_file(&backup).is_ok() {
        log::line("update: removed the previous build left by the last self-update");
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
