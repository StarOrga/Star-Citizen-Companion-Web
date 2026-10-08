//! "Meine Sternbilder" in the tray: glue between the explorer data
//! ([`crate::verse`]), the native renderer ([`crate::starmap`]) and the
//! animation layer ([`crate::live`]).
//!
//! Flow: a background thread asks `verse_explorer_state()` as the signed-in
//! user (25 s after start, after a sign-in, then every 3 h) and posts
//! [`WM_VERSE_READY`]. Picking a constellation in the tray *pins* it: a worker
//! thread renders it at the monitor's physical resolution (up to 4K), writes a
//! BMP to the cache and posts [`WM_VERSE_RENDERED`]; the UI thread crossfades
//! it in and — when sr-live is unlocked and on — starts the animation. While a
//! constellation is pinned the gallery rotation stands still; "Next wallpaper"
//! or picking an image selection unpins it.
//!
//! sr-meteor: on the LIVE day of a patch (the local calendar day containing `live_at`)
//! the desktop switches to that patch's constellation with the meteor shower,
//! until midnight or until the user clicks "Next wallpaper".

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, PostMessageW, HMENU, MF_CHECKED, MF_GRAYED, MF_SEPARATOR,
    MF_STRING, WM_APP,
};

use crate::live::{self, Scene};
use crate::log;
use crate::session;
use crate::starmap::{self, Layout, RenderConstellation, RenderOptions};
use crate::util::{self, t, wide};
use crate::verse::{self, Settings, State, SUPERNOVA_KEY};

pub const WM_VERSE_READY: u32 = WM_APP + 6;
pub const WM_VERSE_RENDERED: u32 = WM_APP + 7;

const FIRST_FETCH_SECS: u64 = 25;
const REFRESH_SECS: u64 = 3 * 60 * 60;

const ID_BASE: usize = 40; // 40..=46 = the last seven patches
const ID_SUPERNOVA: usize = 47;
const ID_LIVE: usize = 48;
const ID_METEOR: usize = 49;
const ID_WEB: usize = 50;

pub const WEB_URL: &str = "https://sc-companion.vercel.app/verse/gallery";

static STATE: Mutex<Option<State>> = Mutex::new(None);
static SETTINGS: OnceLock<Mutex<Settings>> = OnceLock::new();
/// Lines shown in the last menu, index-aligned with ID_BASE.. .
static MENU_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// `yyyymmdd` of a running meteor shower.
static METEOR_DAY: Mutex<u32> = Mutex::new(0);

fn settings() -> &'static Mutex<Settings> {
    SETTINGS.get_or_init(|| Mutex::new(Settings::load()))
}

/// What a finished render hands to the UI thread.
pub struct Rendered {
    path: PathBuf,
    scene: Option<Scene>,
    base: Vec<u32>,
    w: i32,
    h: i32,
    layout: Layout,
    seed: String,
}

// ---------------- Data ----------------

pub fn spawn_fetch_loop(hwnd: isize) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(FIRST_FETCH_SECS));
        loop {
            fetch_once(hwnd);
            std::thread::sleep(Duration::from_secs(REFRESH_SECS));
        }
    });
}

pub fn refresh_now(hwnd: isize) {
    std::thread::spawn(move || fetch_once(hwnd));
}

fn fetch_once(hwnd: isize) {
    let Some(token) = session::ensure_access_token() else { return };
    if let Some(state) = verse::fetch_state(&token) {
        log::line(&format!(
            "verse: {} patch(es), {} wallpaper(s), best streak {}",
            state.patches.len(),
            state.app_wallpapers().len(),
            state.streak_best
        ));
        *STATE.lock().unwrap() = Some(state);
        unsafe { PostMessageW(hwnd as _, WM_VERSE_READY, 0, 0) };
    }
}

pub fn on_sign_out() {
    *STATE.lock().unwrap() = None;
    live::stop();
    let mut s = settings().lock().unwrap();
    s.current.clear();
    s.save();
}

/// True while a constellation owns the desktop — the gallery rotation and the
/// first-image bootstrap stand down.
pub fn holds_desktop() -> bool {
    !settings().lock().unwrap().current.is_empty() || live::active_scene() == Some(Scene::Meteor)
}

