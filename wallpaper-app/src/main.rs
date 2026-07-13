//! Starscape Wallpaper — a tiny native Windows tray app that rotates the desktop
//! background through the Star Citizen Companion "Starscape" gallery (original-
//! resolution RSI news art), with an optional crossfade and one-click autostart.
//!
//! Design goals: no window, tiny RAM (native, no runtime), no settings required.
//! A background thread prefetches the next few images to disk so a switch never
//! stalls on a download.

#![windows_subsystem = "windows"]

mod gfx;
mod net;
mod util;

use std::collections::VecDeque;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GetCursorPos, GetMessageW, PostMessageW, PostQuitMessage, RegisterClassW,
    SetForegroundWindow, SetTimer, TrackPopupMenu, TranslateMessage, HICON, MF_CHECKED,
    MF_SEPARATOR, MF_STRING, MSG, TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_APP, WM_DESTROY,
    WM_LBUTTONDBLCLK, WM_RBUTTONUP, WM_TIMER, WNDCLASSW, WS_OVERLAPPED,
};

use util::Config;

// ---- messages / ids ----
const WM_TRAY: u32 = WM_APP + 1;
const WM_IMG_READY: u32 = WM_APP + 2;
const TIMER_ROTATE: usize = 1;
const TRAY_UID: u32 = 1;

const ID_NEXT: usize = 1;
const ID_PAUSE: usize = 2;
const ID_FADE: usize = 3;
const ID_AUTOSTART: usize = 4;
const ID_STARSCAPE: usize = 5;
const ID_QUIT: usize = 6;

const STARSCAPE_URL: &str = "https://sc-companion.vercel.app/starscape";

struct Ui {
    cfg: Config,
    shown: bool,
}

static UI: OnceLock<Mutex<Ui>> = OnceLock::new();
static QUEUE: OnceLock<Arc<Mutex<VecDeque<PathBuf>>>> = OnceLock::new();

fn ui() -> &'static Mutex<Ui> {
    UI.get().expect("UI not initialised")
}
fn queue() -> &'static Arc<Mutex<VecDeque<PathBuf>>> {
    QUEUE.get().expect("QUEUE not initialised")
}

/// Pick a localized label (DE for German UI language, EN otherwise).
fn t(de: &str, en: &str) -> String {
    let lang = (unsafe { GetUserDefaultUILanguage() } as u32) & 0x3ff;
    if lang == 0x07 { de } else { en }.to_string()
}

fn main() {
    // One instance only (autostart + a manual launch must not double up).
    if util::acquire_single_instance().is_none() {
        return;
    }
    let token = gfx::startup();
    util::set_fill_style();
    let cfg = Config::load();

    QUEUE.get_or_init(|| Arc::new(Mutex::new(VecDeque::new())));

    unsafe { run(cfg) };
    gfx::shutdown(token);
}

