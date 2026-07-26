//! Loopback sign-in against the SCC website — the same handshake the
//! data-uploader uses (`data-uploader/src/lib/oauth.ts`), reimplemented on
//! `std::net` so the app keeps its single `windows-sys` dependency.
//!
//! Flow (the JWT never appears in any URL, therefore never in browser history):
//!   1. Bind an ephemeral HTTP server on `127.0.0.1:<port>` serving `/scc/callback`.
//!   2. Open the default browser at
//!      `<web>/desktop/connect?cb=<loopback>&state=<csrf>`.
//!   3. The website authenticates the user and submits a TOP-LEVEL form-POST
//!      navigation to the loopback with `{state, token, email, refresh_token,
//!      expires_at}` in the request body. A navigation is used rather than a
//!      `fetch()` because Chrome's Private Network Access blocks subresource
//!      requests from a public HTTPS origin to 127.0.0.1.
//!   4. We validate `state`, render the "you can close this window" page into
//!      the navigated tab, and hand the session back.
//!
//! `/desktop/connect` is deliberately the route we use, not `/uploader/auth`:
//! the latter is collaborator-gated, while Starscape must work for viewers too
//! (they follow the stable ring). The route accepts any signed-in user and the
//! release channel is clamped server-side by role anyway.

use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

use crate::crypto;
use crate::log;
use crate::session::Session;
use crate::util;

/// Loopback port window. Deliberately disjoint from the data-uploader's
/// 46800-46899 so both apps can wait for a sign-in at the same time.
const PORT_MIN: u16 = 46900;
const PORT_MAX: u16 = 46949;

const WEB_BASE: &str = "https://sc-companion.vercel.app";
/// Fixed path the website posts to (it discards any path from `cb` and rebuilds
/// this one, so path-injection cannot redirect the token elsewhere).
const CALLBACK_PATH: &str = "/scc/callback";

/// How long we keep the loopback open waiting for the browser hand-off.
const TIMEOUT_SECS: u64 = 300;
/// Per-connection socket timeout.
const IO_TIMEOUT_SECS: u64 = 10;
/// A Supabase JWT pair plus an email is far below this; the cap stops a local
/// process from feeding the loopback unbounded data.
const MAX_REQUEST_BYTES: usize = 32 * 1024;

/// Run the full browser sign-in. Blocks the calling thread (always invoked from
/// a worker thread, never the UI thread) and returns `None` on timeout, CSRF
/// mismatch, or any transport problem — the caller then simply stays signed out.
pub fn run_oauth_flow() -> Option<Session> {
    let Some(state) = crypto::random_hex(16) else {
        log::line("auth: CNG random unavailable — refusing to start sign-in without CSRF state");
        return None;
    };
    let (listener, port) = bind_loopback()?;
    if listener.set_nonblocking(true).is_err() {
        log::line("auth: could not set the loopback to non-blocking");
        return None;
    }

    let cb = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let url = format!("{WEB_BASE}/desktop/connect?cb={}&state={}", percent_encode(&cb), state);
    log::line(&format!("auth: waiting for the website hand-off on 127.0.0.1:{port}"));
    util::open_url(&url);

    let deadline = Instant::now() + Duration::from_secs(TIMEOUT_SECS);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(session) = handle_connection(stream, &state) {
                    return Some(session);
                }
                // Not the hand-off (favicon probe, reload, GET) — keep waiting.
            }
            Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => {
                log::line(&format!("auth: loopback accept failed ({e})"));
                return None;
            }
        }
    }
    log::line("auth: sign-in timed out after 5 minutes");
    None
}

/// First free port in the reserved window.
fn bind_loopback() -> Option<(TcpListener, u16)> {
    for port in PORT_MIN..=PORT_MAX {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        if let Ok(l) = TcpListener::bind(addr) {
            return Some((l, port));
        }
    }
    log::line(&format!("auth: no free loopback port in {PORT_MIN}-{PORT_MAX}"));
    None
}

