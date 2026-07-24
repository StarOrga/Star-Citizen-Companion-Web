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
    WINHTTP_FLAG_SECURE, WINHTTP_QUERY_CONTENT_LENGTH, WINHTTP_QUERY_FLAG_NUMBER,
    WINHTTP_QUERY_STATUS_CODE,
};

use crate::log;
use crate::util::wide;

// Supabase project (publishable key — the same one shipped in the web bundle;
// public read of `verse_wallpapers` is allowed by RLS). No secret here.
const SUPA_HOST: &str = "hcnqhvzlavdycidqyaai.supabase.co";
const SUPA_KEY: &str = "sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ";
const LIST_PATH: &str =
    "/rest/v1/verse_wallpapers?select=source_url&order=published_at.desc.nullslast&limit=48";

const MEDIA_HOST: &str = "media.robertsspaceindustries.com";
const RSI_REFERER: &str = "https://robertsspaceindustries.com/";

/// A fully-received HTTP response. `content_length` is the server-advertised
/// body size when present (used to detect a short/truncated read).
struct Response {
    status: u16,
    content_length: Option<u64>,
    body: Vec<u8>,
}

/// GET `https://{host}{path}` with optional extra headers. Returns `None` on any
/// transport failure OR a mid-stream read failure — a partial body is never
/// handed back, because that is exactly how a corrupt "krisselig" wallpaper used
/// to slip through.
fn https_get(host: &str, path: &str, headers: &[String]) -> Option<Response> {
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
            let content_length = query_content_length(request);
            // A `None` here means a read error mid-stream — treat the whole
            // request as failed rather than returning a truncated body.
            read_body(request).map(|body| Response { status, content_length, body })
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

/// Server-advertised `Content-Length`, if present and numeric. Used only as a
/// truncation check — chunked responses (no length) fall back to the format
/// completeness check in [`download_image`].
unsafe fn query_content_length(request: *mut c_void) -> Option<u64> {
    let mut len: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let ok = WinHttpQueryHeaders(
        request,
        WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
        std::ptr::null(),
        &mut len as *mut u32 as *mut c_void,
        &mut size,
        std::ptr::null_mut(),
    );
    if ok != 0 {
        Some(len as u64)
    } else {
        None
    }
}

/// Read the response body. Returns `None` if the stream fails part-way through
/// (so the caller can distinguish "complete" from "truncated"); `Some(bytes)`
/// only on a clean end-of-response.
unsafe fn read_body(request: *mut c_void) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let mut avail: u32 = 0;
        if WinHttpQueryDataAvailable(request, &mut avail) == 0 {
            return None; // query failed mid-stream → not a clean EOF
        }
        if avail == 0 {
            break; // clean end of response
        }
        let mut chunk = vec![0u8; avail as usize];
        let mut read: u32 = 0;
        if WinHttpReadData(request, chunk.as_mut_ptr() as *mut c_void, avail, &mut read) == 0 {
            return None; // read failed mid-stream → truncated
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
    Some(out)
}

/// Fetch the ordered list of original-resolution wallpaper URLs.
pub fn fetch_wallpaper_urls() -> Vec<String> {
    let headers = vec![
        format!("apikey: {SUPA_KEY}"),
        format!("Authorization: Bearer {SUPA_KEY}"),
        "Accept: application/json".to_string(),
    ];
    let Some(resp) = https_get(SUPA_HOST, LIST_PATH, &headers) else {
        return Vec::new();
    };
    if resp.status != 200 {
        log::line(&format!("list: HTTP {} from Supabase", resp.status));
        return Vec::new();
    }
    parse_source_urls(&String::from_utf8_lossy(&resp.body))
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

/// Fetch the weekly Verse-News summary image (rendered server-side by the
/// `starscape-summary` edge function) and write it to `dest`. Unlike
/// [`download_image`] this targets the Supabase host directly (never the RSI
/// CDN allowlist in that function), reusing the same truncation/size guards.
pub fn fetch_summary_image(dest: &Path, w: u32, h: u32) -> bool {
    let path = format!("/functions/v1/starscape-summary?w={w}&h={h}");
    let headers = vec![
        format!("apikey: {SUPA_KEY}"),
        format!("Authorization: Bearer {SUPA_KEY}"),
    ];
    let Some(resp) = https_get(SUPA_HOST, &path, &headers) else {
        log::line("summary: request/read failed (truncated?)");
        return false;
    };
    if resp.status != 200 {
        log::line(&format!("summary: HTTP {} from starscape-summary", resp.status));
        return false;
    }
    if resp.body.len() < 5_000 {
        log::line(&format!("summary: implausibly small ({} bytes)", resp.body.len()));
        return false;
    }
    if !image_looks_complete(&resp.body) {
        log::line(&format!("summary: incomplete image data ({} bytes)", resp.body.len()));
        return false;
    }
    match std::fs::write(dest, &resp.body) {
        Ok(()) => true,
        Err(e) => {
            log::line(&format!("summary: write failed ({e}) for {}", dest.display()));
            false
        }
    }
}

/// Download an RSI-CDN image to `dest`. A valid Referer is what unlocks the CDN
/// for non-browser clients (mirrors the edge function). Returns true only for a
/// complete, well-formed image — a truncated download is rejected so it can
/// never be set as a corrupt wallpaper.
///
/// `min_pixels` is a lower bound on the image's total pixel count (width×height);
/// anything below it is a low-resolution source that would look soft/upscaled
/// when cover-fit onto the desktop, so it is skipped without being written to
/// disk. Pass `0` to disable the check. The size is read straight from the image
/// header (no full decode), and unrecognised formats are kept (never wrongly
/// dropped). A too-small image can only be detected after its bytes arrive — the
/// wallpaper list carries no dimensions — but rejecting it here still avoids the
/// disk write, the GDI+ decode and the wallpaper switch for that image.
pub fn download_image(url: &str, dest: &Path, min_pixels: u64) -> bool {
    let Some((host, path)) = split_url(url) else {
        log::line(&format!("download: unparseable url {url}"));
        return false;
    };
    // Only the RSI media CDN is expected; refuse anything else.
    if host != MEDIA_HOST {
        log::line(&format!("download: refused non-CDN host {host}"));
        return false;
    }
    let headers = vec![format!("Referer: {RSI_REFERER}")];
    let Some(resp) = https_get(host, &path, &headers) else {
        log::line(&format!("download: request/read failed (truncated?) for {url}"));
        return false;
    };
    if resp.status != 200 {
        log::line(&format!("download: HTTP {} for {url}", resp.status));
        return false;
    }
    // Truncation guard #1: fewer bytes than the server said it would send. This
    // is the exact failure that used to yield a half-decoded, grainy wallpaper.
    if let Some(expected) = resp.content_length {
        if (resp.body.len() as u64) < expected {
            log::line(&format!(
                "download: truncated {}/{} bytes for {url}",
                resp.body.len(),
                expected
            ));
            return false;
        }
    }
    if resp.body.len() < 50_000 {
        log::line(&format!("download: implausibly small ({} bytes) for {url}", resp.body.len()));
        return false;
    }
    // Truncation guard #2: the bytes must actually terminate as a complete image
    // (covers chunked responses with no Content-Length).
    if !image_looks_complete(&resp.body) {
        log::line(&format!("download: incomplete image data ({} bytes) for {url}", resp.body.len()));
        return false;
    }
    // Resolution floor: skip a source with fewer than `min_pixels` total pixels
    // (e.g. under 1/5 of the desktop's pixel count) — it would look soft when
    // scaled to fill. Unknown formats report no size and are kept.
    if min_pixels > 0 {
        if let Some((iw, ih)) = image_dimensions(&resp.body) {
            let px = iw as u64 * ih as u64;
            if px < min_pixels {
                log::line(&format!(
                    "download: skipped low-res {iw}x{ih} ({px}px < {min_pixels}px floor) for {url}"
                ));
                return false;
            }
        }
    }
    match std::fs::write(dest, &resp.body) {
        Ok(()) => true,
        Err(e) => {
            log::line(&format!("download: write failed ({e}) for {}", dest.display()));
            false
        }
    }
}

/// True if `bytes` is a fully-terminated JPEG or PNG. A truncated (progressive)
/// JPEG decodes into visible grain/scanline garbage — the precise artefact this
/// guards against. Any other, unrecognised format falls through to `true` so a
/// valid-but-uncommon image is never wrongly rejected (the size floor already
/// applied in [`download_image`]).
fn image_looks_complete(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    // JPEG: starts with SOI (FF D8), ends with EOI (FF D9). Tolerate a few
    // trailing padding bytes some encoders append after EOI.
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let window = 8usize.min(bytes.len());
        return bytes[bytes.len() - window..]
            .windows(2)
            .any(|w| w[0] == 0xFF && w[1] == 0xD9);
    }
    // PNG: 8-byte signature, terminated by the IEND chunk.
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const PNG_IEND: [u8; 8] = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
    if bytes.starts_with(&PNG_SIG) {
        return bytes.ends_with(&PNG_IEND);
    }
    true
}

/// Read an image's pixel dimensions `(width, height)` straight from its header,
/// without a full decode — cheap enough to run on every prefetched image. Only
/// JPEG (SOFn frame header) and PNG (IHDR chunk) are understood; any other or
/// malformed format returns `None`, and the caller then keeps the image (same
/// permissive stance as [`image_looks_complete`]).
fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    // PNG: 8-byte signature, then the IHDR chunk whose first two fields are the
    // width and height as big-endian u32 at the fixed offsets 16 and 20.
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.starts_with(&PNG_SIG) {
        if bytes.len() < 24 {
            return None;
        }
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return (w != 0 && h != 0).then_some((w, h));
    }

    // JPEG: walk the marker segments until a Start-Of-Frame (SOFn) reports the
    // frame's height and width. Each marker is 0xFF followed by its code (with
    // optional 0xFF fill bytes in between); most carry a 2-byte big-endian
    // length. Stop at Start-Of-Scan, where entropy-coded data begins.
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2usize;
        while i + 1 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            // Collapse any run of 0xFF fill bytes to land on the marker code.
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] == 0xFF {
                j += 1;
            }
            if j >= bytes.len() {
                return None;
            }
            let marker = bytes[j];
            let seg = j + 1; // first byte after the marker code
            match marker {
                // Stand-alone markers (no length payload): padding/SOI/EOI/RSTn.
                0x01 | 0xD0..=0xD9 => {
                    i = seg;
                }
                // Start-Of-Scan: headers are done, no dimensions past here.
                0xDA => return None,
                // SOFn frame headers carry size — all C0..CF except DHT(C4),
                // JPG(C8) and DAC(CC), which are not frame headers.
                0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => {
                    // [len_hi len_lo precision h_hi h_lo w_hi w_lo ...]
                    if seg + 6 >= bytes.len() {
                        return None;
                    }
                    let h = u32::from(u16::from_be_bytes([bytes[seg + 3], bytes[seg + 4]]));
                    let w = u32::from(u16::from_be_bytes([bytes[seg + 5], bytes[seg + 6]]));
                    return (w != 0 && h != 0).then_some((w, h));
                }
                // Any other marker: skip its length-prefixed segment.
                _ => {
                    if seg + 1 >= bytes.len() {
                        return None;
                    }
                    let len = u16::from_be_bytes([bytes[seg], bytes[seg + 1]]) as usize;
                    if len < 2 {
                        return None;
                    }
                    i = seg + len;
                }
            }
        }
        return None;
    }

    None
}

