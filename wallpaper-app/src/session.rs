//! Persisted Supabase session for the updater.
//!
//! Mirrors the data-uploader's `SessionStore` (`data-uploader/src/lib/session-store.ts`):
//! the access token, the rotating refresh token, its expiry and the account email
//! are written to a single blob that is encrypted at rest with the OS user key —
//! DPAPI here, Electron `safeStorage` there. If sealing is unavailable the
//! session simply is not persisted (in-memory only for this process), exactly
//! like the uploader's `canPersist === false` path; we never fall back to
//! plaintext on disk.
//!
//! Expiry handling matches the uploader's `isAccessTokenFresh`: a 60 s skew, and
//! a missing `expires_at` counts as expired. When the access token is stale the
//! refresh token buys a new one silently (GoTrue rotates it, so the new one is
//! persisted); a rejected refresh clears the store and the user is asked to sign
//! in through the website again.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::crypto;
use crate::log;
use crate::net;
use crate::util;

/// Clock skew allowance, in seconds — same value the uploader uses.
const SKEW_SECS: i64 = 60;

/// Serializes every refresh-token exchange in this process.
///
/// GoTrue ROTATES the refresh token, so two threads refreshing at once means
/// the second one presents a token the first already spent — and a spent token
/// comes back as a 4xx, which [`ensure_access_token`] correctly reads as a
/// verdict and clears the store with. That was harmless while the update poll
/// was the only caller; the gallery's "my upvotes" source is a second one. The
/// loser of the race blocks, then re-reads the store inside the lock and finds
/// the freshly rotated session already there, so it never refreshes at all.
static REFRESH_GATE: Mutex<()> = Mutex::new(());

/// Poison is stepped over: a panic in one refresh must not permanently wedge
/// every later one (the data it guards lives on disk, not in the mutex).
fn refresh_gate() -> MutexGuard<'static, ()> {
    REFRESH_GATE.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Default)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// UNIX seconds at which `access_token` expires; 0 = unknown (⇒ expired).
    pub expires_at: i64,
    pub email: String,
}

/// UNIX seconds now, or 0 if the clock is before the epoch (never in practice).
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Session {
    fn path() -> PathBuf {
        util::data_dir().join("session.bin")
    }

    /// True while the access token is still usable (with the skew margin).
    pub fn is_fresh(&self) -> bool {
        !self.access_token.is_empty() && self.expires_at - SKEW_SECS > now_secs()
    }

    /// True when a refresh could still recover a session without a browser trip.
    pub fn can_refresh(&self) -> bool {
        !self.refresh_token.is_empty()
    }

    /// Load and unseal the stored session. `None` when nothing is stored, the
    /// blob was written by a different user/machine, or it was tampered with.
    pub fn load() -> Option<Session> {
        let path = Session::path();
        // Every failure below used to return None without a word, so a store
        // that silently stopped loading looked exactly like "never signed in" —
        // and the log stayed empty while the user re-authenticated daily. A
        // missing file is the one genuinely uninteresting case.
        let sealed = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
            Err(e) => {
                log::line(&format!("session: cannot read {} ({e})", path.display()));
                return None;
            }
        };
        let Some(plain) = crypto::dpapi_unprotect(&sealed) else {
            log::line(&format!(
                "session: DPAPI could not unseal {} ({} bytes) — sealed by another                  user/machine, or corrupt; sign-in required",
                path.display(),
                sealed.len()
            ));
            return None;
        };
        let Ok(text) = String::from_utf8(plain) else {
            log::line("session: stored blob is not valid UTF-8 — sign-in required");
            return None;
        };
        let mut s = Session::default();
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            match k.trim() {
                "access_token" => s.access_token = v.trim().to_string(),
                "refresh_token" => s.refresh_token = v.trim().to_string(),
                "expires_at" => s.expires_at = v.trim().parse::<i64>().unwrap_or(0),
                "email" => s.email = v.trim().to_string(),
                _ => {}
            }
        }
        if s.access_token.is_empty() && s.refresh_token.is_empty() {
            log::line("session: stored blob carried neither token — sign-in required");
            return None;
        }
        Some(s)
    }

    /// Seal and persist. Returns false when DPAPI is unavailable — the caller
    /// keeps using the in-memory session and simply re-authenticates next time.
    pub fn save(&self) -> bool {
        // Tokens must never contain a newline; a rogue value would otherwise
        // forge extra keys when read back.
        let sanitize = |v: &str| v.replace(['\r', '\n'], "");
        let text = format!(
            "access_token={}\nrefresh_token={}\nexpires_at={}\nemail={}\n",
            sanitize(&self.access_token),
            sanitize(&self.refresh_token),
            self.expires_at,
            sanitize(&self.email),
        );
        let Some(sealed) = crypto::dpapi_protect(text.as_bytes()) else {
            log::line("session: DPAPI unavailable — not persisting (in-memory only)");
            return false;
        };
        match fs::write(Session::path(), sealed) {
            Ok(()) => true,
            Err(e) => {
                log::line(&format!("session: write failed ({e})"));
                false
            }
        }
    }

    /// Drop the stored session. Only ever called when the auth server has
    /// actually rejected the token — never on a transport failure; see
    /// [`RefreshError`]. Logged because "why am I signed out again?" is
    /// otherwise unanswerable after the fact.
    pub fn clear() {
        match fs::remove_file(Session::path()) {
            Ok(()) => log::line("session: stored session discarded — sign-in required"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::line(&format!("session: could not discard the stored session ({e})")),
        }
    }
}

