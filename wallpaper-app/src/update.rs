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
//!     against the `channel` the feed reports it actually served. The one
//!     exception is a clamp with nothing left to cross — the served ring is on
//!     the very same version ours is, so the payload IS our build; see
//!     [`clamp_is_only_nominal`], which stays false the moment the versions
//!     differ in either direction.
//!   * The swap itself is crash-safe: staged and flushed to `<exe>.new` first, then
//!     two metadata-only renames. See [`swap_running_exe`].
//!
//! Ring selection (rewritten in 0.6.0 — see [`resolve_preference`]): the ring is
//! no longer pinned by the download. The default is [`RingPref::Auto`], which
//! asks the feed for the TOP ring and lets the server's role clamp answer with
//! the highest one this account actually reaches — `alpha → beta → stable`. The
//! tray menu can pin a specific ring instead. What the old model got wrong: an
//! admin who took the website's default `…-stable.exe` was locked to stable for
//! good and told "up to date" on 0.4.4 while alpha served 0.5.0, because nothing
//! ever asked for the ring they were entitled to.
//!
//! Surface: the tray menu, and nothing else. No balloons, no toasts, no dialogs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::crypto;
use crate::log;
use crate::net;
use crate::session;
use crate::util::{self, Channel, RingPref};

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

/// Coarse build id for telemetry (audit only): the release token's 8-character
/// fingerprint, mirroring the data-uploader's `RELEASE_TOKEN.slice(0, 8)`.
///
/// `None` for an unsigned local build — and never the token itself: the full
/// UUID is the update feed's credential and must not travel on any other wire.
pub fn build_id() -> Option<&'static str> {
    if RELEASE_TOKEN == DEV_TOKEN {
        return None;
    }
    RELEASE_TOKEN.get(..8)
}

/// Update-feed path. `product=starscape` selects the Starscape rings; the edge
/// function always resolves them through the role-clamped SQL resolver.
const FEED_PATH: &str = "/functions/v1/desktop-latest?product=starscape&channel=";

/// What the tray menu reports. Only ever changed by the update worker thread.
#[derive(Clone, PartialEq, Eq)]
pub enum State {
    /// No successful check yet (fresh start, or the feed was unreachable).
    Unknown,
    Checking,
    /// Confirmed up to date on the ring this install follows.
    Current,
    Available(String),
    Downloading,
    /// Verified and written over the running exe; active after the next start.
    /// Only ever seen when the relaunch was deferred (screensaver on screen).
    Installed(String),
    /// The PINNED ring is above the anonymous tier — a website sign-in is needed
    /// before this ring's builds are INSTALLED. Only ever reached when the build
    /// is actually behind: the feed reports the pinned ring's version even to a
    /// clamped caller, so "am I up to date?" is answered without signing in and
    /// a current install reports [`State::Current`] instead. `newer` carries the
    /// version to install, or `None` against a pre-`requestedVersion` feed that
    /// could not say (then the state is a plain "sign in to find out").
    SignInRequired { newer: Option<String> },
    /// Signed in, but the account's role does not reach the PINNED ring (e.g. a
    /// beta copy on a viewer account). Deliberately NOT actionable: clicking
    /// would only re-open a browser sign-in that cannot change the outcome.
    /// Unreachable in [`RingPref::Auto`], where being clamped is the answer
    /// rather than a refusal.
    NotEntitled,
    /// [`RingPref::Auto`], signed out, and a ring above the anonymous tier is
    /// ahead of this build. Distinct from [`State::SignInRequired`] on purpose:
    /// there the user PICKED that ring, so "sign in to install" is a promise the
    /// app can keep; here the app does not yet know whether this account reaches
    /// the ring at all, so the label offers to find out and nothing more.
    PreRelease(String),
    /// Download / verification / install failed; clicking retries.
    Failed,
}

static STATE: Mutex<State> = Mutex::new(State::Unknown);

/// Which ring the user wants followed. Owned here rather than passed in per call
/// because the tray can change it at any moment while the 6 h poll thread is
/// asleep holding a copy of the old one.
static PREFERENCE: Mutex<RingPref> = Mutex::new(RingPref::Auto);

/// Ring the last check actually resolved to — under [`RingPref::Auto`] that is
/// whatever the server clamp handed back, which is the whole point.
static EFFECTIVE: Mutex<Channel> = Mutex::new(Channel::Stable);

/// Highest ring this account is known to reach, learned from the feed's own
/// clamp. `None` until a check has succeeded (offline, or first 20 s of a run),
/// and the tray then enables every ring rather than guessing a ceiling that
/// would lock the user out of the very menu that fixes it.
static MAX_RING: Mutex<Option<Channel>> = Mutex::new(None);

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