/// A gallery image is about to be applied by the user: unpin, stop animating,
/// and dismiss today's shower.
pub fn release_for_gallery() {
    if live::active_scene() == Some(Scene::Meteor) {
        let mut s = settings().lock().unwrap();
        s.meteor_dismissed = util::today_yyyymmdd();
        s.save();
        *METEOR_DAY.lock().unwrap() = 0;
    }
    live::stop();
    let mut s = settings().lock().unwrap();
    if !s.current.is_empty() {
        s.current.clear();
        s.save();
        log::line("verse: constellation unpinned — gallery rotation resumes");
    }
}

// ---------------- Decisions on fresh data / once a minute ----------------

/// UI thread, after [`WM_VERSE_READY`] and from the minute timer.
pub fn evaluate(hwnd: isize) {
    let today = util::today_yyyymmdd();
    let (meteor_line, rewards) = {
        let st = STATE.lock().unwrap();
        let Some(state) = st.as_ref() else { return };
        (state.live_day_patch(today).map(|p| p.line.clone()), state.rewards)
    };
    let s = settings().lock().unwrap().clone();

    // The shower ended at midnight.
    let running_day = *METEOR_DAY.lock().unwrap();
    if live::active_scene() == Some(Scene::Meteor) && running_day != today {
        live::stop();
        *METEOR_DAY.lock().unwrap() = 0;
    }

    if rewards.meteor && s.meteor && s.meteor_dismissed != today {
        if let Some(line) = meteor_line {
            if live::active_scene() != Some(Scene::Meteor) {
                log::line(&format!("verse: LIVE day of {line} — meteor shower"));
                *METEOR_DAY.lock().unwrap() = today;
                spawn_render(hwnd, line, Some(Scene::Meteor));
            }
            return;
        }
    }

    // Re-establish a pinned constellation (start-up, or after the shower).
    if !s.current.is_empty() && !live::is_active() {
        let animate = rewards.live && s.live;
        static RESTORED: Mutex<bool> = Mutex::new(false);
        let mut restored = RESTORED.lock().unwrap();
        if animate || !*restored {
            *restored = true;
            spawn_render(hwnd, s.current.clone(), animate.then_some(Scene::Live));
        }
    }
}

// ---------------- Rendering ----------------

/// Render options for `key` (a patch line or [`SUPERNOVA_KEY`]). Pure.
pub fn options_for(state: &State, key: &str, w: i32, h: i32) -> Option<RenderOptions> {
    let to_rc = |p: &verse::Patch| RenderConstellation {
        patch_line: p.line.clone(),
        points: p.points.map(|a| a.to_vec()).unwrap_or_default(),
        star_count: p.star_count,
        sun: p.sun,
    };
    let mut list: Vec<RenderConstellation>;
    let seed: String;
    let supernova = key == SUPERNOVA_KEY;
    if supernova {
        let newest = state.patches.first()?.line.clone();
        list = vec![RenderConstellation {
            patch_line: newest.clone(),
            points: starmap::supernova_points(&newest).to_vec(),
            star_count: 7,
            sun: false,
        }];
        list.extend(state.app_wallpapers().into_iter().take(6).map(to_rc));
        seed = format!("supernova:{newest}");
    } else {
        let idx = state.patches.iter().position(|p| p.line == key)?;
        let current = &state.patches[idx];
        current.points?;
        list = vec![to_rc(current)];
        // Older patches the user has a log entry for — the small ones.
        list.extend(
            state.patches[idx + 1..]
                .iter()
                .filter(|p| p.points.is_some() && (p.star_count > 0 || p.sun))
                .take(6)
                .map(to_rc),
        );
        seed = key.to_string();
    }
    Some(RenderOptions {
        width: w,
        height: h,
        seed,
        constellations: list,
        nebula: state.rewards.nebula,
        road: state.rewards.road,
        supernova,
    })
}