/// The account a session is stored for, for the tray's account entry.
///
/// Purely local: no network, no refresh, no clearing — so it is safe to call on
/// the UI thread while a menu is being built. `Some("")` is a stored session
/// whose hand-off carried no email (the caller then says "signed in" without
/// naming an address); `None` means nothing is stored at all.
pub fn stored_email() -> Option<String> {
    Session::load().map(|s| s.email)
}

/// Best-effort "give me a usable access token".
///
/// Returns `None` when there is no stored session, or the refresh was REJECTED
/// (only then is the store cleared). Callers treat `None` as "not signed in" and
/// fall back to the anonymous, stable-clamped update check — never as an error.
///
/// A refresh that merely could not be delivered leaves the store alone. It used
/// not to: any `None` out of [`refresh`] discarded the session, so one failed
/// request threw away a perfectly good login. The first update poll runs 20 s
/// after start, which on a cold boot is routinely before Wi-Fi, VPN or DNS are
/// up — the app then signed itself out for the rest of the day over nothing.
pub fn ensure_access_token() -> Option<String> {
    // Taken BEFORE the load: a thread that lost the race must re-read the store
    // afterwards, or it would refresh with the token the winner just spent.
    let _gate = refresh_gate();
    let session = Session::load()?;
    if session.is_fresh() {
        return Some(session.access_token);
    }
    if !session.can_refresh() {
        log::line("session: access token expired and no refresh token — sign-in required");
        Session::clear();
        return None;
    }
    match refresh(&session.refresh_token) {
        Ok(fresh) => {
            fresh.save();
            log::line("session: access token refreshed silently");
            Some(fresh.access_token)
        }
        Err(RefreshError::Rejected) => {
            log::line("session: refresh rejected by the auth server — signed out");
            Session::clear();
            None
        }
        Err(RefreshError::Unavailable) => {
            // Keep the session: nothing was learned about the token. The next
            // poll (or the next start) retries with it.
            log::line("session: auth server unreachable — keeping the stored session");
            None
        }
    }
}

/// Re-exchange the stored refresh token even though the access token still looks
/// fresh, and report whether that succeeded.
///
/// Needed because a locally-unexpired JWT says nothing about server-side state: a
/// web logout or a password change revokes it, and the feed then silently treats
/// us as anonymous. That is indistinguishable from "your role is too low" unless
/// we ask. GoTrue rejects the refresh token in exactly those cases, so a failure
/// here means "signed out" (the store is cleared) and a success means the session
/// is genuinely live and the clamp really is about the account's role.
///
/// A refresh we could not deliver proves neither, so it leaves the store intact.
pub fn revalidate() -> Option<String> {
    let _gate = refresh_gate();
    let session = Session::load()?;
    if !session.can_refresh() {
        Session::clear();
        return None;
    }
    match refresh(&session.refresh_token) {
        Ok(fresh) => {
            fresh.save();
            log::line("session: re-validated against the auth server");
            Some(fresh.access_token)
        }
        Err(RefreshError::Rejected) => {
            log::line("session: refresh rejected on re-validation — signed out server-side");
            Session::clear();
            None
        }
        Err(RefreshError::Unavailable) => {
            log::line("session: auth server unreachable on re-validation — session kept");
            None
        }
    }
}

