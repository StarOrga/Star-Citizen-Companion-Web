//! Anonymous crash + opt-in usage telemetry for Starscape.
//!
//! This is deliberately NOT a second telemetry mechanism. It speaks the exact
//! wire contract v1 the SCC app and the Data Uploader already speak — see
//! `supabase/functions/ingest-telemetry/index.ts` and
//! `data-uploader/src/lib/telemetry.ts`:
//!
//!   POST https://<supabase>/functions/v1/ingest-telemetry
//!   X-SCC-Timestamp: <unix ms>
//!   X-SCC-Signature: hex HMAC-SHA256(key, "<timestamp>.<raw body>")
//!   body: { type: "crash"|"usage", product, role, appVersion, buildId,
//!           channel, os, arch, installId, sessionId, events: [...] }
//!
//! `product` is `"starscape"`, which is what separates these rows from the other
//! two clients in the admin dashboard's per-product view.
//!
//! WHY THE HMAC KEY LIVES IN THE BINARY
//!   Identical reasoning to the data-uploader: `ingest-telemetry` is an
//!   unauthenticated machine endpoint (verify_jwt=false) guarded by a shared
//!   anti-abuse signature. The key is NOT a credential to any user data — writes
//!   are service-role-only and reads go through an admin-gated RPC.
//!
//! PRIVACY
//!   * `installId` / `sessionId` are opaque random hex; the server only ever
//!     stores salted hashes of them, never the raw values.
//!   * A panic report carries the panic message and source location — no user
//!     content, no file paths beyond this crate's own `src/*.rs`.
//!   * Fully opt-out (tray menu → "Send anonymous diagnostics"). When it is off
//!     nothing is sent AND any stored crash record is discarded.
//!
//! Everything here is best-effort: telemetry must never panic, never block the
//! UI thread, and never become the reason the app misbehaves.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::crypto;
use crate::log;
use crate::net;
use crate::update;
use crate::util::{data_dir, Config};

/// Which product these rows belong to — the dashboard's filter dimension.
pub const PRODUCT: &str = "starscape";

/// Wire `role` for this app. Must be in the server's ROLES allow-list; Starscape
/// is a single-process tray app, so it is a plain `desktop` like the uploader.
pub const ROLE: &str = "desktop";

/// Ingest endpoint on the Supabase project the app already talks to.
const INGEST_PATH: &str = "/functions/v1/ingest-telemetry";

/// Fallback signing key, byte-identical to the edge function's own dev default
/// and to the uploader's Vite fallback. A local `cargo build` gets this one.
const DEV_HMAC_KEY: &str = "scc-telemetry-dev-key-v1";

/// Shared anti-abuse signing key, baked in at compile time by CI
/// (`SC_TELEMETRY_HMAC_KEY`), mirroring the data-uploader's
/// `__SC_TELEMETRY_HMAC_KEY__` build define.
const HMAC_KEY: &str = hmac_key();

const fn hmac_key() -> &'static str {
    match option_env!("SC_TELEMETRY_HMAC_KEY") {
        // An env var that exists but is EMPTY is what an unset GitHub secret
        // expands to. Signing with "" would produce a valid-looking signature
        // the server rejects, so treat it as "not configured".
        Some(k) => {
            if k.is_empty() {
                DEV_HMAC_KEY
            } else {
                k
            }
        }
        None => DEV_HMAC_KEY,
    }
}

/// Let the first wallpaper fetch have the network to itself. Telemetry is never
/// urgent; a crash record has already survived a process death by this point.
const STARTUP_DELAY: Duration = Duration::from_secs(20);

/// The one metric this app reports: one row per launch. Sessions and installs
/// fall out of it server-side (distinct session/install hashes).
const METRIC_APP_START: &str = "app_start";

/// File holding a panic recorded by the previous run, flushed on the next start.
const PENDING_CRASH: &str = "pending-crash.txt";

