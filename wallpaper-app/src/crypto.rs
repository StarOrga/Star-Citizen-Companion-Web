//! Windows CNG / DPAPI primitives used by the updater, the telemetry reporter
//! and the session store: SHA-256, HMAC-SHA-256, cryptographic random, and
//! at-rest protection for the persisted Supabase session. No crates — same rule
//! as the rest of the app (see net.rs); everything here is raw `windows-sys`.

use std::ffi::c_void;

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    BCryptCloseAlgorithmProvider, BCryptCreateHash, BCryptDestroyHash, BCryptFinishHash,
    BCryptGenRandom, BCryptHashData, BCryptOpenAlgorithmProvider, CryptProtectData,
    CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

use crate::util::wide;

/// `BCRYPT_USE_SYSTEM_PREFERRED_RNG` — lets us pass a null algorithm handle.
const USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;
/// `BCRYPT_ALG_HANDLE_HMAC_FLAG` — opens the SHA-256 provider in HMAC mode so
/// `BCryptCreateHash` accepts a secret and produces an HMAC, not a plain hash.
const ALG_HANDLE_HMAC_FLAG: u32 = 0x0000_0008;
/// SHA-256 digest length in bytes.
const SHA256_LEN: usize = 32;
/// Feed `BCryptHashData` in bounded chunks: its length parameter is a `u32`, and
/// a slice longer than `u32::MAX` would silently truncate.
const HASH_CHUNK: usize = 1024 * 1024;

/// Application-specific DPAPI entropy, so the blob does not unseal by simply
/// handing the bytes to `CryptUnprotectData`.
///
/// Not a secret and not claimed to be one: this string sits in a public repo and
/// in a public unsigned binary. It raises the bar from "any tool that walks
/// %APPDATA% and calls CryptUnprotectData" to "a tool written for Starscape". The
/// real boundary is DPAPI's user+machine binding — anything already running as
/// this user can unseal the session, and that is inherent to at-rest protection
/// without a user-supplied passphrase (the data-uploader's `safeStorage` has the
/// identical property).
const DPAPI_ENTROPY: &[u8] = b"StarscapeWallpaper/session/v1";

/// Lowercase-hex SHA-256 of `bytes` via Windows CNG.
///
/// Returns `None` if CNG refuses at any step. The updater treats that as
/// "unverified" and refuses to install — never as "hash matched".
pub fn sha256_hex(bytes: &[u8]) -> Option<String> {
    digest(bytes, None).map(|d| hex_lower(&d))
}

/// Lowercase-hex HMAC-SHA-256 of `msg` under `key`, via Windows CNG.
///
/// This is the `X-SCC-Signature` the shared `ingest-telemetry` edge function
/// verifies over `"{timestamp}.{body}"` — byte-for-byte what node:crypto's
/// `createHmac('sha256', key)` produces for the data-uploader, so both clients
/// speak the identical wire contract. `None` on any CNG failure; the caller
/// then simply drops the report rather than sending an unsigned one.
pub fn hmac_sha256_hex(key: &[u8], msg: &[u8]) -> Option<String> {
    digest(msg, Some(key)).map(|d| hex_lower(&d))
}

/// SHA-256 of `bytes` — keyed (i.e. HMAC-SHA-256) when `key` is `Some`.
/// `None` whenever CNG refuses at any step; never a partial or fallback digest.
fn digest(bytes: &[u8], key: Option<&[u8]>) -> Option<[u8; SHA256_LEN]> {
    let mut out = [0u8; SHA256_LEN];
    unsafe {
        let algid = wide("SHA256");
        let mut alg: *mut c_void = std::ptr::null_mut();
        // The HMAC flag has to be set when the PROVIDER is opened, not when the
        // hash is created — a secret handed to a plain provider is ignored and
        // would silently produce an ordinary SHA-256 the server then rejects.
        let flags = if key.is_some() { ALG_HANDLE_HMAC_FLAG } else { 0 };
        if BCryptOpenAlgorithmProvider(&mut alg, algid.as_ptr(), std::ptr::null(), flags) != 0 {
            return None;
        }
        let (secret, secret_len): (*const u8, u32) = match key {
            Some(k) => (k.as_ptr(), k.len() as u32),
            None => (std::ptr::null(), 0),
        };
        let mut hash: *mut c_void = std::ptr::null_mut();
        // Null hash-object buffer → CNG allocates and frees it internally (Win8+).
        let created = BCryptCreateHash(alg, &mut hash, std::ptr::null_mut(), 0, secret, secret_len, 0);
        if created != 0 {
            BCryptCloseAlgorithmProvider(alg, 0);
            return None;
        }
        let mut ok = true;
        for chunk in bytes.chunks(HASH_CHUNK) {
            if BCryptHashData(hash, chunk.as_ptr(), chunk.len() as u32, 0) != 0 {
                ok = false;
                break;
            }
        }
        if ok && BCryptFinishHash(hash, out.as_mut_ptr(), SHA256_LEN as u32, 0) != 0 {
            ok = false;
        }
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(alg, 0);
        if !ok {
            return None;
        }
    }
    Some(out)
}

