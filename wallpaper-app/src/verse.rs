//! "Meine Sternbilder" — the signed-in user's earned Verse constellations.
//!
//! One authenticated call, `rpc/verse_explorer_state()`, answers everything the
//! app needs: per patch the star count, the sun (comet hit), the server's
//! `unlocks.wallpaper` verdict (7 stars) and the constellation's seven points
//! (precomputed by the Data Uploader into `verse_constellations`), plus the
//! streak rewards. The thresholds live on the server only — this module never
//! re-derives "is this a wallpaper", it reads the flag.
//!
//! Everything here except [`fetch_state`] and the settings file is pure and
//! unit-tested: the JSON shape, the "last 7 patches" selection and the LIVE-day
//! check.

use std::fs;
use std::path::PathBuf;

use crate::log;
use crate::net;
use crate::util;

/// The app shows at most the last seven patches; the website keeps the full log.
pub const APP_MAX_PATCHES: usize = 7;

const EXPLORER_PATH: &str = "/rest/v1/rpc/verse_explorer_state";

/// Settings value for the generated supernova wallpaper (not a patch line).
pub const SUPERNOVA_KEY: &str = "supernova";

#[derive(Clone, Debug, PartialEq)]
pub struct Patch {
    /// `major.minor`, e.g. `4.3`.
    pub line: String,
    /// `yyyymmdd` (UTC date of `live_at`), 0 when the patch has no LIVE date yet.
    pub live_day: u32,
    pub star_count: u32,
    pub sun: bool,
    /// Server verdict `unlocks.wallpaper` (7 stars).
    pub wallpaper: bool,
    /// Seven normalised points (0..1, y down), when the uploader shipped one.
    pub points: Option<[(f64, f64); 7]>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rewards {
    pub road: bool,
    pub nebula: bool,
    pub live: bool,
    pub meteor: bool,
    pub supernova: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct State {
    /// Newest first, as the RPC returns them.
    pub patches: Vec<Patch>,
    pub rewards: Rewards,
    pub streak_best: u32,
}

impl State {
    /// The wallpapers the app offers: patches the server unlocked AND that carry
    /// a constellation shape, newest first, capped at [`APP_MAX_PATCHES`].
    pub fn app_wallpapers(&self) -> Vec<&Patch> {
        self.patches
            .iter()
            .filter(|p| p.wallpaper && p.points.is_some())
            .take(APP_MAX_PATCHES)
            .collect()
    }

    /// The newest patch whose LIVE day is `today` (`yyyymmdd`) and that has a
    /// shape to draw — the meteor shower's stage. `None` on every other day.
    pub fn live_day_patch(&self, today: u32) -> Option<&Patch> {
        if today == 0 {
            return None;
        }
        self.patches.iter().find(|p| p.live_day == today && p.points.is_some())
    }

}

// ---------------- Network ----------------

/// Call `verse_explorer_state()` as the signed-in user. `None` when signed out
/// (the RPC is `authenticated`-only and returns `null` without a user), on a
/// transport failure or a non-200 — the caller keeps whatever it had.
pub fn fetch_state(access_token: &str) -> Option<State> {
    let headers = vec![
        format!("apikey: {}", net::API_KEY),
        format!("Authorization: Bearer {access_token}"),
        "Accept: application/json".to_string(),
        "Content-Type: application/json".to_string(),
    ];
    let (status, body) =
        net::https_text("POST", net::API_HOST, EXPLORER_PATH, &headers, Some(b"{}"))?;
    if status != 200 {
        log::line(&format!("verse: HTTP {status} from verse_explorer_state"));
        return None;
    }
    let state = parse_state(&body);
    if state.is_none() {
        log::line("verse: explorer payload not understood (null or unexpected shape)");
    }
    state
}

// ---------------- Parsing ----------------

pub fn parse_state(json: &str) -> Option<State> {
    let root = Json::parse(json)?;
    let patches = root.get("patches")?.as_arr()?;
    let mut out = State::default();
    for p in patches {
        let Some(line) = p.get("patch_line").and_then(Json::as_str) else { continue };
        let live_day = p.get("live_at").and_then(Json::as_str).map(iso_day).unwrap_or(0);
        let unlocks = p.get("unlocks");
        let points = p
            .get("constellation")
            .and_then(|c| c.get("points"))
            .and_then(Json::as_arr)
            .and_then(|pts| {
                if pts.len() != 7 {
                    return None;
                }
                let mut arr = [(0f64, 0f64); 7];
                for (i, pt) in pts.iter().enumerate() {
                    let xy = pt.as_arr()?;
                    let x = xy.first()?.as_f64()?;
                    let y = xy.get(1)?.as_f64()?;
                    arr[i] = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
                }
                Some(arr)
            });
        out.patches.push(Patch {
            line: line.to_string(),
            live_day,
            star_count: p.get("star_count").and_then(Json::as_f64).unwrap_or(0.0) as u32,
            sun: p.get("sun").and_then(Json::as_bool).unwrap_or(false),
            wallpaper: unlocks
                .and_then(|u| u.get("wallpaper"))
                .and_then(Json::as_bool)
                .unwrap_or(false),
            points,
        });
    }
    if let Some(r) = root.get("rewards") {
        let flag = |k: &str| r.get(k).and_then(Json::as_bool).unwrap_or(false);
        out.rewards = Rewards {
            road: flag("road"),
            nebula: flag("nebula"),
            live: flag("live"),
            meteor: flag("meteor"),
            supernova: flag("supernova"),
        };
    }
    out.streak_best = root
        .get("streak")
        .and_then(|s| s.get("best"))
        .and_then(Json::as_f64)
        .unwrap_or(0.0) as u32;
    Some(out)
}

/// `2026-10-08T17:00:00+00:00` → `20261008`; 0 when it is not a date.
pub fn iso_day(s: &str) -> u32 {
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return 0;
    }
    let num = |r: std::ops::Range<usize>| s.get(r).and_then(|t| t.parse::<u32>().ok());
    match (num(0..4), num(5..7), num(8..10)) {
        (Some(y), Some(m), Some(d)) if (1..=12).contains(&m) && (1..=31).contains(&d) => {
            y * 10_000 + m * 100 + d
        }
        _ => 0,
    }
}

/// Minimal JSON value — the explorer payload nests arrays of arrays, which the
/// flat scanners in `net.rs` cannot walk. Small enough to not matter for size.
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn parse(s: &str) -> Option<Json> {
        let mut p = Parser { b: s.as_bytes(), i: 0, depth: 0 };
        let v = p.value()?;
        p.ws();
        (p.i == p.b.len()).then_some(v)
    }
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(kv) => kv.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&Vec<Json>> {
        if let Json::Arr(a) = self { Some(a) } else { None }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let Json::Str(s) = self { Some(s) } else { None }
    }
    pub fn as_f64(&self) -> Option<f64> {
        if let Json::Num(n) = self { Some(*n) } else { None }
    }
    pub fn as_bool(&self) -> Option<bool> {
        if let Json::Bool(b) = self { Some(*b) } else { None }
    }
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
    depth: u32,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn lit(&mut self, word: &str, v: Json) -> Option<Json> {
        if self.b[self.i..].starts_with(word.as_bytes()) {
            self.i += word.len();
            Some(v)
        } else {
            None
        }
    }
    fn value(&mut self) -> Option<Json> {
        self.ws();
        let c = *self.b.get(self.i)?;
        match c {
            b'n' => self.lit("null", Json::Null),
            b't' => self.lit("true", Json::Bool(true)),
            b'f' => self.lit("false", Json::Bool(false)),
            b'"' => self.string().map(Json::Str),
            b'[' | b'{' => {
                self.depth += 1;
                if self.depth > 32 {
                    return None;
                }
                let v = if c == b'[' { self.array() } else { self.object() };
                self.depth -= 1;
                v
            }
            _ => self.number(),
        }
    }
    fn number(&mut self) -> Option<Json> {
        let start = self.i;
        while self.i < self.b.len()
            && matches!(self.b[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
        {
            self.i += 1;
        }
        std::str::from_utf8(&self.b[start..self.i]).ok()?.parse::<f64>().ok().map(Json::Num)
    }
    fn string(&mut self) -> Option<String> {
        self.i += 1; // opening quote
        let mut out = String::new();
        loop {
            let c = *self.b.get(self.i)?;
            self.i += 1;
            match c {
                b'"' => return Some(out),
                b'\\' => {
                    let e = *self.b.get(self.i)?;
                    self.i += 1;
                    match e {
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'b' | b'f' => {}
                        b'u' => {
                            let hex = std::str::from_utf8(self.b.get(self.i..self.i + 4)?).ok()?;
                            self.i += 4;
                            let cp = u32::from_str_radix(hex, 16).ok()?;
                            out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                        }
                        other => out.push(other as char),
                    }
                }
                _ => {
                    // Copy the full UTF-8 sequence starting at this byte.
                    let start = self.i - 1;
                    let len = match c {
                        0x00..=0x7F => 1,
                        0xC0..=0xDF => 2,
                        0xE0..=0xEF => 3,
                        _ => 4,
                    };
                    let end = (start + len).min(self.b.len());
                    out.push_str(&String::from_utf8_lossy(&self.b[start..end]));
                    self.i = end;
                }
            }
        }
    }
    fn array(&mut self) -> Option<Json> {
        self.i += 1;
        let mut out = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            return Some(Json::Arr(out));
        }
        loop {
            out.push(self.value()?);
            self.ws();
            match *self.b.get(self.i)? {
                b',' => self.i += 1,
                b']' => {
                    self.i += 1;
                    return Some(Json::Arr(out));
                }
                _ => return None,
            }
        }
    }
    fn object(&mut self) -> Option<Json> {
        self.i += 1;
        let mut out = Vec::new();
        self.ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Some(Json::Obj(out));
        }
        loop {
            self.ws();
            if self.b.get(self.i) != Some(&b'"') {
                return None;
            }
            let k = self.string()?;
            self.ws();
            if self.b.get(self.i) != Some(&b':') {
                return None;
            }
            self.i += 1;
            let v = self.value()?;
            out.push((k, v));
            self.ws();
            match *self.b.get(self.i)? {
                b',' => self.i += 1,
                b'}' => {
                    self.i += 1;
                    return Some(Json::Obj(out));
                }
                _ => return None,
            }
        }
    }
}

