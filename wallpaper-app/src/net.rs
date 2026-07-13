//! Minimal HTTPS via WinHTTP (native TLS, no crates). Two jobs:
//!   1. fetch the Starscape wallpaper list (Supabase PostgREST, publishable key)
//!   2. download an original-resolution image from the RSI media CDN
//! Everything is best-effort: any failure returns None and the caller retries.

use std::ffi::c_void;
use std::path::Path;

use windows_sys::Win32::Networking::WinHttp::{
    WinHttpAddRequestHeaders, WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest,
    WinHttpQueryDataAvailable, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse,
    WinHttpSendRequest, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_ADDREQ_FLAG_ADD,
    WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
};

use crate::util::wide;

// Supabase project (publishable key — the same one shipped in the web bundle;
// public read of `verse_wallpapers` is allowed by RLS). No secret here.
const SUPA_HOST: &str = "hcnqhvzlavdycidqyaai.supabase.co";
const SUPA_KEY: &str = "sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ";
const LIST_PATH: &str =
    "/rest/v1/verse_wallpapers?select=source_url&order=published_at.desc.nullslast&limit=48";

const MEDIA_HOST: &str = "media.robertsspaceindustries.com";
const RSI_REFERER: &str = "https://robertsspaceindustries.com/";

/// GET `https://{host}{path}` with optional extra headers. Returns (status, body).
fn https_get(host: &str, path: &str, headers: &[String]) -> Option<(u16, Vec<u8>)> {
    unsafe {
        let agent = wide("StarscapeWallpaper/0.1");
        let session = WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            std::ptr::null(),
            std::ptr::null(),
            0,
        );
        if session.is_null() {
            return None;
        }
        let host_w = wide(host);
        let connect = WinHttpConnect(session, host_w.as_ptr(), 443, 0);
        if connect.is_null() {
            WinHttpCloseHandle(session);
            return None;
        }
        let verb = wide("GET");
        let path_w = wide(path);
        let request = WinHttpOpenRequest(
            connect,
            verb.as_ptr(),
            path_w.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        );
        if request.is_null() {
            WinHttpCloseHandle(connect);
            WinHttpCloseHandle(session);
            return None;
        }

        for h in headers {
            let hw = wide(h);
            WinHttpAddRequestHeaders(
                request,
                hw.as_ptr(),
                u32::MAX, // -1 → header is NUL-terminated
                WINHTTP_ADDREQ_FLAG_ADD,
            );
        }

        let ok = WinHttpSendRequest(request, std::ptr::null(), 0, std::ptr::null(), 0, 0, 0) != 0
            && WinHttpReceiveResponse(request, std::ptr::null_mut()) != 0;

        let result = if ok {
            let status = query_status(request);
            let body = read_body(request);
            Some((status, body))
        } else {
            None
        };

        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        result
    }
}

unsafe fn query_status(request: *mut c_void) -> u16 {
    let mut code: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let ok = WinHttpQueryHeaders(
        request,
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        std::ptr::null(),
        &mut code as *mut u32 as *mut c_void,
        &mut size,
        std::ptr::null_mut(),
    );
    if ok != 0 {
        code as u16
    } else {
        0
    }
}

unsafe fn read_body(request: *mut c_void) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut avail: u32 = 0;
        if WinHttpQueryDataAvailable(request, &mut avail) == 0 || avail == 0 {
            break;
        }
        let mut chunk = vec![0u8; avail as usize];
        let mut read: u32 = 0;
        if WinHttpReadData(
            request,
            chunk.as_mut_ptr() as *mut c_void,
            avail,
            &mut read,
        ) == 0
        {
            break;
        }
        if read == 0 {
            break;
        }
        chunk.truncate(read as usize);
        out.extend_from_slice(&chunk);
        // Guard against a runaway response (~40 MB is far above any wallpaper).
        if out.len() > 40 * 1024 * 1024 {
            break;
        }
    }
    out
}

/// Fetch the ordered list of original-resolution wallpaper URLs.
pub fn fetch_wallpaper_urls() -> Vec<String> {
    let headers = vec![
        format!("apikey: {SUPA_KEY}"),
        format!("Authorization: Bearer {SUPA_KEY}"),
        "Accept: application/json".to_string(),
    ];
    let Some((status, body)) = https_get(SUPA_HOST, LIST_PATH, &headers) else {
        return Vec::new();
    };
    if status != 200 {
        return Vec::new();
    }
    parse_source_urls(&String::from_utf8_lossy(&body))
}

/// The endpoint returns `[{"source_url":"https://..."}, ...]`. Extract each value
/// with a tiny scan — no JSON crate for a payload this controlled.
fn parse_source_urls(json: &str) -> Vec<String> {
    let mut out = Vec::new();
    let key = "\"source_url\":\"";
    let mut rest = json;
    while let Some(i) = rest.find(key) {
        rest = &rest[i + key.len()..];
        if let Some(end) = rest.find('"') {
            let url = &rest[..end];
            if url.starts_with("https://") {
                out.push(url.to_string());
            }
            rest = &rest[end..];
        } else {
            break;
        }
    }
    out
}

/// Download an RSI-CDN image to `dest`. A valid Referer is what unlocks the CDN
/// for non-browser clients (mirrors the edge function). Returns true on success.
pub fn download_image(url: &str, dest: &Path) -> bool {
    let Some((host, path)) = split_url(url) else { return false };
    // Only the RSI media CDN is expected; refuse anything else.
    if host != MEDIA_HOST {
        return false;
    }
    let headers = vec![format!("Referer: {RSI_REFERER}")];
    let Some((status, body)) = https_get(host, &path, &headers) else { return false };
    if status != 200 || body.len() < 50_000 {
        return false;
    }
    std::fs::write(dest, &body).is_ok()
}

fn split_url(url: &str) -> Option<(&str, String)> {
    let rest = url.strip_prefix("https://")?;
    match rest.find('/') {
        Some(i) => Some((&rest[..i], rest[i..].to_string())),
        None => Some((rest, "/".to_string())),
    }
}