/// Decide which ring this install should follow, given whatever was persisted.
///
/// Precedence, and why:
///   1. **The persisted preference wins**, always. It is either an explicit tray
///      pick or the [`RingPref::Auto`] default, and both must outrank the
///      filename: a self-update overwrites the exe *in place*, so the name it
///      was first downloaded under survives forever. Letting that name keep
///      overriding a later in-app choice would make the tray picker silently
///      revert on every restart.
///   2. **On a genuine first run only**, a `-beta` / `-alpha` marker in our own
///      filename pins that ring. Those assets are only reachable through the
///      website's per-ring overlay, and only for roles that already reach them,
///      so the marker is a real choice made minutes earlier — including the
///      deliberate choice to sit BELOW the top ring.
///   3. A `-stable` marker deliberately pins nothing. It is what the website's
///      default download CTA hands to every visitor, so it is evidence of
///      clicking the big button, not of wanting stable specifically — and
///      treating it as a pin is exactly what left an admin stranded on 0.4.4.
///      Falling through to auto costs a viewer nothing: their clamp is stable.
pub fn resolve_preference(stored: RingPref, first_run: bool) -> RingPref {
    pick_preference(stored, channel_from_exe_name(), first_run)
}

/// The precedence rule of [`resolve_preference`], separated from the filesystem
/// so it can be tested exhaustively.
fn pick_preference(stored: RingPref, from_name: Option<Channel>, first_run: bool) -> RingPref {
    if !first_run {
        return stored;
    }
    match from_name {
        Some(c) if c > Channel::Stable => RingPref::Pinned(c),
        _ => stored,
    }
}

/// Seed the updater's view of the world from the persisted config, before the
/// first check has had a chance to run.
pub fn init(pref: RingPref, last_effective: Channel) {
    set_preference_inner(pref);
    set_effective(last_effective);
}

pub fn preference() -> RingPref {
    PREFERENCE.lock().map(|p| *p).unwrap_or(RingPref::Auto)
}

/// Apply a ring choice made in the tray. Drops the cached verdict too: it was
/// reached on the previous ring and would otherwise keep claiming "up to date"
/// about a ring the user just left.
pub fn set_preference(pref: RingPref) {
    set_preference_inner(pref);
    set_state(State::Unknown);
    if let RingPref::Pinned(c) = pref {
        set_effective(c);
    }
    log::line(&format!("update: ring preference set to {}", pref.as_key()));
}

fn set_preference_inner(pref: RingPref) {
    if let Ok(mut p) = PREFERENCE.lock() {
        *p = pref;
    }
}

/// Ring the updater is currently following. Equals the pinned ring, or — under
/// [`RingPref::Auto`] — the highest ring the last check was actually served.
pub fn effective_ring() -> Channel {
    EFFECTIVE.lock().map(|c| *c).unwrap_or(Channel::Stable)
}

fn set_effective(channel: Channel) {
    if let Ok(mut c) = EFFECTIVE.lock() {
        *c = channel;
    }
}

/// Highest ring this account is known to reach, or `None` while no check has
/// succeeded yet. See [`MAX_RING`].
pub fn max_ring() -> Option<Channel> {
    MAX_RING.lock().map(|m| *m).unwrap_or(None)
}

/// Record what a feed response revealed about the account's reach.
///
/// A clamp is EXACT — the server named the ceiling. An un-clamped answer is only
/// a lower bound ("your role reaches at least the ring you asked for"), so it may
/// widen what we know but never narrow it.
fn note_max_ring(requested: Channel, served: Channel, clamped: bool) {
    if let Ok(mut m) = MAX_RING.lock() {
        let known = *m;
        *m = Some(widened_max(known, requested, served, clamped));
    }
}

/// The rule of [`note_max_ring`], separated from the global so it can be tested
/// without racing the other tests over `MAX_RING`.
fn widened_max(
    known: Option<Channel>,
    requested: Channel,
    served: Channel,
    clamped: bool,
) -> Channel {
    match (known, clamped) {
        (_, true) => served,
        (Some(known), false) => known.max(requested),
        (None, false) => requested,
    }
}

/// Forget what any earlier check revealed about the account's reach, and drop
/// the cached verdict with it.
///
/// Called when the identity behind those answers changes — a sign-out, or a
/// sign-in. Everything `MAX_RING` holds was learned as somebody else (or as
/// nobody), so keeping it would carry one account's ceiling into another's
/// menu. `None` re-opens every ring, which is the honest state until the next
/// check answers for the account that is actually signed in now.
pub fn forget_entitlement() {
    if let Ok(mut m) = MAX_RING.lock() {
        *m = None;
    }
    set_state(State::Unknown);
}

/// Whether `ring` may be picked in the tray, given what the last check revealed.
pub fn ring_is_available(ring: Channel) -> bool {
    ring_within(ring, max_ring())
}

/// Unknown reach ⇒ everything is offered: greying out a ring on a guess would
/// hide the one control that fixes a wrong ring.
fn ring_within(ring: Channel, max: Option<Channel>) -> bool {
    match max {
        None => true,
        Some(max) => ring <= max,
    }
}

/// Tray label for the current state — the SCC "status readout" voice, and the
/// only place the updater ever talks to the user.
pub fn tray_label() -> String {
    label_for(state(), effective_ring())
}

