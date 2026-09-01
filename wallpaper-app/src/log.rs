//! Best-effort diagnostics log at `%APPDATA%\StarscapeWallpaper\starscape.log`.
//!
//! The app is a windowless tray binary built with `panic = "abort"`, so without
//! this a startup failure vanishes with zero feedback — the classic "it just
//! doesn't start". Every write here is best-effort (all errors ignored) so
//! logging itself can never panic, block, or become the reason the app dies.

use std::io::Write as _;
use std::path::Path;

use crate::util::data_dir;

const MAX_BYTES: u64 = 1_048_576; // 1 MB — plenty for diagnostics, keeps autostart tidy.

/// Append one timestamped line to the log file. Never panics.
pub fn line(msg: &str) {
    let path = data_dir().join("starscape.log");
    trim_if_large(&path);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {}", timestamp(), msg);
    }
}

/// Record any panic (message + location) before the process aborts. Turns a
/// silent crash into a diagnosable line in the log — and, so the maintainer
/// learns about it at all, into a crash record the NEXT launch reports through
/// the shared telemetry ingest (see `telemetry::record_panic`; the send itself
/// is deferred and gated on the user's opt-out, this hook only writes a file).
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "?".to_string());
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        line(&format!("PANIC at {loc}: {msg}"));
        crate::telemetry::record_panic(&loc, &msg);
    }));
}

/// Reset the log once it grows past [`MAX_BYTES`]. Best-effort; a diagnostic log
/// needs recent events, not unbounded history across weeks of autostart.
fn trim_if_large(path: &Path) {
    if let Ok(m) = std::fs::metadata(path) {
        if m.len() > MAX_BYTES {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// `[YYYY-MM-DD HH:MM:SSZ]` in UTC, computed with pure `std` (no extra Win32
/// surface to keep the binary tiny and the build dependency-free). Uses
/// Howard Hinnant's civil-from-days algorithm.
fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => return "[????-??-??]".to_string(),
    };
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    // civil_from_days: days since 1970-01-01 → (year, month, day).
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };

    format!("[{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}Z]")
}