// Client-side redaction budgets, mirroring the uploader's. The server re-clamps
// to the same ceilings; trimming here keeps the payload small.
const MAX_NAME: usize = 120;
const MAX_MESSAGE: usize = 500;
const MAX_ERROR_TYPE: usize = 60;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// Per-process metadata shared by every batch. Owned (not borrowed) so the
/// background thread can hold it without borrowing the config.
pub struct Meta {
    pub app_version: String,
    /// Release-token fingerprint, or `None` for an unsigned local build.
    pub build_id: Option<String>,
    /// Release ring: `stable` | `beta` | `alpha` (`dev` never applies here —
    /// every install follows a ring, see `update::resolve_preference`). Under
    /// the `auto` preference this is the ring the last check actually RESOLVED
    /// to, not the preference itself: which ring a build came from is the useful
    /// fact for triage, and "auto" alone would not say.
    pub channel: String,
    pub os: String,
    pub arch: String,
    /// Stable opaque per-install id (persisted, see [`install_id`]).
    pub install_id: String,
    /// Opaque id for this process launch.
    pub session_id: String,
}

/// One crash-wire event.
pub struct CrashInput {
    /// Coarse bucket — the dashboard groups aborts/crashes by this.
    pub error_type: String,
    /// What the dashboard shows as the event label.
    pub name: String,
    pub message: String,
    /// Pre-serialised JSON object for the `extra` field, or `None`.
    pub extra: Option<String>,
}

/// Live consent, so a mid-session opt-out takes effect immediately rather than
/// at the next launch. Seeded from the config by [`start`] and flipped by the
/// tray menu via [`set_enabled`]. Defaults to `false` so nothing can be written
/// or sent before the config has actually been read.
static ENABLED: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Start the background reporter: flush a panic recorded by the previous run,
/// then report this launch. Returns immediately; all work happens on its own
/// thread and every failure is swallowed into the diagnostics log.
pub fn start(cfg: Config) {
    set_enabled(cfg.telemetry);
    std::thread::spawn(move || {
        if !enabled() {
            log::line("telemetry: disabled by the user — nothing reported");
            return;
        }
        std::thread::sleep(STARTUP_DELAY);
        // Re-check: the user may have opted out during the delay, and the whole
        // point of the atomic is that that decision wins.
        if !enabled() {
            return;
        }

        let Some(meta) = collect_meta(cfg) else {
            log::line("telemetry: no anonymous ids available (CNG refused) — skipping");
            return;
        };

        // The previous run's panic first: it is the only report that can be lost
        // for good if this launch also dies.
        if let Some(crash) = take_pending_crash() {
            post(&crash_body(&meta, &crash), "crash");
        }
        if enabled() {
            post(&usage_body(&meta, METRIC_APP_START, 1, Some(&start_detail(cfg))), "usage");
        }
    });
}

/// Apply the user's consent choice.
///
/// Turning it OFF also DELETES anything already recorded: an opt-out has to mean
/// the data stops existing, not merely that it stops being sent.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
    if !on {
        discard_pending_crash();
    }
}

fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Record a panic for the NEXT start to report.
///
/// Called from the panic hook, so it does exactly one thing: write a small file.
/// Sending here would mean a blocking HTTPS round trip inside a dying process
/// built with `panic = "abort"` — a hang right where the user is already having
/// a bad time. The report is worth more than its promptness.
///
/// A panic BEFORE the config has been read writes nothing: `ENABLED` starts
/// false, so a user who opted out can never have a record written behind their
/// back by an early-startup crash.
pub fn record_panic(location: &str, message: &str) {
    if !enabled() {
        return;
    }
    // Line 1 = location, the rest = message. A panic message can contain
    // anything, including newlines, so the location goes first and the message
    // takes the remainder — no parsing ambiguity either way.
    let record = format!("{}\n{}", clamp(location, MAX_NAME), clamp(message, MAX_MESSAGE));
    let _ = fs::write(pending_path(), record);
}

// ---------------------------------------------------------------------------
// Body builders — pure, so `cargo test` can pin the exact wire shape
// ---------------------------------------------------------------------------