/// Why a refresh produced no session — the distinction the store hangs on.
#[derive(Debug, PartialEq, Eq)]
pub enum RefreshError {
    /// The auth server answered, and said no. A revoked, rotated-away, or
    /// otherwise dead token: the stored session is worthless and must go.
    Rejected,
    /// No usable answer at all — offline, DNS, TLS, a 5xx, or a body we could
    /// not parse. This says NOTHING about the token, so the session survives.
    Unavailable,
}

/// Whether an HTTP status is the auth server rejecting the token, as opposed to
/// failing to serve the request. 4xx is a verdict; 5xx is an outage. Anything
/// else (1xx/3xx here) is not a verdict either, so it must not cost the session.
fn status_is_rejection(status: u16) -> bool {
    (400..500).contains(&status)
}

/// Exchange a refresh token for a new session (GoTrue rotates the refresh token,
/// so the response's value replaces the stored one).
fn refresh(refresh_token: &str) -> Result<Session, RefreshError> {
    let headers = vec![
        format!("apikey: {}", net::API_KEY),
        format!("Authorization: Bearer {}", net::API_KEY),
        "Content-Type: application/json".to_string(),
    ];
    let body = format!("{{\"refresh_token\":\"{}\"}}", refresh_token.replace('"', ""));
    let Some((status, text)) = net::https_text(
        "POST",
        net::API_HOST,
        "/auth/v1/token?grant_type=refresh_token",
        &headers,
        Some(body.as_bytes()),
    ) else {
        // The silent one: this used to return None and cost the user the
        // session, without a single line in the log to show for it.
        log::line("session: refresh request could not be sent (offline?)");
        return Err(RefreshError::Unavailable);
    };
    if status != 200 {
        let rejected = status_is_rejection(status);
        log::line(&format!(
            "session: refresh HTTP {status} — {}",
            if rejected { "token rejected" } else { "server problem, session kept" }
        ));
        return Err(if rejected { RefreshError::Rejected } else { RefreshError::Unavailable });
    }
    let Some(access_token) = net::json_str(&text, "access_token") else {
        // A 200 without a token is a broken response, not a verdict on the token.
        log::line("session: refresh answered 200 without an access token — session kept");
        return Err(RefreshError::Unavailable);
    };
    let new_refresh = net::json_str(&text, "refresh_token").unwrap_or_default();
    // GoTrue sends both; prefer the absolute value, else derive it from expires_in.
    let expires_at = net::json_u64(&text, "expires_at").map(|v| v as i64).unwrap_or_else(|| {
        net::json_u64(&text, "expires_in").map(|v| now_secs() + v as i64).unwrap_or(0)
    });
    let email = net::json_str(&text, "email").unwrap_or_default();
    Ok(Session { access_token, refresh_token: new_refresh, expires_at, email })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(expires_at: i64) -> Session {
        Session {
            access_token: "jwt".into(),
            refresh_token: "r".into(),
            expires_at,
            email: "a@b.c".into(),
        }
    }

    #[test]
    fn freshness_respects_the_skew_window() {
        assert!(at(now_secs() + 3600).is_fresh());
        // Inside the 60 s skew margin counts as already expired.
        assert!(!at(now_secs() + 30).is_fresh());
        assert!(!at(now_secs() - 1).is_fresh());
    }

    #[test]
    fn unknown_expiry_counts_as_expired() {
        assert!(!at(0).is_fresh());
    }

    #[test]
    fn empty_access_token_is_never_fresh() {
        let mut s = at(now_secs() + 3600);
        s.access_token.clear();
        assert!(!s.is_fresh());
    }

    #[test]
    fn refresh_capability_tracks_the_refresh_token() {
        assert!(at(0).can_refresh());
        let mut s = at(0);
        s.refresh_token.clear();
        assert!(!s.can_refresh());
    }

    #[test]
    fn only_a_4xx_is_the_auth_server_rejecting_the_token() {
        // A verdict: the token is dead and the store must be cleared.
        for s in [400, 401, 403, 404, 422, 429, 499] {
            assert!(status_is_rejection(s), "{s} should count as a rejection");
        }
        // Not a verdict — an outage, a proxy, a redirect. Clearing the store
        // here is what signed the user out over a hiccup.
        for s in [500, 502, 503, 504, 301, 302, 100] {
            assert!(!status_is_rejection(s), "{s} must NOT cost the session");
        }
    }
}