/// Label for the ring submenu's parent entry: which ring is followed, and
/// whether that was chosen or resolved.
pub fn ring_menu_label() -> String {
    let ring = effective_ring().as_str();
    match preference() {
        RingPref::Auto => util::t(
            &format!("Update-Kanal: {ring} (automatisch)"),
            &format!("Update channel: {ring} (automatic)"),
        ),
        RingPref::Pinned(_) => util::t(
            &format!("Update-Kanal: {ring}"),
            &format!("Update channel: {ring}"),
        ),
    }
}

/// [`tray_label`] separated from the global state so it can be tested for every
/// state without racing other tests over the `STATE` mutex.
fn label_for(state: State, channel: Channel) -> String {
    let ring = channel.as_str();
    // Every state names the running version. The tray is the only surface this
    // app has, and "which build am I even on?" must never depend on which state
    // the updater happens to be stuck in (a signed-out alpha install used to sit
    // in SignInRequired forever, showing no version at all).
    match state {
        State::Checking => util::t(
            &format!("◈ v{CURRENT_VERSION} · Suche nach Updates…"),
            &format!("◈ v{CURRENT_VERSION} · checking for updates…"),
        ),
        State::Current => util::t(
            &format!("◈ Aktuell · v{CURRENT_VERSION} · {ring}"),
            &format!("◈ Up to date · v{CURRENT_VERSION} · {ring}"),
        ),
        State::Available(v) => util::t(
            &format!("▲ Update verfügbar · v{CURRENT_VERSION} → v{v}"),
            &format!("▲ Update available · v{CURRENT_VERSION} → v{v}"),
        ),
        State::Downloading => util::t(
            &format!("▼ v{CURRENT_VERSION} · Update wird geladen…"),
            &format!("▼ v{CURRENT_VERSION} · downloading update…"),
        ),
        State::Installed(v) => util::t(
            &format!("◈ v{v} installiert · aktiv beim nächsten Start"),
            &format!("◈ v{v} installed · active on next start"),
        ),
        State::SignInRequired { newer: Some(v) } => util::t(
            &format!("▲ v{CURRENT_VERSION} → v{v} · Anmelden zum Installieren"),
            &format!("▲ v{CURRENT_VERSION} → v{v} · sign in to install"),
        ),
        State::SignInRequired { newer: None } => util::t(
            &format!("◈ v{CURRENT_VERSION} · Anmelden für {ring}-Updates"),
            &format!("◈ v{CURRENT_VERSION} · sign in for {ring} updates"),
        ),
        State::NotEntitled => util::t(
            &format!("◈ v{CURRENT_VERSION} · {ring} für dieses Konto nicht freigegeben"),
            &format!("◈ v{CURRENT_VERSION} · {ring} not enabled for this account"),
        ),
        // Deliberately promises a CHECK, not an install: signed out, the app
        // cannot know whether this account reaches the ring that build sits on.
        // Signing in resolves it either way — into a download, or into a quiet
        // "up to date" on whatever ring the role does reach.
        State::PreRelease(v) => util::t(
            &format!("▲ v{CURRENT_VERSION} · v{v} im Vorab-Ring · anmelden zum Prüfen"),
            &format!("▲ v{CURRENT_VERSION} · v{v} on a pre-release ring · sign in to check"),
        ),
        State::Failed => util::t(
            &format!("▲ v{CURRENT_VERSION} · Update fehlgeschlagen · erneut versuchen"),
            &format!("▲ v{CURRENT_VERSION} · update failed · retry"),
        ),
        State::Unknown => util::t(
            &format!("◈ Starscape v{CURRENT_VERSION} · {ring}"),
            &format!("◈ Starscape v{CURRENT_VERSION} · {ring}"),
        ),
    }
}

/// True when clicking the tray entry does something.
pub fn is_actionable() -> bool {
    matches!(
        state(),
        State::Available(_) | State::SignInRequired { .. } | State::PreRelease(_) | State::Failed
    )
}