/// Envelope fields every batch carries, without the enclosing braces.
///
/// `osRelease` is deliberately absent: reading the real Windows build number
/// needs an HKLM registry read this app otherwise has no reason to do, and the
/// server treats a missing field as null. Adding it later is additive.
fn envelope(meta: &Meta, wire_type: &str) -> String {
    let build_id = match &meta.build_id {
        Some(b) => format!("\"{}\"", esc(b)),
        None => "null".to_string(),
    };
    format!(
        "\"type\":\"{ty}\",\"product\":\"{product}\",\"role\":\"{role}\",\
         \"appVersion\":\"{version}\",\"buildId\":{build_id},\"channel\":\"{channel}\",\
         \"os\":\"{os}\",\"arch\":\"{arch}\",\
         \"installId\":\"{install}\",\"sessionId\":\"{session}\"",
        ty = esc(wire_type),
        product = PRODUCT,
        role = ROLE,
        version = esc(&meta.app_version),
        channel = esc(&meta.channel),
        os = esc(&meta.os),
        arch = esc(&meta.arch),
        install = esc(&meta.install_id),
        session = esc(&meta.session_id),
    )
}

/// The exact JSON body the server expects for a single-event `crash` batch.
pub fn crash_body(meta: &Meta, c: &CrashInput) -> String {
    format!(
        "{{{env},\"events\":[{{\"errorType\":\"{et}\",\"name\":\"{name}\",\
         \"message\":\"{msg}\",\"stack\":null,\"extra\":{extra}}}]}}",
        env = envelope(meta, "crash"),
        et = esc(&clamp(&c.error_type, MAX_ERROR_TYPE)),
        name = esc(&clamp(&c.name, MAX_NAME)),
        msg = esc(&clamp(&c.message, MAX_MESSAGE)),
        extra = c.extra.as_deref().unwrap_or("null"),
    )
}

/// The exact JSON body the server expects for a single-event `usage` batch.
/// `detail_json` must already be a JSON object literal — every caller here
/// builds it from known-safe values via [`start_detail`].
pub fn usage_body(meta: &Meta, metric: &str, value: i64, detail_json: Option<&str>) -> String {
    format!(
        "{{{env},\"events\":[{{\"metric\":\"{metric}\",\"value\":{value},\"detail\":{detail}}}]}}",
        env = envelope(meta, "usage"),
        metric = esc(&clamp(metric, MAX_NAME)),
        detail = detail_json.unwrap_or("null"),
    )
}

/// What the app is actually configured to do, attached to the launch event.
/// This is the only product signal in the whole payload — "how many people run
/// Starscape as a screensaver" is otherwise unanswerable.
fn start_detail(cfg: Config) -> String {
    format!(
        "{{\"mode\":\"{mode}\",\"fade\":{fade},\"paused\":{paused},\
         \"intervalMin\":{interval},\"screensaverAfterMin\":{ss},\"summaryOnBoot\":{summary}}}",
        mode = esc(cfg.mode.as_str()),
        fade = cfg.fade,
        paused = cfg.paused,
        interval = cfg.interval_min,
        ss = cfg.screensaver_after_min,
        summary = cfg.summary_on_boot,
    )
}

/// Minimal JSON string escaping. The payload is built by hand (a JSON crate
/// would dwarf this binary — same rule as `net::json_str`), and a panic message
/// is arbitrary text, so this has to be correct rather than convenient.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Every other control character has to be escaped too, or the body
            // is invalid JSON and the whole batch is rejected as a bad payload.
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Truncate to `max` CHARACTERS. Slicing by byte index would panic in the
/// middle of a multi-byte character — in a panic reporter, of all places.
fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

// ---------------------------------------------------------------------------
// Runtime plumbing
// ---------------------------------------------------------------------------

/// Assemble the per-process metadata. `None` when CNG cannot produce the
/// anonymous ids — without them the rows cannot be de-duplicated server-side,
/// so reporting is skipped rather than sent unattributable.
fn collect_meta(cfg: Config) -> Option<Meta> {
    Some(Meta {
        app_version: update::CURRENT_VERSION.to_string(),
        build_id: update::build_id().map(|b| b.to_string()),
        channel: cfg.channel.as_key().to_string(),
        os: "win".to_string(),
        arch: normalise_arch(std::env::consts::ARCH).to_string(),
        install_id: install_id()?,
        session_id: crypto::random_hex(16)?,
    })
}