/// Serve one connection. Returns the session only for a valid `POST` hand-off
/// with a matching CSRF state.
fn handle_connection(mut stream: TcpStream, state: &str) -> Option<Session> {
    let _ = stream.set_nonblocking(false);
    let t = Some(Duration::from_secs(IO_TIMEOUT_SECS));
    let _ = stream.set_read_timeout(t);
    let _ = stream.set_write_timeout(t);

    let (head, body) = read_request(&mut stream)?;
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let path = path.split('?').next().unwrap_or("");

    if path != CALLBACK_PATH {
        respond(&mut stream, 404, "text/plain; charset=utf-8", b"not found");
        return None;
    }
    if method == "OPTIONS" {
        respond(&mut stream, 204, "text/plain; charset=utf-8", b"");
        return None;
    }
    if method != "POST" {
        // A direct browser hit (reload, hand-typed URL). Render something
        // neutral; the real hand-off is always the POST.
        respond(&mut stream, 200, "text/html; charset=utf-8", page(true, START_IN_APP).as_bytes());
        return None;
    }

    // Defence in depth on top of the CSRF state: a cross-origin form-POST
    // navigation always carries an `Origin`, so if one is present it must be the
    // SCC website. A missing header is NOT rejected — the state handshake is the
    // real gate, and refusing on absence would break the flow on any browser that
    // omits it (the data-uploader's loopback accepts it the same way).
    if let Some(origin) = header(&head, "origin") {
        if origin != WEB_BASE {
            respond(&mut stream, 403, "text/html; charset=utf-8", page(false, BAD_ORIGIN).as_bytes());
            log::line(&format!("auth: hand-off from an unexpected origin ({origin}) — rejected"));
            return None;
        }
    }

    let fields = parse_form(&body);
    let got_state = field(&fields, "state");
    if got_state != state {
        respond(&mut stream, 400, "text/html; charset=utf-8", page(false, CSRF_MISMATCH).as_bytes());
        log::line("auth: CSRF state mismatch — hand-off rejected");
        return None;
    }
    let token = field(&fields, "token");
    if token.is_empty() {
        respond(&mut stream, 400, "text/html; charset=utf-8", page(false, NO_TOKEN).as_bytes());
        log::line("auth: hand-off carried no token");
        return None;
    }

    respond(&mut stream, 200, "text/html; charset=utf-8", page(true, CONNECTED).as_bytes());
    log::line("auth: website hand-off accepted");
    Some(Session {
        access_token: token.to_string(),
        refresh_token: field(&fields, "refresh_token").to_string(),
        expires_at: field(&fields, "expires_at").parse::<i64>().unwrap_or(0),
        email: field(&fields, "email").to_string(),
    })
}

/// Read headers, then exactly `Content-Length` body bytes.
fn read_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut head_end: Option<usize> = None;
    while head_end.is_none() {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None; // client closed before sending a complete head
        }
        buf.extend_from_slice(&chunk[..n]);
        head_end = find(&buf, b"\r\n\r\n").map(|i| i + 4);
        if buf.len() > MAX_REQUEST_BYTES {
            return None;
        }
    }
    let head_end = head_end?;
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let want = content_length(&head).unwrap_or(0).min(MAX_REQUEST_BYTES);
    while buf.len() - head_end < want {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST_BYTES {
            return None;
        }
    }
    let end = (head_end + want).min(buf.len());
    let body = String::from_utf8_lossy(&buf[head_end..end]).into_owned();
    Some((head, body))
}

fn content_length(head: &str) -> Option<usize> {
    header(head, "content-length").and_then(|v| v.parse::<usize>().ok())
}

/// First value of `name` (case-insensitive) in a raw request head, trimmed.
/// `None` for an absent header or an empty value.
fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if !k.trim().eq_ignore_ascii_case(name) {
            return None;
        }
        let v = v.trim();
        if v.is_empty() { None } else { Some(v) }
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

// ---------------- form parsing ----------------

/// Parse an `application/x-www-form-urlencoded` body into `(key, value)` pairs.
fn parse_form(body: &str) -> Vec<(String, String)> {
    body.split('&')
        .filter(|p| !p.is_empty())
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((percent_decode(k), percent_decode(v)))
        })
        .collect()
}

fn field<'a>(fields: &'a [(String, String)], key: &str) -> &'a str {
    fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).unwrap_or("")
}

/// Decode `%XX` / `+`. Works on raw bytes, never on `&str` slices: a `%` may be
/// followed by the middle of a multi-byte UTF-8 character, and slicing there
/// would panic.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(b' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            match (hex_nibble(bytes[i + 1]), hex_nibble(bytes[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi << 4 | lo);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Percent-encode everything outside the RFC 3986 unreserved set — enough for
/// the loopback URL we pass as a query parameter.
fn percent_encode(s: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0x0f) as usize] as char);
        }
    }
    out
}