// ---------------- Settings (own file, so `Config` stays `Copy`) ----------------

/// Verse preferences, persisted at `%APPDATA%\StarscapeWallpaper\verse.ini`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settings {
    /// sr-live: animate the pinned constellation (only honoured once unlocked).
    pub live: bool,
    /// sr-meteor: meteor shower on the patch's LIVE day.
    pub meteor: bool,
    /// The pinned constellation: a patch line, [`SUPERNOVA_KEY`], or empty when
    /// the normal gallery rotation runs.
    pub current: String,
    /// `yyyymmdd` the user dismissed the shower on ("Next wallpaper").
    pub meteor_dismissed: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { live: true, meteor: true, current: String::new(), meteor_dismissed: 0 }
    }
}

impl Settings {
    fn path() -> PathBuf {
        util::data_dir().join("verse.ini")
    }

    pub fn load() -> Settings {
        Settings::parse(&fs::read_to_string(Settings::path()).unwrap_or_default())
    }

    pub fn parse(text: &str) -> Settings {
        let mut s = Settings::default();
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            let on = v == "1" || v.eq_ignore_ascii_case("true");
            match k {
                "live" => s.live = on,
                "meteor" => s.meteor = on,
                "current" if v.len() <= 32 => s.current = v.to_string(),
                "meteor_dismissed" => s.meteor_dismissed = v.parse().unwrap_or(0),
                _ => {}
            }
        }
        s
    }

    pub fn save(&self) {
        let text = format!(
            "live={}\nmeteor={}\ncurrent={}\nmeteor_dismissed={}\n",
            self.live as u8, self.meteor as u8, self.current, self.meteor_dismissed
        );
        let _ = fs::write(Settings::path(), text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch_json(line: &str, stars: u32, wallpaper: bool, with_points: bool, live: &str) -> String {
        let c = if with_points {
            r#"{"class_name":"X","kind":"ship","points":[[0.1,0.2],[0.3,0.1],[0.5,0.15],[0.7,0.3],[0.6,0.6],[0.4,0.8],[0.2,0.5]]}"#
        } else {
            "null"
        };
        format!(
            r#"{{"patch_line":"{line}","live_at":{live},"stars":[],"star_count":{stars},"sun":{},"offered":["notes"],"constellation":{c},"unlocks":{{"log_entry":true,"community":false,"wallpaper":{wallpaper}}}}}"#,
            stars >= 7
        )
    }

    fn state_json(patches: &[String]) -> String {
        format!(
            r#"{{"patches":[{}],"total_stars":10,"suns":["4.1"],"streak":{{"current":6,"best":6,"reserve_available":true,"reserves_used":0}},"kartograph":{{"unlocked":true,"rank":2}},"rewards":{{"road":true,"nebula":true,"live":true,"reserve":true,"meteor":true,"supernova":false,"sun_collection":true}}}}"#,
            patches.join(",")
        )
    }

    #[test]
    fn parses_explorer_payload() {
        let json = state_json(&[patch_json("4.3", 7, true, true, "\"2026-10-08T17:00:00+00:00\"")]);
        let s = parse_state(&json).expect("parses");
        assert_eq!(s.patches.len(), 1);
        let p = &s.patches[0];
        assert_eq!(p.line, "4.3");
        assert_eq!(p.live_day, 20261008);
        assert_eq!(p.star_count, 7);
        assert!(p.sun && p.wallpaper);
        assert_eq!(p.points.unwrap()[0], (0.1, 0.2));
        assert!(s.rewards.live && s.rewards.meteor && !s.rewards.supernova);
        assert_eq!(s.streak_best, 6);
    }

    #[test]
    fn null_payload_is_none() {
        assert_eq!(parse_state("null"), None);
        assert_eq!(parse_state(""), None);
        assert_eq!(parse_state("{\"patches\":[}"), None);
    }

    #[test]
    fn app_shows_only_unlocked_shaped_and_at_most_seven() {
        let mut ps = Vec::new();
        for i in (0..12).rev() {
            // 4.11 newest … 4.0 oldest; 4.9 lacks a shape, 4.8 is not unlocked.
            let line = format!("4.{i}");
            let shaped = i != 9;
            let unlocked = i != 8;
            ps.push(patch_json(&line, if unlocked { 7 } else { 3 }, unlocked, shaped, "null"));
        }
        let s = parse_state(&state_json(&ps)).unwrap();
        let lines: Vec<&str> = s.app_wallpapers().iter().map(|p| p.line.as_str()).collect();
        assert_eq!(lines, vec!["4.11", "4.10", "4.7", "4.6", "4.5", "4.4", "4.3"]);
        assert_eq!(lines.len(), APP_MAX_PATCHES);
    }

    #[test]
    fn live_day_needs_matching_date_and_shape() {
        let s = parse_state(&state_json(&[
            patch_json("4.4", 1, false, false, "\"2026-10-08T17:00:00Z\""),
            patch_json("4.3", 7, true, true, "\"2026-09-01T17:00:00Z\""),
        ]))
        .unwrap();
        assert_eq!(s.live_day_patch(20261008), None, "4.4 has no shape yet");
        assert_eq!(s.live_day_patch(20260901).map(|p| p.line.as_str()), Some("4.3"));
        assert_eq!(s.live_day_patch(0), None);
    }

    #[test]
    fn iso_day_rejects_garbage() {
        assert_eq!(iso_day("2026-02-03"), 20260203);
        assert_eq!(iso_day("2026-13-03"), 0);
        assert_eq!(iso_day("soon"), 0);
    }

    #[test]
    fn json_handles_escapes_and_unicode() {
        let v = Json::parse(r#"{"a":"x\"yä","b":[1,-2.5e1,true,null],"c":"Ünï"}"#).unwrap();
        assert_eq!(v.get("a").unwrap().as_str(), Some("x\"yä"));
        assert_eq!(v.get("b").unwrap().as_arr().unwrap()[1].as_f64(), Some(-25.0));
        assert_eq!(v.get("c").unwrap().as_str(), Some("Ünï"));
    }

    #[test]
    fn settings_roundtrip_defaults() {
        let s = Settings::parse("live=0\ncurrent=4.3\nmeteor_dismissed=20261008\njunk");
        assert!(!s.live && s.meteor);
        assert_eq!(s.current, "4.3");
        assert_eq!(s.meteor_dismissed, 20261008);
        assert_eq!(Settings::parse(""), Settings::default());
    }
}