/// Map Rust's arch names onto the server's short vocabulary (`x64` / `arm64`),
/// which is what the uploader already reports.
fn normalise_arch(arch: &str) -> &str {
    match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

/// Stable opaque per-install id, persisted next to the config.
///
/// It lives in its own file rather than in `config.ini` on purpose: `Config` is
/// `Copy` and passed by value throughout `main.rs`, and a `String` field would
/// break that for every caller.
fn install_id() -> Option<String> {
    let path = data_dir().join("install-id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim();
        // Only accept something we plausibly wrote: a truncated or hand-edited
        // file must mint a fresh id instead of poisoning the install count.
        if existing.len() >= 16 && existing.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(existing.to_string());
        }
    }
    let fresh = crypto::random_hex(16)?;
    let _ = fs::write(&path, &fresh);
    Some(fresh)
}

fn pending_path() -> PathBuf {
    data_dir().join(PENDING_CRASH)
}

/// Read and REMOVE the stored panic record. Removing it before the send is
/// deliberate: a report that cannot be delivered must not be retried forever on
/// every single launch.
fn take_pending_crash() -> Option<CrashInput> {
    let path = pending_path();
    let raw = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let (location, message) = match raw.split_once('\n') {
        Some((loc, msg)) => (loc.trim().to_string(), msg.to_string()),
        None => (String::new(), raw),
    };
    if message.trim().is_empty() && location.is_empty() {
        return None;
    }
    Some(CrashInput {
        error_type: "panic".to_string(),
        name: "Panic".to_string(),
        message,
        extra: Some(format!("{{\"location\":\"{}\"}}", esc(&location))),
    })
}

fn discard_pending_crash() {
    let _ = fs::remove_file(pending_path());
}

/// Sign and send one batch. `label` only ever reaches the local log.
fn post(body: &str, label: &str) -> bool {
    let ts = now_ms().to_string();
    // Exactly the bytes the server re-signs: "<timestamp>.<raw body>".
    let signed = format!("{ts}.{body}");
    let Some(signature) = crypto::hmac_sha256_hex(HMAC_KEY.as_bytes(), signed.as_bytes()) else {
        log::line("telemetry: HMAC unavailable — report dropped");
        return false;
    };
    let headers = vec![
        "Content-Type: application/json".to_string(),
        format!("X-SCC-Version: {}", update::CURRENT_VERSION),
        format!("X-SCC-Timestamp: {ts}"),
        format!("X-SCC-Signature: {signature}"),
    ];
    match net::https_text("POST", net::API_HOST, INGEST_PATH, &headers, Some(body.as_bytes())) {
        // The ingest function answers 204 with an empty body on success.
        Some((204, _)) => true,
        Some((status, _)) => {
            log::line(&format!("telemetry: {label} rejected (HTTP {status})"));
            false
        }
        None => {
            log::line(&format!("telemetry: {label} send failed"));
            false
        }
    }
}

