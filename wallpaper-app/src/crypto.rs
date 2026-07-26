//! Windows CNG / DPAPI primitives used by the updater and the session store:
//! SHA-256, cryptographic random, and at-rest protection for the persisted
//! Supabase session. No crates — same rule as the rest of the app (see net.rs);
//! everything here is raw `windows-sys`.

use std::ffi::c_void;

use windows_sys::Win32::Security::Cryptography::{
    BCryptCloseAlgorithmProvider, BCryptCreateHash, BCryptDestroyHash, BCryptFinishHash,
    BCryptGenRandom, BCryptHashData, BCryptOpenAlgorithmProvider, CryptProtectData,
    CryptUnprotectData, CRYPT_INTEGER_BLOB,
};
use windows_sys::Win32::System::Memory::LocalFree;

use crate::util::wide;

/// `BCRYPT_USE_SYSTEM_PREFERRED_RNG` — lets us pass a null algorithm handle.
const USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;
/// SHA-256 digest length in bytes.
const SHA256_LEN: usize = 32;
/// Feed `BCryptHashData` in bounded chunks: its length parameter is a `u32`, and
/// a slice longer than `u32::MAX` would silently truncate.
const HASH_CHUNK: usize = 1024 * 1024;

/// Application-specific DPAPI entropy. Ties the protected session blob to this
/// app: another program running as the same user cannot unprotect it by simply
/// handing the bytes to `CryptUnprotectData`.
const DPAPI_ENTROPY: &[u8] = b"StarscapeWallpaper/session/v1";

/// Lowercase-hex SHA-256 of `bytes` via Windows CNG.
///
/// Returns `None` if CNG refuses at any step. The updater treats that as
/// "unverified" and refuses to install — never as "hash matched".
pub fn sha256_hex(bytes: &[u8]) -> Option<String> {
    let mut digest = [0u8; SHA256_LEN];
    unsafe {
        let algid = wide("SHA256");
        let mut alg: *mut c_void = std::ptr::null_mut();
        if BCryptOpenAlgorithmProvider(&mut alg, algid.as_ptr(), std::ptr::null(), 0) != 0 {
            return None;
        }
        let mut hash: *mut c_void = std::ptr::null_mut();
        // Null hash-object buffer → CNG allocates and frees it internally (Win8+).
        let created = BCryptCreateHash(alg, &mut hash, std::ptr::null_mut(), 0, std::ptr::null(), 0, 0);
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
        if ok && BCryptFinishHash(hash, digest.as_mut_ptr(), SHA256_LEN as u32, 0) != 0 {
            ok = false;
        }
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(alg, 0);
        if !ok {
            return None;
        }
    }
    Some(hex_lower(&digest))
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