fn split_url(url: &str) -> Option<(&str, String)> {
    let rest = url.strip_prefix("https://")?;
    match rest.find('/') {
        Some(i) => Some((&rest[..i], rest[i..].to_string())),
        None => Some((rest, "/".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_dimensions_from_ihdr() {
        // 8-byte signature, IHDR length+type, then width=3840, height=2160.
        let mut png: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend_from_slice(&[0, 0, 0, 13]); // IHDR length
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&3840u32.to_be_bytes());
        png.extend_from_slice(&2160u32.to_be_bytes());
        assert_eq!(image_dimensions(&png), Some((3840, 2160)));
    }

    #[test]
    fn jpeg_dimensions_from_sof0() {
        // SOI, an APP0 segment to skip over, then an SOF0 frame header carrying
        // height=2160 and width=3840.
        let jpeg: Vec<u8> = vec![
            0xFF, 0xD8, // SOI
            0xFF, 0xE0, 0x00, 0x04, 0xAA, 0xBB, // APP0, length 4 (2 payload bytes)
            0xFF, 0xC0, 0x00, 0x11, 0x08, // SOF0, length 17, precision 8
            0x08, 0x70, // height 2160
            0x0F, 0x00, // width 3840
            0x03, // remaining frame bytes (unread)
        ];
        assert_eq!(image_dimensions(&jpeg), Some((3840, 2160)));
    }

    #[test]
    fn jpeg_dimensions_tolerate_fill_bytes() {
        // Extra 0xFF fill bytes before the SOF0 marker code must be collapsed.
        let jpeg: Vec<u8> = vec![
            0xFF, 0xD8, 0xFF, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03,
        ];
        assert_eq!(image_dimensions(&jpeg), Some((1920, 1080)));
    }

    #[test]
    fn unknown_format_reports_no_size() {
        assert_eq!(image_dimensions(&[0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), None);
        assert_eq!(image_dimensions(&[]), None);
    }

    #[test]
    fn truncated_headers_report_no_size() {
        // PNG signature but no IHDR payload.
        assert_eq!(image_dimensions(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), None);
        // JPEG SOI with a dangling marker.
        assert_eq!(image_dimensions(&[0xFF, 0xD8, 0xFF]), None);
    }
}