/// Unix time in milliseconds — what the server's replay window compares against.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::Mode;

    fn meta() -> Meta {
        Meta {
            app_version: "0.4.4".to_string(),
            build_id: Some("abcd1234".to_string()),
            channel: "alpha".to_string(),
            os: "win".to_string(),
            arch: "x64".to_string(),
            install_id: "0123456789abcdef0123456789abcdef".to_string(),
            session_id: "fedcba9876543210fedcba9876543210".to_string(),
        }
    }

    #[test]
    fn envelope_carries_the_product_and_role_the_server_allow_lists() {
        let body = usage_body(&meta(), "app_start", 1, None);
        assert!(body.contains("\"product\":\"starscape\""), "{body}");
        assert!(body.contains("\"role\":\"desktop\""), "{body}");
        assert!(body.contains("\"type\":\"usage\""), "{body}");
        assert!(body.contains("\"channel\":\"alpha\""), "{body}");
        assert!(body.contains("\"metric\":\"app_start\""), "{body}");
        assert!(body.contains("\"detail\":null"), "{body}");
    }

    #[test]
    fn an_unsigned_build_reports_a_null_build_id() {
        let mut m = meta();
        m.build_id = None;
        assert!(usage_body(&m, "app_start", 1, None).contains("\"buildId\":null"));
        assert!(usage_body(&meta(), "app_start", 1, None).contains("\"buildId\":\"abcd1234\""));
    }

    #[test]
    fn crash_body_has_the_wire_shape_the_ingest_function_parses() {
        let body = crash_body(
            &meta(),
            &CrashInput {
                error_type: "panic".to_string(),
                name: "Panic".to_string(),
                message: "index out of bounds".to_string(),
                extra: Some("{\"location\":\"src/gfx.rs:120\"}".to_string()),
            },
        );
        assert!(body.starts_with('{') && body.ends_with('}'), "{body}");
        assert!(body.contains("\"type\":\"crash\""), "{body}");
        assert!(body.contains("\"errorType\":\"panic\""), "{body}");
        assert!(body.contains("\"name\":\"Panic\""), "{body}");
        assert!(body.contains("\"stack\":null"), "{body}");
        assert!(body.contains("\"location\":\"src/gfx.rs:120\""), "{body}");
    }

    #[test]
    fn a_panic_message_with_quotes_and_newlines_stays_valid_json() {
        // A real panic payload is arbitrary text. Unescaped, it would break the
        // body and the server would answer 400 for every crash we ever send.
        let body = crash_body(
            &meta(),
            &CrashInput {
                error_type: "panic".to_string(),
                name: "Panic".to_string(),
                message: "called \"unwrap\"\non a\tNone\\value\u{7}".to_string(),
                extra: None,
            },
        );
        // Each escape is checked on its own: one long literal is exactly the
        // kind of assertion that is easier to typo than the code it guards.
        for expected in [
            "called \\\"unwrap\\\"", // a quote      becomes  backslash + quote
            "\\non a",                // a newline    becomes  backslash + n
            "\\tNone",                // a tab        becomes  backslash + t
            "\\\\value",              // a backslash  becomes  two backslashes
            "\\u0007",                // any other control char becomes \uXXXX
        ] {
            assert!(body.contains(expected), "missing {expected} in {body}");
        }
        assert!(body.contains("\"extra\":null"), "{body}");
        // Nothing raw may survive into the body.
        assert!(!body.contains('\n'), "{body}");
        assert!(!body.contains('\t'), "{body}");
    }

    #[test]
    fn clamp_never_splits_a_multi_byte_character() {
        // Byte slicing here would panic; the reporter must not be the thing that
        // crashes while reporting a crash.
        assert_eq!(clamp("äöü€", 2), "äö");
        assert_eq!(clamp("abc", 10), "abc");
        assert_eq!(clamp("", 3), "");
    }

    #[test]
    fn start_detail_reports_the_configuration_as_json_scalars() {
        let mut cfg = Config::default();
        cfg.mode = Mode::Screensaver;
        cfg.fade = false;
        cfg.interval_min = 45;
        let detail = start_detail(cfg);
        assert!(detail.contains("\"mode\":\"screensaver\""), "{detail}");
        // Booleans must be JSON booleans, not "true"/"false" strings.
        assert!(detail.contains("\"fade\":false"), "{detail}");
        assert!(detail.contains("\"intervalMin\":45"), "{detail}");
    }

    #[test]
    fn arch_uses_the_servers_short_vocabulary() {
        assert_eq!(normalise_arch("x86_64"), "x64");
        assert_eq!(normalise_arch("aarch64"), "arm64");
        assert_eq!(normalise_arch("riscv64"), "riscv64");
    }

    #[test]
    fn hmac_key_falls_back_when_ci_did_not_bake_one_in() {
        // An unset GitHub secret expands to an EMPTY string, not to "absent".
        assert!(!HMAC_KEY.is_empty(), "signing with an empty key is never valid");
    }
}