// ---------------- hand-off pages ----------------

const CONNECTED: (&str, &str) = ("Starscape · Verbunden", "Du kannst dieses Fenster schließen.");
const START_IN_APP: (&str, &str) =
    ("Starscape", "Bitte die Anmeldung über das Starscape-Traymenü starten.");
const CSRF_MISMATCH: (&str, &str) = ("Starscape · Fehler", "CSRF-Mismatch — versuch es erneut.");
const NO_TOKEN: (&str, &str) = ("Starscape · Fehler", "Kein Token erhalten.");
const BAD_ORIGIN: (&str, &str) =
    ("Starscape · Fehler", "Unerwartete Herkunft — Anmeldung abgelehnt.");

/// The SCC-styled hand-off page, matching the uploader's `renderPage`.
fn page(ok: bool, text: (&str, &str)) -> String {
    let accent = if ok { "#00d4ff" } else { "#f87171" };
    let (title, body) = text;
    format!(
        "<!doctype html>\n<html lang=\"de\"><head><meta charset=\"utf-8\"><title>{title}</title>\n\
         <style>\n\
         body{{margin:0;background:#050810;color:#e8eef9;font-family:Inter,'Segoe UI',sans-serif;\
         display:grid;place-items:center;min-height:100vh}}\n\
         .card{{background:#11182b;border:1px solid {accent}33;padding:40px;border-radius:12px;\
         text-align:center;max-width:420px;box-shadow:0 0 32px {accent}33}}\n\
         h1{{font-family:Orbitron,sans-serif;color:{accent};margin:0 0 12px;letter-spacing:.04em}}\n\
         p{{margin:0;color:#b8c3d9;line-height:1.5}}\n\
         </style></head><body>\n\
         <div class=\"card\"><h1>{title}</h1><p>{body}</p></div>\n\
         </body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_body_is_decoded() {
        let body = "state=abc123&token=ey.J+w%2Ft&email=a%40b.c&expires_at=1790000000";
        let f = parse_form(body);
        assert_eq!(field(&f, "state"), "abc123");
        assert_eq!(field(&f, "token"), "ey.J w/t");
        assert_eq!(field(&f, "email"), "a@b.c");
        assert_eq!(field(&f, "expires_at"), "1790000000");
        assert_eq!(field(&f, "refresh_token"), "");
    }

    #[test]
    fn malformed_pairs_are_skipped_not_panicking() {
        let f = parse_form("&novalue&k=v&=empty&trailing%");
        assert_eq!(field(&f, "k"), "v");
        assert_eq!(field(&f, "novalue"), "");
    }

    #[test]
    fn loopback_url_is_encoded_for_a_query_param() {
        assert_eq!(
            percent_encode("http://127.0.0.1:46900/scc/callback"),
            "http%3A%2F%2F127.0.0.1%3A46900%2Fscc%2Fcallback"
        );
    }

    #[test]
    fn percent_roundtrip() {
        let raw = "a b/c?d=e&f%g";
        assert_eq!(percent_decode(&percent_encode(raw)), raw);
    }

    #[test]
    fn content_length_is_case_insensitive() {
        let head = "POST /scc/callback HTTP/1.1\r\nHost: x\r\ncontent-length: 42\r\n\r\n";
        assert_eq!(content_length(head), Some(42));
        assert_eq!(content_length("GET / HTTP/1.1\r\n\r\n"), None);
    }

    #[test]
    fn origin_is_read_case_insensitively_and_never_from_the_request_line() {
        let head = "POST /scc/callback HTTP/1.1\r\nHost: x\r\nOrigin: https://sc-companion.vercel.app\r\n\r\n";
        assert_eq!(header(head, "origin"), Some(WEB_BASE));
        assert_eq!(header(head, "referer"), None);
        // An empty value must not read as "present" — that would reject the POST.
        assert_eq!(header("POST / HTTP/1.1\r\nOrigin:  \r\n\r\n", "origin"), None);
        // A path that looks like a header must never be mistaken for one.
        assert_eq!(header("POST /origin: evil HTTP/1.1\r\nHost: x\r\n\r\n", "origin"), None);
    }

    #[test]
    fn find_locates_the_header_terminator() {
        assert_eq!(find(b"ab\r\n\r\ncd", b"\r\n\r\n"), Some(2));
        assert_eq!(find(b"abcd", b"\r\n\r\n"), None);
    }
}
