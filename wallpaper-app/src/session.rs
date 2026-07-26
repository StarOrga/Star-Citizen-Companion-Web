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
use std::time::{SystemTime, UNIX_EPOCH};

use crate::crypto;
use crate::log;
use crate::net;
use crate::util;

/// Clock skew allowance, in seconds — same value the uploader uses.
const SKEW_SECS: i64 = 60;

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
        let sealed = fs::read(Session::path()).ok()?;
        let plain = crypto::dpapi_unprotect(&sealed)?;
        let text = String::from_utf8(plain).ok()?;
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

    pub fn clear() {
        let _ = fs::remove_file(Session::path());
    }
}

/// Best-effort "give me a usable access token".
///
/// Returns `None` when there is no stored session, or the refresh was rejected
/// (the store is then cleared). Callers treat `None` as "not signed in" and fall
/// back to the anonymous, stable-clamped update check — never as an error.
pub fn ensure_access_token() -> Option<String> {
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
        Some(fresh) => {
            fresh.save();
            log::line("session: access token refreshed silently");
            Some(fresh.access_token)
        }
        None => {
            log::line("session: refresh rejected — clearing stored session");
            Session::clear();
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
pub fn revalidate() -> Option<String> {
    let session = Session::load()?;
    if !session.can_refresh() {
        Session::clear();
        return None;
    }
    match refresh(&session.refresh_token) {
        Some(fresh) => {
            fresh.save();
            log::line("session: re-validated against the auth server");
            Some(fresh.access_token)
        }
        None => {
            log::line("session: refresh rejected on re-validation — signed out server-side");
            Session::clear();
            None
        }
    }
}

/// Exchange a refresh token for a new session (GoTrue rotates the refresh token,
/// so the response's value replaces the stored one).
fn refresh(refresh_token: &str) -> Option<Session> {
    let headers = vec![
        format!("apikey: {}", net::API_KEY),
        format!("Authorization: Bearer {}", net::API_KEY),
        "Content-Type: application/json".to_string(),
    ];
    let body = format!("{{\"refresh_token\":\"{}\"}}", refresh_token.replace('"', ""));
    let (status, text) = net::https_text(
        "POST",
        net::API_HOST,
        "/auth/v1/token?grant_type=refresh_token",
        &headers,
        Some(body.as_bytes()),
    )?;
    if status != 200 {
        log::line(&format!("session: refresh HTTP {status}"));
        return None;
    }
    let access_token = net::json_str(&text, "access_token")?;
    let new_refresh = net::json_str(&text, "refresh_token").unwrap_or_default();
    // GoTrue sends both; prefer the absolute value, else derive it from expires_in.
    let expires_at = net::json_u64(&text, "expires_at").map(|v| v as i64).unwrap_or_else(|| {
        net::json_u64(&text, "expires_in").map(|v| now_secs() + v as i64).unwrap_or(0)
    });
    let email = net::json_str(&text, "email").unwrap_or_default();
    Some(Session { access_token, refresh_token: new_refresh, expires_at, email })
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
}