unsafe fn run(cfg: Config) {
    let hinst = GetModuleHandleW(std::ptr::null());
    let class_name = util::wide("SccWallpaperMain");

    let mut wc: WNDCLASSW = std::mem::zeroed();
    wc.lpfnWndProc = Some(wndproc);
    wc.hInstance = hinst;
    wc.lpszClassName = class_name.as_ptr();
    RegisterClassW(&wc);

    // A normal but never-shown window: hosts the tray icon, timer and messages.
    let title = util::wide("Starscape Wallpaper");
    let hwnd = CreateWindowExW(
        0,
        class_name.as_ptr(),
        title.as_ptr(),
        WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        hinst,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        return;
    }

    let hicon = gfx::load_tray_icon();
    UI.get_or_init(|| Mutex::new(Ui { cfg, shown: false }));

    add_tray_icon(hwnd, hicon);
    SetTimer(hwnd, TIMER_ROTATE, cfg.interval_min * 60_000, None);

    // Background prefetch thread.
    let hwnd_isize = hwnd as isize;
    let q = Arc::clone(queue());
    std::thread::spawn(move || prefetch_loop(hwnd_isize, q));

    // Message loop.
    let mut msg: MSG = std::mem::zeroed();
    while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

unsafe fn add_tray_icon(hwnd: HWND, hicon: HICON) {
    let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = TRAY_UID;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_TRAY;
    nid.hIcon = hicon;
    let tip: Vec<u16> = "Starscape Wallpaper".encode_utf16().collect();
    for (i, ch) in tip.iter().enumerate().take(nid.szTip.len() - 1) {
        nid.szTip[i] = *ch;
    }
    Shell_NotifyIconW(NIM_ADD, &nid);
}

unsafe fn remove_tray_icon(hwnd: HWND) {
    let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = TRAY_UID;
    Shell_NotifyIconW(NIM_DELETE, &nid);
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TRAY => {
                let event = (lp as u32) & 0xFFFF;
                if event == WM_RBUTTONUP {
                    show_menu(hwnd);
                } else if event == WM_LBUTTONDBLCLK {
                    apply_next();
                }
                0
            }
            WM_IMG_READY => {
                let need = !ui().lock().unwrap().shown;
                if need {
                    apply_next();
                }
                0
            }
            WM_TIMER => {
                if wp == TIMER_ROTATE {
                    let paused = ui().lock().unwrap().cfg.paused;
                    if !paused {
                        apply_next();
                    }
                }
                0
            }
            WM_DESTROY => {
                remove_tray_icon(hwnd);
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

/// Pop the next ready image and apply it (crossfade if enabled).
fn apply_next() {
    let path = queue().lock().unwrap().pop_front();
    let Some(path) = path else { return };
    let fade = {
        let mut u = ui().lock().unwrap();
        u.shown = true;
        u.cfg.fade
    };
    gfx::crossfade_set(&path, fade);
}

unsafe fn show_menu(hwnd: HWND) {
    let (paused, fade) = {
        let u = ui().lock().unwrap();
        (u.cfg.paused, u.cfg.fade)
    };
    let autostart = util::autostart_enabled();

    let menu = CreatePopupMenu();
    let l_next = util::wide(&t("Nächstes Wallpaper", "Next wallpaper"));
    let l_pause = util::wide(&t("Pausiert", "Paused"));
    let l_fade = util::wide(&t("Übergangseffekt", "Fade transition"));
    let l_auto = util::wide(&t("Mit Windows starten", "Start with Windows"));
    let l_star = util::wide(&t("Starscape öffnen", "Open Starscape"));
    let l_quit = util::wide(&t("Beenden", "Quit"));

    let chk = |on: bool| MF_STRING | if on { MF_CHECKED } else { 0 };
    AppendMenuW(menu, MF_STRING, ID_NEXT, l_next.as_ptr());
    AppendMenuW(menu, chk(paused), ID_PAUSE, l_pause.as_ptr());
    AppendMenuW(menu, chk(fade), ID_FADE, l_fade.as_ptr());
    AppendMenuW(menu, chk(autostart), ID_AUTOSTART, l_auto.as_ptr());
    AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    AppendMenuW(menu, MF_STRING, ID_STARSCAPE, l_star.as_ptr());
    AppendMenuW(menu, MF_STRING, ID_QUIT, l_quit.as_ptr());

    let mut pt: POINT = std::mem::zeroed();
    GetCursorPos(&mut pt);
    SetForegroundWindow(hwnd); // required so the menu closes on click-away
    let cmd = TrackPopupMenu(
        menu,
        TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
        pt.x,
        pt.y,
        0,
        hwnd,
        std::ptr::null(),
    );
    DestroyMenu(menu);
    PostMessageW(hwnd, 0 /* WM_NULL */, 0, 0);

    match cmd as usize {
        ID_NEXT => apply_next(),
        ID_PAUSE => toggle(|c| c.paused = !c.paused),
        ID_FADE => toggle(|c| c.fade = !c.fade),
        ID_AUTOSTART => {
            util::set_autostart(!autostart);
        }
        ID_STARSCAPE => util::open_url(STARSCAPE_URL),
        ID_QUIT => {
            DestroyWindow(hwnd);
        }
        _ => {}
    }
}

fn toggle(f: impl FnOnce(&mut Config)) {
    let mut u = ui().lock().unwrap();
    f(&mut u.cfg);
    u.cfg.save();
}

/// Background: fetch the list once, then keep ~3 images ready on disk.
fn prefetch_loop(hwnd_isize: isize, q: Arc<Mutex<VecDeque<PathBuf>>>) {
    let cache = util::cache_dir();
    let mut urls: Vec<String> = Vec::new();
    let mut idx: usize = 0;
    let mut counter: u64 = 0;

    loop {
        if urls.is_empty() {
            urls = net::fetch_wallpaper_urls();
            if urls.is_empty() {
                std::thread::sleep(std::time::Duration::from_secs(15));
                continue;
            }
        }

        let ready = q.lock().unwrap().len();
        if ready < 3 {
            let url = urls[idx % urls.len()].clone();
            idx += 1;
            let ext = if url.to_lowercase().ends_with(".png") { "png" } else { "jpg" };
            let dest = cache.join(format!("wp_{counter}.{ext}"));
            counter += 1;
            if net::download_image(&url, &dest) {
                q.lock().unwrap().push_back(dest);
                unsafe {
                    PostMessageW(hwnd_isize as *mut c_void, WM_IMG_READY, 0, 0);
                }
                prune_cache(&cache, 8);
            } else {
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        } else {
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    }
}

/// Keep only the newest `keep` files in the cache dir.
fn prune_cache(dir: &std::path::Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, e.path()))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    for (_, p) in files.iter().take(files.len() - keep) {
        let _ = std::fs::remove_file(p);
    }
}