/// `len` cryptographically random bytes rendered as lowercase hex. Used for the
/// loopback OAuth CSRF `state`, so a predictable fallback would defeat the point
/// — any CNG failure returns `None` and the auth flow is abandoned.
pub fn random_hex(len: usize) -> Option<String> {
    let mut buf = vec![0u8; len];
    let rc = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if rc != 0 {
        return None;
    }
    Some(hex_lower(&buf))
}

/// DPAPI-protect `plain` for the current user (mirrors the data-uploader's
/// Electron `safeStorage`). `None` when protection is unavailable — the caller
/// then keeps the session in memory only and never writes it to disk, exactly
/// like the uploader does when `safeStorage.isEncryptionAvailable()` is false.
pub fn dpapi_protect(plain: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let mut input = blob(plain);
        let mut entropy = blob(DPAPI_ENTROPY);
        let mut out: CRYPT_INTEGER_BLOB = std::mem::zeroed();
        let ok = CryptProtectData(
            &mut input,
            std::ptr::null(),
            &mut entropy,
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out,
        );
        if ok == 0 {
            return None;
        }
        Some(take_blob(&mut out))
    }
}

/// Reverse of [`dpapi_protect`]. `None` when the blob was written by another
/// user/machine, was tampered with, or the entropy no longer matches — the
/// caller then discards the stored session and asks for a fresh sign-in.
pub fn dpapi_unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let mut input = blob(sealed);
        let mut entropy = blob(DPAPI_ENTROPY);
        let mut out: CRYPT_INTEGER_BLOB = std::mem::zeroed();
        let ok = CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            &mut entropy,
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out,
        );
        if ok == 0 {
            return None;
        }
        Some(take_blob(&mut out))
    }
}

/// Borrowing `CRYPT_INTEGER_BLOB` view over `data`. The DPAPI input blobs are
/// never written to by the API, so casting away constness is sound here.
fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

/// Copy an output blob into a `Vec` and release the LocalAlloc'd buffer DPAPI
/// handed us (leaking it would leak plaintext session bytes).
unsafe fn take_blob(out: &mut CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let v = if out.pbData.is_null() {
        Vec::new()
    } else {
        std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec()
    };
    if !out.pbData.is_null() {
        LocalFree(out.pbData as *mut c_void);
        out.pbData = std::ptr::null_mut();
    }
    v
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xa0, 0xff]), "000fa0ff");
        assert_eq!(hex_lower(&[]), "");
    }

    #[test]
    fn sha256_matches_known_vectors() {
        // FIPS-180 test vectors — proves the CNG wiring, not just "it returned".
        assert_eq!(
            sha256_hex(b"").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
        assert_eq!(
            sha256_hex(b"abc").as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_vectors() {
        // RFC 4231 test case 2 — proves the CNG provider really is in HMAC mode.
        // A provider opened WITHOUT BCRYPT_ALG_HANDLE_HMAC_FLAG silently ignores
        // the secret and returns the plain SHA-256, which the server would then
        // reject as a bad signature with no local symptom whatsoever.
        assert_eq!(
            hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?").as_deref(),
            Some("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
        );
        // RFC 4231 test case 1.
        assert_eq!(
            hmac_sha256_hex(&[0x0bu8; 20], b"Hi There").as_deref(),
            Some("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
        );
    }

    #[test]
    fn hmac_is_keyed_and_differs_from_the_plain_hash() {
        let msg = b"1750000000.{\"type\":\"usage\"}";
        let a = hmac_sha256_hex(b"key-a", msg).expect("hmac");
        let b = hmac_sha256_hex(b"key-b", msg).expect("hmac");
        assert_ne!(a, b, "a different key must give a different signature");
        assert_ne!(Some(a), sha256_hex(msg), "HMAC must not degrade to a plain hash");
    }

    #[test]
    fn sha256_handles_multi_chunk_input() {
        // Longer than HASH_CHUNK → exercises the chunked BCryptHashData loop.
        let big = vec![0x61u8; HASH_CHUNK + 1234];
        let a = sha256_hex(&big).expect("hash");
        assert_eq!(a.len(), 64);
        // Deterministic: the same bytes must hash identically across calls.
        assert_eq!(Some(a), sha256_hex(&big));
    }

    #[test]
    fn random_hex_has_requested_width_and_varies() {
        let a = random_hex(16).expect("rng");
        let b = random_hex(16).expect("rng");
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn dpapi_roundtrips() {
        let secret = b"eyJhbGciOiJIUzI1NiJ9.payload.signature";
        let sealed = dpapi_protect(secret).expect("protect");
        assert_ne!(sealed.as_slice(), secret.as_slice());
        assert_eq!(dpapi_unprotect(&sealed).as_deref(), Some(secret.as_slice()));
    }

    #[test]
    fn dpapi_rejects_tampered_blob() {
        let sealed = dpapi_protect(b"token").expect("protect");
        let mut bad = sealed.clone();
        let last = bad.len() - 1;
        bad[last] ^= 0xff;
        assert!(dpapi_unprotect(&bad).is_none());
    }
}