/// One full cycle: resolve the ring, and install straight away when a genuinely
/// newer build is offered. Runs on a worker thread; never touches the UI.
///
/// The ring comes from [`PREFERENCE`], read fresh here rather than passed in:
/// the poll thread sleeps for 6 h at a time and would otherwise keep using the
/// ring that was current when it went to sleep.
///
/// `interactive` marks a cycle the user started from the tray — only then may a
/// browser sign-in be opened. The periodic poll stays completely silent.
///
/// Returns `true` when a new build was written over the running exe and the app
/// should relaunch. The caller owns the relaunch because only the UI thread may
/// drop the tray icon and release the single-instance mutex first.
pub fn run_cycle(interactive: bool, on_signed_in: &dyn Fn()) -> bool {
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

    let pref = preference();
    let mut token = session::ensure_access_token();
    let mut outcome = check(pref, token.as_deref());

    // Held back while we believed we were signed in? A locally-unexpired JWT
    // proves nothing about server-side state — a web logout or password change
    // revokes it and the feed then reads us as anonymous, which looks exactly
    // like "your role is too low". Ask the auth server once: a rejected refresh
    // clears the store and turns this into the sign-in case below, which is the
    // honest answer. Applies to the auto path too: an admin whose session died
    // silently would otherwise just settle onto stable and say nothing.
    if token.is_some() && matches!(outcome, Outcome::Clamped { .. } | Outcome::PreRelease(_)) {
        token = session::revalidate();
        if token.is_some() {
            outcome = check(pref, token.as_deref());
        }
    }

    // A ring we cannot reach unauthenticated → sign in, then retry once. Only
    // worth a browser trip when we have NO usable session: being held back with a
    // live one means the account's role, not its sign-in state, is the limit, and
    // re-authenticating as the same user cannot change that.
    if interactive
        && token.is_none()
        && matches!(outcome, Outcome::Clamped { .. } | Outcome::PreRelease(_))
    {
        if let Some(fresh) = crate::auth::run_oauth_flow() {
            fresh.save();
            on_signed_in();
            token = Some(fresh.access_token);
            outcome = check(pref, token.as_deref());
        }
    }

    match outcome {
        Outcome::Clamped { .. } if token.is_some() => {
            log::line("update: signed in, but this account's role does not reach the pinned ring");
            set_state(State::NotEntitled);
            false
        }
        Outcome::Clamped { newer } => {
            log::line("update: pinned ring above the anonymous tier — website sign-in required");
            set_state(State::SignInRequired { newer });
            false
        }
        // Auto mode with a session that just survived re-validation: the ROLE is
        // the ceiling, and we are already on the highest ring it grants. There is
        // nothing to click, and the ring we are on is current — say exactly that
        // instead of nagging about a build this account cannot have.
        Outcome::PreRelease(_) if token.is_some() => {
            log::line(
                "update: already on the highest ring this account reaches; a higher ring leads it",
            );
            set_state(State::Current);
            false
        }
        Outcome::PreRelease(v) => {
            log::line(&format!("update: v{v} waiting on a ring above the anonymous tier"));
            set_state(State::PreRelease(v));
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
            log::line(&format!(
                "update: v{} available on {}",
                rel.version,
                effective_ring().as_str()
            ));
            set_state(State::Available(rel.version.clone()));
            install(&rel)
        }
    }
}

enum Outcome {
    /// Feed unreachable or unparseable.
    Failed,
    /// The server clamped us below the PINNED ring. `newer` is the version that
    /// lower ring serves, kept only when it beats the running build — see
    /// [`clamp_newer_hint`]. Never produced in [`RingPref::Auto`], where a clamp
    /// is the answer to the question asked, not a refusal.
    Clamped { newer: Option<String> },
    /// [`RingPref::Auto`]: the ring we were served is up to date, but a higher
    /// ring — the one we asked for — carries a newer build that this caller was
    /// clamped away from. Carries that version.
    PreRelease(String),
    Current,
    Newer(Release),
}

/// Ask the release catalog what this install's ring currently serves.
///
/// Under [`RingPref::Auto`] the request is always for [`Channel::TOP`]. The
/// server's role clamp (`starscape_release_for_channel`) then resolves it down
/// to the highest ring the caller actually reaches and reports which one that
/// was — so "the maximum ring my role allows, in alpha → beta → stable order" is
/// answered by the existing server rule, in one request, with no new endpoint
/// and no client-side role logic to keep in sync.
fn check(pref: RingPref, access_token: Option<&str>) -> Outcome {
    let channel = pref.requested();
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

    // The server echoes the ring it actually resolved — the CLAMPED one, which is
    // the only authoritative statement about how far this account reaches.
    let served_key = net::json_str(&text, "channel").unwrap_or_default();
    let served = Channel::from_key(&served_key).unwrap_or(channel);
    let clamped = !served_key.is_empty() && served_key != channel.as_key();
    // ONLY an authenticated answer says anything about this ACCOUNT's reach.
    //
    // A signed-out request is clamped to the anonymous tier by definition — the
    // server was never told which account is asking, so the ceiling it reports
    // is the anonymous one, not this user's. Recording it anyway is what told a
    // signed-in admin "Alpha · not enabled for this account" and greyed the
    // very entry that would have fixed it: the app had simply never asked as
    // them. Signed out, the reach therefore stays UNKNOWN, every ring stays
    // pickable, and the tray's account entry offers the sign-in that resolves
    // it for real.
    if access_token.is_some() {
        note_max_ring(channel, served, clamped);
    }

    if pref.is_auto() {
        // We asked for the top ring on purpose, so the clamp is the ANSWER, not a
        // refusal: whatever came back is the highest ring this caller reaches, and
        // following it is precisely "take the maximum alpha → beta → stable the
        // role allows". No cross-ring guard is needed or wanted here — there is no
        // ring the user pinned that this could be silently moving them off.
        set_effective(served);
        return auto_outcome(&text, served);
    }

    set_effective(channel);
    if clamped && !clamp_is_only_nominal(&text) {
        // Clamped below a PINNED ring: the payload is a lower ring's and must
        // never be installed. The feed still reports what our own ring is on
        // (`requestedVersion` — a bare version string, no url/sha/size), so being
        // signed out costs the download, not the answer to "am I up to date?".
        return match clamp_verdict(&text) {
            ClampVerdict::UpToDate => Outcome::Current,
            ClampVerdict::Behind(newer) => Outcome::Clamped { newer },
        };
    }

    release_outcome(&text, channel)
}