fn spawn_render(hwnd: isize, key: String, scene: Option<Scene>) {
    let Some(state) = STATE.lock().unwrap().clone() else { return };
    std::thread::spawn(move || {
        let (pw, ph) = live::physical_screen();
        let (w, h) = starmap::clamp_to_4k(pw, ph);
        let Some(opts) = options_for(&state, &key, w, h) else {
            log::line(&format!("verse: nothing to render for '{key}'"));
            return;
        };
        let started = std::time::Instant::now();
        let (px, layout) = starmap::render(&opts);
        let dir = util::cache_dir();
        // A new file name per pick: Windows caches the wallpaper by path.
        let name = format!("verse-{}-{w}x{h}.bmp", key.replace(['.', ':', '/', '\\'], "_"));
        let path = dir.join(&name);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with("verse-") && n.ends_with(".bmp") && n != name {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        if std::fs::write(&path, starmap::encode_bmp(&px, w, h)).is_err() {
            log::line("verse: could not write the constellation wallpaper");
            return;
        }
        log::line(&format!("verse: rendered '{key}' at {w}x{h} in {} ms", started.elapsed().as_millis()));

        // The animation window spans the screen in physical pixels (the process is
        // DPI aware); reuse the pixels when that is the wallpaper's size (always,
        // up to 4K), otherwise render a second, matching base.
        let (base, lw, lh, layout) = match scene {
            None => (Vec::new(), 0, 0, layout),
            Some(_) => {
                let (lw, lh) = live::window_screen();
                if (lw, lh) == (w, h) {
                    (px, w, h, layout)
                } else {
                    let o = RenderOptions { width: lw, height: lh, ..opts.clone() };
                    let (p2, l2) = starmap::render(&o);
                    (p2, lw, lh, l2)
                }
            }
        };
        let r = Box::new(Rendered { path, scene, base, w: lw, h: lh, layout, seed: opts.seed.clone() });
        unsafe { PostMessageW(hwnd as _, WM_VERSE_RENDERED, 0, Box::into_raw(r) as isize) };
    });
}

/// UI thread: apply a finished render.
pub fn on_rendered(lp: isize, fade: bool) {
    if lp == 0 {
        return;
    }
    // SAFETY: produced by Box::into_raw in spawn_render, consumed exactly once.
    let r = unsafe { Box::from_raw(lp as *mut Rendered) };
    live::stop();
    crate::gfx::crossfade_set(&r.path, fade);
    if let Some(scene) = r.scene {
        live::start(r.base, r.w, r.h, r.layout, scene, &r.seed);
    }
}

// ---------------- Tray ----------------

/// Build the "Meine Sternbilder" submenu.
pub unsafe fn build_menu(signed_in: bool) -> (HMENU, Vec<Vec<u16>>) {
    let menu = CreatePopupMenu();
    let mut keep: Vec<Vec<u16>> = Vec::new();
    let add = |flags: u32, id: usize, label: String, keep: &mut Vec<Vec<u16>>| {
        let w = wide(&label);
        AppendMenuW(menu, flags, id, w.as_ptr());
        keep.push(w);
    };
    let chk = |on: bool| MF_STRING | if on { MF_CHECKED } else { 0 };
    let s = settings().lock().unwrap().clone();
    let st = STATE.lock().unwrap();
    let mut lines = MENU_LINES.lock().unwrap();
    lines.clear();

    match (signed_in, st.as_ref()) {
        (false, _) => add(
            MF_STRING | MF_GRAYED,
            0,
            t("Anmelden, um deine Sternbilder zu sehen", "Sign in to see your constellations"),
            &mut keep,
        ),
        (true, None) => add(MF_STRING | MF_GRAYED, 0, t("Sternbilder werden geladen…", "Loading constellations…"), &mut keep),
        (true, Some(state)) => {
            let walls = state.app_wallpapers();
            if walls.is_empty() {
                add(
                    MF_STRING | MF_GRAYED,
                    0,
                    t("Noch kein Sternbild — sammle 7 Sterne in einem Patch", "No constellation yet — collect 7 stars in a patch"),
                    &mut keep,
                );
            }
            for (i, p) in walls.iter().enumerate() {
                let sun = if p.sun { t(" · mit Sonne", " · with sun") } else { String::new() };
                add(chk(s.current == p.line), ID_BASE + i, format!("Patch {}{sun}", p.line), &mut keep);
                lines.push(p.line.clone());
            }
            if state.rewards.supernova {
                add(chk(s.current == SUPERNOVA_KEY), ID_SUPERNOVA, t("Supernova (Serie 7)", "Supernova (streak 7)"), &mut keep);
            }
            AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
            let r = state.rewards;
            let live_label = if r.live {
                t("Lebendes Sternbild", "Living constellation")
            } else {
                t("Lebendes Sternbild (ab Serie 4)", "Living constellation (streak 4)")
            };
            add(chk(r.live && s.live) | if r.live { 0 } else { MF_GRAYED }, ID_LIVE, live_label, &mut keep);
            let meteor_label = if r.meteor {
                t("Meteorschauer am LIVE-Tag", "Meteor shower on LIVE day")
            } else {
                t("Meteorschauer am LIVE-Tag (ab Serie 6)", "Meteor shower on LIVE day (streak 6)")
            };
            add(chk(r.meteor && s.meteor) | if r.meteor { 0 } else { MF_GRAYED }, ID_METEOR, meteor_label, &mut keep);
        }
    }
    add(MF_STRING, ID_WEB, t("Alle Sternbilder auf der Website", "All constellations on the website"), &mut keep);
    (menu, keep)
}

/// Handle a tray command; false when `id` is not ours.
pub fn handle_command(hwnd: isize, id: usize) -> bool {
    let rewards = STATE.lock().unwrap().as_ref().map(|s| s.rewards).unwrap_or_default();
    let pick = |key: String| {
        let animate = {
            let mut s = settings().lock().unwrap();
            s.current = key.clone();
            s.save();
            rewards.live && s.live
        };
        log::line(&format!("verse: constellation '{key}' pinned from the tray"));
        spawn_render(hwnd, key, animate.then_some(Scene::Live));
    };
    match id {
        ID_BASE..=46 => {
            let line = MENU_LINES.lock().unwrap().get(id - ID_BASE).cloned();
            if let Some(line) = line {
                pick(line);
            }
        }
        ID_SUPERNOVA => pick(SUPERNOVA_KEY.to_string()),
        ID_LIVE => {
            let (on, current) = {
                let mut s = settings().lock().unwrap();
                s.live = !s.live;
                s.save();
                (s.live, s.current.clone())
            };
            if live::active_scene() == Some(Scene::Live) && !on {
                live::stop();
            } else if on && !current.is_empty() && rewards.live && !live::is_active() {
                spawn_render(hwnd, current, Some(Scene::Live));
            }
        }
        ID_METEOR => {
            let on = {
                let mut s = settings().lock().unwrap();
                s.meteor = !s.meteor;
                s.save();
                s.meteor
            };
            if !on && live::active_scene() == Some(Scene::Meteor) {
                live::stop();
                *METEOR_DAY.lock().unwrap() = 0;
            } else {
                evaluate(hwnd);
            }
        }
        ID_WEB => util::open_url(WEB_URL),
        _ => return false,
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> State {
        let p = |line: &str, stars: u32, wall: bool, sun: bool| verse::Patch {
            line: line.into(),
            live_day: 0,
            star_count: stars,
            sun,
            wallpaper: wall,
            points: Some([(0.5, 0.1), (0.3, 0.4), (0.7, 0.4), (0.1, 0.6), (0.9, 0.6), (0.4, 0.9), (0.6, 0.9)]),
        };
        State {
            patches: vec![p("4.5", 2, false, false), p("4.4", 7, true, true), p("4.3", 0, false, false), p("4.2", 3, false, true)],
            rewards: verse::Rewards { road: true, nebula: false, live: true, meteor: false, supernova: true },
            streak_best: 7,
        }
    }

    #[test]
    fn patch_render_takes_current_then_older_logged() {
        let o = options_for(&state(), "4.4", 320, 180).unwrap();
        let lines: Vec<&str> = o.constellations.iter().map(|c| c.patch_line.as_str()).collect();
        assert_eq!(lines, vec!["4.4", "4.2"], "newer 4.5 and empty 4.3 stay out");
        assert_eq!(o.seed, "4.4");
        assert!(o.road && !o.nebula && !o.supernova);
        assert!(options_for(&state(), "9.9", 320, 180).is_none());
    }

    #[test]
    fn supernova_render_is_generated_and_seeded_by_newest_patch() {
        let o = options_for(&state(), SUPERNOVA_KEY, 320, 180).unwrap();
        assert!(o.supernova);
        assert_eq!(o.seed, "supernova:4.5");
        assert_eq!(o.constellations[0].points, starmap::supernova_points("4.5").to_vec());
        assert_eq!(o.constellations.len(), 2, "supernova + the one 7★ wallpaper");
    }
}