/// Verdict for [`RingPref::Auto`], where `served` is the highest ring this
/// caller reaches and is therefore the ring to install from.
///
/// The one thing auto still owes the user is the case it exists to fix from the
/// other side: signed out, the clamp lands on stable, stable is current, and a
/// build this account may well be entitled to sits on a higher ring. The feed's
/// `requestedVersion` names it (that is the ring we ASKED for, resolved without
/// the clamp), so the tray can offer to find out. Installing what we can
/// actually have comes first — a real update always beats a hint about one.
fn auto_outcome(text: &str, served: Channel) -> Outcome {
    match release_outcome(text, served) {
        Outcome::Current => match net::json_str(text, "requestedVersion") {
            Some(top) if is_newer(&top, CURRENT_VERSION) => Outcome::PreRelease(top),
            _ => Outcome::Current,
        },
        other => other,
    }
}

/// Turn a feed body into "nothing to do" or a verified-installable [`Release`],
/// reading the asset for `ring`.
fn release_outcome(text: &str, channel: Channel) -> Outcome {
    let Some(version) = net::json_str(text, "version") else {
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
    let Some(platforms) = net::json_object(text, "platforms") else {
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

/// Whether a clamp is nominal — the response came back on a different ring, but
/// that ring is serving the very same version ours is.
///
/// Once a build is promoted all the way to stable, every ring points at it, and
/// a signed-out beta/alpha install then gets "clamped" to a payload that is
/// byte-for-byte what its own ring would have handed over. Refusing that was a
/// deadlock with no upside: the tray said "sign in to install" for a build the
/// server was already offering unauthenticated, so the copy that most needed the
/// update (an alpha install whose stored session broke) was the one that could
/// not take it.
///
/// This cannot become a ring escalation, because it is only ever true when there
/// is no ring gap left to cross. The moment our ring moves ahead —
/// `requestedVersion` > the clamped `version`, the case the guard actually
/// exists for — the versions differ and the response is refused exactly as
/// before. A viewer asking for alpha while alpha leads stable still gets
/// nothing. And the install keeps its ring: the asset picked below is
/// `win-x64-<our ring>`, so the file lands under its own ring-marked name.
///
/// Only ever consulted under [`RingPref::Pinned`]: auto mode follows the served
/// ring by design, so it has no cross-ring clamp to excuse in the first place.
///
/// It rests on the release catalog being the trust anchor, which is already this
/// module's stated model (see the header): two DIFFERENT builds registered under
/// one version string would defeat it — but whoever can write that row can serve
/// arbitrary bytes on our own ring anyway, so it opens no new surface.
fn clamp_is_only_nominal(feed_text: &str) -> bool {
    match (net::json_str(feed_text, "requestedVersion"), net::json_str(feed_text, "version")) {
        // Both present AND equal. A feed too old to report `requestedVersion`
        // proves nothing, so it keeps the strict behaviour.
        (Some(ring), Some(payload)) => !ring.is_empty() && ring == payload,
        _ => false,
    }
}

/// What a clamped feed response says about the ring we are actually locked to.
#[derive(Debug, PartialEq, Eq)]
enum ClampVerdict {
    /// Our own ring is provably not ahead of this build. Being clamped cost us
    /// the download URL, not the verdict — so report "up to date" and leave the
    /// tray silent instead of nagging for a sign-in that has nothing to fetch.
    UpToDate,
    /// Our ring is ahead, or nothing could be learned about it. `Some(v)` is the
    /// version to install once signed in; `None` means the feed could not say.
    Behind(Option<String>),
}

/// Read that verdict out of the response body.
///
/// `requestedVersion` is the authoritative answer: the version OUR ring serves,
/// resolved without the role clamp (see the `starscape_ring_version_hint`
/// migration). It is only ever displayed and compared — the payload it comes
/// with belongs to a lower ring and is still never installed.
///
/// Older feeds omit it, so the previous heuristic stays as the fallback: a clamp
/// serves the LOWER ring's release, and rings only ever trail each other, so when
/// even the clamped version beats the running build, the build is outdated no
/// matter what the locked ring would say. When it does not, nothing is known —
/// and "unknown" must stay [`ClampVerdict::Behind(None)`], never `UpToDate`.
fn clamp_verdict(feed_text: &str) -> ClampVerdict {
    if let Some(ring) = net::json_str(feed_text, "requestedVersion") {
        return if is_newer(&ring, CURRENT_VERSION) {
            ClampVerdict::Behind(Some(ring))
        } else {
            ClampVerdict::UpToDate
        };
    }
    ClampVerdict::Behind(clamp_newer_hint(feed_text))
}

/// Pre-`requestedVersion` fallback — see [`clamp_verdict`].
fn clamp_newer_hint(feed_text: &str) -> Option<String> {
    net::json_str(feed_text, "version").filter(|v| is_newer(v, CURRENT_VERSION))
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

    /// `STATE`, `PREFERENCE` and `EFFECTIVE` are process globals and `cargo test`
    /// runs tests on parallel threads, so everything that drives them takes this
    /// first. Poison is stepped over: a failing test must not cascade into
    /// unrelated ones. (Tests that can avoid the globals do — see `label_for`,
    /// `widened_max` and `ring_within`.)
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

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
        let _serial = serial();
        set_state(State::Current);
        assert!(!is_actionable());
        set_state(State::Available("0.4.0".into()));
        assert!(is_actionable());
        set_state(State::SignInRequired { newer: None });
        assert!(is_actionable());
        // The outdated-hint variant is the same click target.
        set_state(State::SignInRequired { newer: Some("9.9.9".into()) });
        assert!(is_actionable());
        // Auto mode's "a higher ring is ahead" hint must be clickable, or the
        // signed-out admin it exists for has no way to act on it.
        set_state(State::PreRelease("9.9.9".into()));
        assert!(is_actionable());
        set_state(State::Downloading);
        assert!(!is_actionable());
        // Clicking cannot grant a role, so this one must not invite a browser trip.
        set_state(State::NotEntitled);
        assert!(!is_actionable());
        set_state(State::Unknown);
    }

    /// The tray is the app's only surface: every state must name the running
    /// version, or a stuck state (a signed-out alpha install, a failed feed)
    /// leaves the user unable to tell a fresh build from a months-old one.
    #[test]
    fn every_tray_label_names_the_running_version() {
        let needle = format!("v{CURRENT_VERSION}");
        let all = [
            State::Unknown,
            State::Checking,
            State::Current,
            State::Available("9.9.9".into()),
            State::Downloading,
            State::SignInRequired { newer: None },
            State::SignInRequired { newer: Some("9.9.9".into()) },
            State::NotEntitled,
            State::PreRelease("9.9.9".into()),
            State::Failed,
        ];
        for s in all {
            let label = label_for(s, Channel::Alpha);
            assert!(
                label.contains(&needle),
                "tray label {label:?} does not name the running version"
            );
        }
        // Installed names the NEW build instead — the running version is the
        // one thing that label is explicitly about replacing.
        assert!(label_for(State::Installed("9.9.9".into()), Channel::Alpha).contains("v9.9.9"));
    }

    #[test]
    fn a_clamped_feed_flags_outdated_only_when_even_the_lower_ring_is_newer() {
        // Stable already serves something newer than this build → provably old.
        assert_eq!(
            clamp_newer_hint(r#"{"version":"99.0.0","channel":"stable"}"#),
            Some("99.0.0".to_string())
        );
        // Stable trails the running build (normal for an alpha install):
        // nothing is known about the locked ring — no hint.
        assert_eq!(clamp_newer_hint(r#"{"version":"0.0.1","channel":"stable"}"#), None);
        // Same version: not newer, no hint.
        assert_eq!(
            clamp_newer_hint(&format!(r#"{{"version":"{CURRENT_VERSION}","channel":"stable"}}"#)),
            None
        );
        // A malformed feed carries no hint rather than a bogus one.
        assert_eq!(clamp_newer_hint(r#"{"channel":"stable"}"#), None);
    }

    #[test]
    fn the_locked_rings_own_version_decides_the_clamp_verdict() {
        // The whole point: an alpha install that IS current must say so without
        // a sign-in, even though the payload it got back is stable's.
        assert_eq!(
            clamp_verdict(&format!(
                r#"{{"version":"0.0.1","channel":"stable","requestedVersion":"{CURRENT_VERSION}"}}"#
            )),
            ClampVerdict::UpToDate
        );
        // Our ring moved ahead → name the exact version to install.
        assert_eq!(
            clamp_verdict(
                r#"{"version":"0.0.1","channel":"stable","requestedVersion":"99.0.0"}"#
            ),
            ClampVerdict::Behind(Some("99.0.0".to_string()))
        );
        // Our ring trails this build (a downgraded pointer): never "install",
        // and never a nag either.
        assert_eq!(
            clamp_verdict(r#"{"version":"0.0.1","channel":"stable","requestedVersion":"0.0.2"}"#),
            ClampVerdict::UpToDate
        );
        // Pre-`requestedVersion` feed: fall back to the lower ring's version,
        // and keep "unknown" firmly on the Behind side.
        assert_eq!(
            clamp_verdict(r#"{"version":"99.0.0","channel":"stable"}"#),
            ClampVerdict::Behind(Some("99.0.0".to_string()))
        );
        assert_eq!(
            clamp_verdict(r#"{"version":"0.0.1","channel":"stable"}"#),
            ClampVerdict::Behind(None)
        );
    }

    #[test]
    fn a_clamp_is_nominal_only_when_both_rings_serve_the_same_version() {
        // Everything promoted to stable: the clamped payload IS our ring's build.
        // This is the deadlock case — an alpha install must be able to take it.
        assert!(clamp_is_only_nominal(
            r#"{"version":"0.4.3","channel":"stable","requestedVersion":"0.4.3"}"#
        ));
        // Our ring leads — the case the cross-ring guard exists for. Refuse.
        assert!(!clamp_is_only_nominal(
            r#"{"version":"0.4.3","channel":"stable","requestedVersion":"0.4.5"}"#
        ));
        // Our ring trails (a rolled-back pointer): still not our build.
        assert!(!clamp_is_only_nominal(
            r#"{"version":"0.4.5","channel":"stable","requestedVersion":"0.4.3"}"#
        ));
        // A feed too old to report the field proves nothing — stay strict.
        assert!(!clamp_is_only_nominal(r#"{"version":"0.4.3","channel":"stable"}"#));
        // Neither an empty value nor a missing payload version counts as a match.
        assert!(!clamp_is_only_nominal(
            r#"{"version":"","channel":"stable","requestedVersion":""}"#
        ));
        assert!(!clamp_is_only_nominal(r#"{"channel":"stable","requestedVersion":"0.4.3"}"#));
    }

    #[test]
    fn a_nominal_clamp_never_widens_what_gets_installed() {
        // The guard that actually blocks a ring jump is the version comparison,
        // so re-assert it from the other side: for every case where the rings
        // disagree, the response stays refused no matter which way it leans.
        for (payload, ring) in [("0.4.3", "0.4.4"), ("0.4.4", "0.4.3"), ("1.0.0", "0.9.9")] {
            let feed = format!(
                r#"{{"version":"{payload}","channel":"stable","requestedVersion":"{ring}"}}"#
            );
            assert!(!clamp_is_only_nominal(&feed), "payload {payload} vs ring {ring}");
        }
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

    /// The bug this whole change exists for: an install whose only ring signal
    /// is the website's default `-stable.exe` download must NOT be pinned to
    /// stable. Under the old rule that name was a lock, so an admin sat on 0.4.4
    /// and was told "up to date" while alpha served 0.5.0.
    #[test]
    fn the_default_stable_download_does_not_pin_a_ring() {
        assert_eq!(
            pick_preference(RingPref::Auto, Some(Channel::Stable), true),
            RingPref::Auto,
            "the default CTA's filename is not a deliberate ring choice"
        );
        assert_eq!(RingPref::Auto.requested(), Channel::Alpha);
    }

    #[test]
    fn a_first_run_beta_or_alpha_download_pins_that_ring() {
        // Those assets only exist behind the per-ring overlay, and only for roles
        // that already reach them — so the marker IS a choice, including the
        // choice to sit below the top ring.
        assert_eq!(
            pick_preference(RingPref::Auto, Some(Channel::Beta), true),
            RingPref::Pinned(Channel::Beta)
        );
        assert_eq!(
            pick_preference(RingPref::Auto, Some(Channel::Alpha), true),
            RingPref::Pinned(Channel::Alpha)
        );
    }

    #[test]
    fn a_first_run_with_no_marker_at_all_follows_the_highest_ring() {
        assert_eq!(pick_preference(RingPref::Auto, None, true), RingPref::Auto);
    }

    /// After the first run the filename is meaningless: a self-update overwrites
    /// the exe in place, so a `-beta.exe` name outlives any later tray choice and
    /// would silently revert it on every restart.
    #[test]
    fn the_stored_preference_outranks_the_filename_after_the_first_run() {
        for name in [None, Some(Channel::Stable), Some(Channel::Beta), Some(Channel::Alpha)] {
            assert_eq!(pick_preference(RingPref::Auto, name, false), RingPref::Auto);
            assert_eq!(
                pick_preference(RingPref::Pinned(Channel::Stable), name, false),
                RingPref::Pinned(Channel::Stable)
            );
        }
    }

    /// A clamp names the ceiling exactly; an un-clamped answer only proves the
    /// role reaches at least the ring that was asked for.
    #[test]
    fn the_known_ring_ceiling_comes_from_the_servers_clamp() {
        // Auto asks for alpha and is clamped to stable → the ceiling IS stable.
        let c = widened_max(None, Channel::Alpha, Channel::Stable, true);
        assert_eq!(c, Channel::Stable);
        assert!(ring_within(Channel::Stable, Some(c)));
        assert!(!ring_within(Channel::Beta, Some(c)));
        assert!(!ring_within(Channel::Alpha, Some(c)));

        // Un-clamped alpha → admin. A later un-clamped stable request must not
        // narrow that back down: it proves nothing about the ceiling.
        let c = widened_max(Some(c), Channel::Alpha, Channel::Alpha, false);
        assert_eq!(c, Channel::Alpha);
        assert_eq!(widened_max(Some(c), Channel::Stable, Channel::Stable, false), Channel::Alpha);

        // …but a fresh clamp does narrow it — that is the server speaking, and a
        // demoted account must lose the rings it no longer reaches.
        assert_eq!(widened_max(Some(c), Channel::Alpha, Channel::Beta, true), Channel::Beta);
    }

    /// Signing out — or in — must drop everything the previous identity's
    /// checks revealed: a viewer's stable ceiling has no business greying out
    /// the rings in an admin's menu a moment later.
    #[test]
    fn forgetting_the_entitlement_reopens_every_ring() {
        let _serial = serial();
        note_max_ring(Channel::Alpha, Channel::Stable, true);
        assert_eq!(max_ring(), Some(Channel::Stable));
        assert!(!ring_is_available(Channel::Alpha));
        set_state(State::Current);

        forget_entitlement();

        assert_eq!(max_ring(), None);
        for c in Channel::ALL_DESCENDING {
            assert!(ring_is_available(c), "{c:?} must be pickable again");
        }
        assert!(matches!(state(), State::Unknown), "the old identity's verdict must go too");
    }

    /// Nothing learned yet (offline, or the first 20 s of a run) must leave every
    /// ring pickable — greying them on a guess would hide the control that fixes
    /// a wrong ring.
    #[test]
    fn an_unknown_ceiling_offers_every_ring() {
        for c in Channel::ALL_DESCENDING {
            assert!(ring_within(c, None));
        }
    }

    /// Auto mode, signed out: stable is current, but the ring we asked for
    /// (alpha) is ahead. That must surface as the sign-in-to-check hint — this is
    /// literally the reported symptom, "why does it still say 0.4.4 is current".
    #[test]
    fn auto_mode_surfaces_a_higher_ring_that_leads_the_served_one() {
        let feed = format!(
            r#"{{"version":"{CURRENT_VERSION}","channel":"stable","requestedVersion":"99.0.0"}}"#
        );
        assert!(matches!(auto_outcome(&feed, Channel::Stable), Outcome::PreRelease(v) if v == "99.0.0"));
    }

    #[test]
    fn auto_mode_stays_quiet_when_no_ring_is_ahead() {
        // Everything promoted: the ring we were served already has it.
        let feed = format!(
            r#"{{"version":"{CURRENT_VERSION}","channel":"alpha","requestedVersion":"{CURRENT_VERSION}"}}"#
        );
        assert!(matches!(auto_outcome(&feed, Channel::Alpha), Outcome::Current));
        // A feed too old to report the field can say nothing — so it says nothing.
        let old = format!(r#"{{"version":"{CURRENT_VERSION}","channel":"stable"}}"#);
        assert!(matches!(auto_outcome(&old, Channel::Stable), Outcome::Current));
        // A higher ring that TRAILS this build is not a hint either.
        let behind = format!(
            r#"{{"version":"{CURRENT_VERSION}","channel":"stable","requestedVersion":"0.0.1"}}"#
        );
        assert!(matches!(auto_outcome(&behind, Channel::Stable), Outcome::Current));
    }

    /// An installable build on the ring we CAN have always wins over a hint about
    /// one we might not — otherwise a signed-out install would sit on a nag
    /// instead of taking the update that was right there.
    #[test]
    fn auto_mode_installs_the_reachable_build_before_hinting_at_a_higher_ring() {
        let feed = r#"{"version":"99.0.0","channel":"stable","requestedVersion":"99.9.9",
            "platforms":{"win-x64-stable":{"url":"https://example.invalid/a.exe",
            "sha256":"ab","size_bytes":7}}}"#;
        match auto_outcome(feed, Channel::Stable) {
            Outcome::Newer(rel) => {
                assert_eq!(rel.version, "99.0.0");
                assert_eq!(rel.url, "https://example.invalid/a.exe");
            }
            _ => panic!("a newer build on the served ring must be installed, not hinted at"),
        }
    }

    /// The asset picked must belong to the ring actually being followed, so the
    /// installed file keeps its ring-marked name.
    #[test]
    fn the_asset_follows_the_ring_being_installed_from() {
        let feed = r#"{"version":"99.0.0","platforms":{
            "win-x64-stable":{"url":"https://example.invalid/s.exe","sha256":"ab","size_bytes":1},
            "win-x64-alpha":{"url":"https://example.invalid/a.exe","sha256":"cd","size_bytes":2}}}"#;
        match release_outcome(feed, Channel::Alpha) {
            Outcome::Newer(rel) => assert_eq!(rel.url, "https://example.invalid/a.exe"),
            _ => panic!("expected the alpha asset"),
        }
        match release_outcome(feed, Channel::Stable) {
            Outcome::Newer(rel) => assert_eq!(rel.url, "https://example.invalid/s.exe"),
            _ => panic!("expected the stable asset"),
        }
    }

    #[test]
    fn a_tray_ring_pick_drops_the_previous_rings_verdict() {
        let _serial = serial();
        set_state(State::Current);
        set_preference(RingPref::Pinned(Channel::Alpha));
        assert!(matches!(state(), State::Unknown), "a stale 'up to date' must not survive");
        assert_eq!(preference(), RingPref::Pinned(Channel::Alpha));
        // A pinned pick also fixes the readout immediately, before any check.
        assert_eq!(effective_ring(), Channel::Alpha);
        set_preference(RingPref::Auto);
        assert_eq!(preference(), RingPref::Auto);
        // Restore the process defaults for whatever test runs next.
        init(RingPref::Auto, Channel::Stable);
        set_state(State::Unknown);
    }
}
