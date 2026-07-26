//! Starscape Wallpaper — a tiny native Windows tray app that rotates the desktop
//! background through the Star Citizen Companion "Starscape" gallery (original-
//! resolution RSI news art), with an optional crossfade and one-click autostart.
//!
//! Design goals: no window, tiny RAM (native, no runtime), no settings required.
//! A background thread prefetches the next few images to disk so a switch never
//! stalls on a download.

// No console for the app itself; the test harness keeps the console subsystem so
// `cargo test` output is never swallowed.
#![cfg_attr(not(test), windows_subsystem = "windows")]

mod auth;
mod crypto;
mod gfx;
mod log;
mod net;
mod screensaver;
mod session;
mod update;
mod util;

use std::collections::VecDeque;
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows_sys::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics, LoadIconW, MF_GRAYED, MF_POPUP,
    PostMessageW, PostQuitMessage, RegisterClassW, SetForegroundWindow, SetTimer, TrackPopupMenu,
    TranslateMessage, HICON, IDI_APPLICATION, MF_CHECKED, MF_SEPARATOR, MF_STRING, MSG,
    SM_CXSCREEN, SM_CYSCREEN, TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_APP, WM_DESTROY,
    WM_LBUTTONDBLCLK, WM_RBUTTONUP, WM_TIMER, WNDCLASSW, WS_OVERLAPPED,
};

use util::{Channel, Config, Mode};

// ---- messages / ids ----
const WM_TRAY: u32 = WM_APP + 1;
const WM_IMG_READY: u32 = WM_APP + 2;
const WM_SUMMARY_READY: u32 = WM_APP + 3;
/// A verified update was written over the running exe → relaunch into it.
const WM_UPDATE_RESTART: u32 = WM_APP + 4;
/// The website sign-in completed → bring the app forward and open the tray menu.
const WM_UPDATE_FOREGROUND: u32 = WM_APP + 5;
const TIMER_ROTATE: usize = 1;
const TIMER_IDLE: usize = 2;
const IDLE_POLL_MS: u32 = 2_000;
const TRAY_UID: u32 = 1;

/// Let the desktop settle before the first update check — the wallpaper matters
/// more at startup than the version does.
const UPDATE_FIRST_DELAY_SECS: u64 = 20;
/// Re-check cadence. Matches the data-uploader's `UPDATE_POLL_MS` (6 h): a
/// restart-gated native updater need not be as eager as the web app's poll.
const UPDATE_POLL_SECS: u64 = 6 * 60 * 60;

const ID_NEXT: usize = 1;
const ID_PAUSE: usize = 2;
const ID_FADE: usize = 3;
const ID_AUTOSTART: usize = 4;
const ID_STARSCAPE: usize = 5;
const ID_QUIT: usize = 6;
const ID_MODE_WALLPAPER: usize = 7;
const ID_MODE_SCREENSAVER: usize = 8;
const ID_MODE_BOTH: usize = 9;
const ID_DELAY_5: usize = 10;
const ID_DELAY_10: usize = 11;
const ID_DELAY_15: usize = 12;
const ID_DELAY_30: usize = 13;
const ID_DELAY_60: usize = 14;
const ID_SUMMARY_ON_BOOT: usize = 15;
const ID_SUMMARY_NOW: usize = 16;
const ID_UPDATE: usize = 17;

const STARSCAPE_URL: &str = "https://sc-companion.vercel.app/starscape";
/// Filename of the fetched weekly Verse-News summary image inside the cache dir.
const SUMMARY_FILE: &str = "summary.png";

struct Ui {
    cfg: Config,
    shown: bool,
}

static UI: OnceLock<Mutex<Ui>> = OnceLock::new();
static QUEUE: OnceLock<Arc<Mutex<VecDeque<PathBuf>>>> = OnceLock::new();
/// The single-instance mutex handle, kept so a self-update can release it before
/// launching the replacement (the successor would otherwise see the name taken
/// and exit immediately). Stored as `isize` because a raw HANDLE is not `Sync`.
static SINGLETON: OnceLock<isize> = OnceLock::new();
/// True while the tray popup menu owns the UI thread. `TrackPopupMenu` runs its
/// own modal message loop that DISPATCHES to this window, so a posted
/// `WM_UPDATE_RESTART` can arrive mid-popup — and destroying the window under an
/// active popup is undefined. The relaunch is simply deferred instead: the new
/// build is already on disk, so it takes effect on the next start either way.
static MENU_OPEN: AtomicBool = AtomicBool::new(false);
/// Set when a relaunch arrived while [`MENU_OPEN`] — replayed as soon as the
/// popup closes, so the interactive path (click → sign in → menu → download
/// finishes) still relaunches immediately instead of waiting for the next start.
static RESTART_PENDING: AtomicBool = AtomicBool::new(false);

fn ui() -> &'static Mutex<Ui> {
    UI.get().expect("UI not initialised")
}
fn queue() -> &'static Arc<Mutex<VecDeque<PathBuf>>> {
    QUEUE.get().expect("QUEUE not initialised")
}

/// Pick a localized label (DE for German UI language, EN otherwise).
fn t(de: &str, en: &str) -> String {
    util::t(de, en)
}

fn main() {
    // Diagnostics first: without this a startup failure (GDI+, window, a panic
    // under `panic = "abort"`) vanishes with no feedback — "it just doesn't start".
    log::install_panic_hook();
    log::line("startup: launching");

    // One instance only (autostart + a manual launch must not double up).
    let Some(singleton) = util::acquire_single_instance() else {
        log::line("startup: another instance already running — exiting");
        return;
    };
    let _ = SINGLETON.set(singleton as isize);

    // Drop the previous build if we just relaunched into a self-update. Safe to
    // do here: the old image is no longer mapped by this process.
    update::cleanup_backup();

    let token = gfx::startup();
    util::set_fill_style();
    let (mut cfg, existed) = Config::load();
    if !existed {
        // Brand-new install → default to autostart ON (net effect: new installs
        // get it; nobody with an existing config is silently opted in later).
        util::set_autostart(true);
        cfg.autostart_initialized = true;
        cfg.save();
        log::line("startup: first run — autostart default applied");
    } else if !cfg.autostart_initialized {
        // Returning user from before this migration existed — respect their
        // current choice, just mark the migration done so it never re-applies.
        cfg.autostart_initialized = true;
        cfg.save();
        log::line("startup: existing install migrated — autostart choice preserved");
    }

    // Channel lock: the update ring is decided by the DOWNLOAD, never in the app
    // (see `update::resolve_channel` for the precedence and why). An unmarked
    // copy — the `latest` alias, a user rename, a self-updated exe — keeps the
    // ring already on file; only a fresh per-ring download re-locks it.
    let stored = if cfg.channel_locked { Some(cfg.channel) } else { None };
    let resolved = update::resolve_channel(stored);
    if !cfg.channel_locked || resolved != cfg.channel {
        cfg.channel = resolved;
        cfg.channel_locked = true;
        cfg.save();
        log::line(&format!("startup: update ring locked to {}", cfg.channel.as_str()));
    }

    QUEUE.get_or_init(|| Arc::new(Mutex::new(VecDeque::new())));

    unsafe { run(cfg) };
    log::line("shutdown: message loop ended");
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
        log::line("startup: main window creation failed — cannot host the tray icon");
        return;
    }

    // Always show *some* tray icon. If the embedded .ico fails to parse the app
    // would otherwise run with an invisible icon and look like it never started.
    let mut hicon = gfx::load_tray_icon();
    if hicon.is_null() {
        log::line("tray: embedded icon unavailable — using system fallback icon");
        hicon = LoadIconW(std::ptr::null_mut(), IDI_APPLICATION);
    }
    UI.get_or_init(|| Mutex::new(Ui { cfg, shown: false }));

    add_tray_icon(hwnd, hicon);
    log::line("startup: tray icon added, entering message loop");
    SetTimer(hwnd, TIMER_ROTATE, cfg.interval_min * 60_000, None);
    SetTimer(hwnd, TIMER_IDLE, IDLE_POLL_MS, None);

    let hwnd_isize = hwnd as isize;

    // Weekly Verse-News summary as the FIRST wallpaper after boot (once per
    // day, regardless of mode — this is the "informed after PC start" moment,
    // shown while the user is actively at the login/desktop, never as a
    // screensaver). Optimistically gate the normal first-gallery-image
    // bootstrap (WM_IMG_READY) until the summary resolves or times out.
    let today = util::today_yyyymmdd();
    let due = cfg.summary_on_boot && cfg.summary_last_shown != today;
    if due {
        ui().lock().unwrap().shown = true;
        log::line("startup: weekly Verse News summary due — fetching before first gallery image");
        spawn_summary_fetch(hwnd_isize, true);
    }

    // Background prefetch thread.
    let q = Arc::clone(queue());
    std::thread::spawn(move || prefetch_loop(hwnd_isize, q));

    // Background update thread — silent by design: it never opens a browser and
    // never shows a notification. Its only visible effect is the tray-menu
    // readout, plus a seamless relaunch when a verified newer build lands.
    spawn_update_loop(hwnd_isize, cfg.channel);

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
                let (need, wants_wp) = {
                    let u = ui().lock().unwrap();
                    (!u.shown, u.cfg.mode.wants_wallpaper())
                };
                if need {
                    if wants_wp {
                        apply_next();
                    } else {
                        // Screensaver-only: never auto-apply a desktop background,
                        // but stop re-checking every prefetch tick.
                        ui().lock().unwrap().shown = true;
                    }
                }
                0
            }
            WM_SUMMARY_READY => {
                let ok = wp != 0;
                let boot_flow = lp == 0;
                if ok {
                    let dest = util::cache_dir().join(SUMMARY_FILE);
                    let fade = ui().lock().unwrap().cfg.fade;
                    gfx::crossfade_set(&dest, fade);
                    let mut u = ui().lock().unwrap();
                    u.shown = true;
                    u.cfg.summary_last_shown = util::today_yyyymmdd();
                    u.cfg.save();
                    log::line("summary: applied as wallpaper");
                } else if boot_flow {
                    ui().lock().unwrap().shown = false;
                    apply_next();
                    log::line("summary: fetch failed/timed out at boot — falling back to gallery image");
                } else {
                    log::line("summary: on-demand fetch failed — wallpaper unchanged");
                }
                0
            }
            WM_UPDATE_FOREGROUND => {
                // The website sign-in just finished. Bring the app forward and
                // open the tray menu, so the user lands back where they started
                // instead of hunting for the tray icon. This is the ONLY unasked
                // surface the updater ever shows, and it is a direct reply to the
                // user's own tray click — the periodic poll never gets here.
                util::force_foreground(hwnd);
                if !MENU_OPEN.load(Ordering::SeqCst) {
                    show_menu(hwnd);
                }
                0
            }
            WM_UPDATE_RESTART => {
                if screensaver::is_active() {
                    // Never yank a fullscreen slideshow away. The new exe is
                    // already on disk, so it takes effect on the next start.
                    log::line("update: screensaver on screen — relaunch deferred to next start");
                    return 0;
                }
                if MENU_OPEN.load(Ordering::SeqCst) {
                    // Dispatched from inside TrackPopupMenu's modal loop —
                    // tearing the window down here would destroy the window the
                    // popup is tracking. See MENU_OPEN / RESTART_PENDING.
                    RESTART_PENDING.store(true, Ordering::SeqCst);
                    log::line("update: tray menu open — relaunch queued until it closes");
                    return 0;
                }
                restart_into_update(hwnd);
                0
            }
            WM_TIMER => {
                if wp == TIMER_ROTATE {
                    let (paused, wants_wp) = {
                        let u = ui().lock().unwrap();
                        (u.cfg.paused, u.cfg.mode.wants_wallpaper())
                    };
                    // Skip while the screensaver is up (Both mode): a crossfade
                    // overlay underneath would flash over the fullscreen saver.
                    if !paused && wants_wp && !screensaver::is_active() {
                        apply_next();
                    }
                } else if wp == TIMER_IDLE {
                    let (wants_ss, after_min) = {
                        let u = ui().lock().unwrap();
                        (u.cfg.mode.wants_screensaver(), u.cfg.screensaver_after_min)
                    };
                    if wants_ss && idle_ms() >= (after_min as u64) * 60_000 {
                        log::line("screensaver: idle threshold reached — launching");
                        screensaver::run();
                        log::line("screensaver: dismissed, resuming normal operation");
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

/// Milliseconds since the last system-wide keyboard/mouse input, via
/// `GetLastInputInfo`. Used only for the screensaver idle trigger. `GetTickCount`
/// wraps every ~49.7 days; `wrapping_sub` keeps that harmless for this purpose.
fn idle_ms() -> u64 {
    unsafe {
        let mut lii: LASTINPUTINFO = std::mem::zeroed();
        lii.cbSize = std::mem::size_of::<LASTINPUTINFO>() as u32;
        if GetLastInputInfo(&mut lii) == 0 {
            return 0;
        }
        GetTickCount().wrapping_sub(lii.dwTime) as u64
    }
}

/// Fetch the weekly Verse-News summary image on a background thread and post
/// [`WM_SUMMARY_READY`] back to the UI thread once resolved (`wparam` = success
/// flag, `lparam` = 0 for the boot flow / 1 for an on-demand "show now" fetch).
/// For the boot flow only, a companion timeout thread releases the gate after
/// ~12s if the fetch is still pending, so the desktop is never stuck blank.
fn spawn_summary_fetch(hwnd_isize: isize, boot_flow: bool) {
    let resolved = Arc::new(AtomicBool::new(false));

    let r1 = Arc::clone(&resolved);
    std::thread::spawn(move || {
        let (w, h) = unsafe {
            (
                GetSystemMetrics(SM_CXSCREEN).max(1) as u32,
                GetSystemMetrics(SM_CYSCREEN).max(1) as u32,
            )
        };
        let dest = util::cache_dir().join(SUMMARY_FILE);
        let ok = net::fetch_summary_image(&dest, w, h);
        log::line(&format!("summary: fetch {}", if ok { "succeeded" } else { "failed" }));
        if !r1.swap(true, Ordering::SeqCst) {
            let lp = if boot_flow { 0 } else { 1 };
            unsafe {
                PostMessageW(hwnd_isize as *mut c_void, WM_SUMMARY_READY, ok as usize, lp);
            }
        }
    });

    if boot_flow {
        let r2 = Arc::clone(&resolved);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(12));
            if !r2.swap(true, Ordering::SeqCst) {
                log::line("summary: fetch still pending after 12s — releasing gate to gallery");
                unsafe {
                    PostMessageW(hwnd_isize as *mut c_void, WM_SUMMARY_READY, 0, 0);
                }
            }
        });
    }
}

// ---------------- Self-update ----------------

/// Periodic, entirely silent update poll on its own thread.
fn spawn_update_loop(hwnd_isize: isize, channel: Channel) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(UPDATE_FIRST_DELAY_SECS));
        loop {
            run_update_cycle(hwnd_isize, false, channel);
            std::thread::sleep(Duration::from_secs(UPDATE_POLL_SECS));
        }
    });
}

/// Run one check/install cycle and post the UI-thread follow-ups it asks for.
/// `interactive` (tray click only) additionally permits a browser sign-in.
fn run_update_cycle(hwnd_isize: isize, interactive: bool, channel: Channel) {
    let hwnd = hwnd_isize as *mut c_void;
    let signed_in = || unsafe {
        PostMessageW(hwnd, WM_UPDATE_FOREGROUND, 0, 0);
    };
    if update::run_cycle(interactive, channel, &signed_in) {
        unsafe {
            PostMessageW(hwnd, WM_UPDATE_RESTART, 0, 0);
        }
    }
}

/// Relaunch into the freshly written executable.
///
/// Order matters: drop the tray icon (so no ghost is left in the notification
/// area), release the single-instance mutex (or the successor exits on sight of
/// it), then spawn and tear this instance down.
unsafe fn restart_into_update(hwnd: HWND) {
    remove_tray_icon(hwnd);
    if let Some(&h) = SINGLETON.get() {
        if h != 0 {
            CloseHandle(h as HANDLE);
        }
    }
    match std::env::current_exe().map(std::process::Command::new) {
        Ok(mut cmd) => match cmd.spawn() {
            Ok(_) => log::line("update: relaunched into the new build"),
            Err(e) => log::line(&format!("update: relaunch failed ({e}) — new build starts next time")),
        },
        Err(e) => log::line(&format!("update: current_exe() failed ({e}) — cannot relaunch")),
    }
    DestroyWindow(hwnd);
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
    let (paused, fade, mode, delay, summary_on_boot, channel) = {
        let u = ui().lock().unwrap();
        (
            u.cfg.paused,
            u.cfg.fade,
            u.cfg.mode,
            u.cfg.screensaver_after_min,
            u.cfg.summary_on_boot,
            u.cfg.channel,
        )
    };
    let autostart = util::autostart_enabled();
    let chk = |on: bool| MF_STRING | if on { MF_CHECKED } else { 0 };

    // ---- Mode submenu ----
    let mode_menu = CreatePopupMenu();
    let l_mode_wp = util::wide(&t("Desktop-Hintergrund", "Desktop background"));
    let l_mode_ss = util::wide(&t("Bildschirmschoner", "Screensaver"));
    let l_mode_both = util::wide(&t("Beides", "Both"));
    AppendMenuW(mode_menu, chk(mode == Mode::Wallpaper), ID_MODE_WALLPAPER, l_mode_wp.as_ptr());
    AppendMenuW(mode_menu, chk(mode == Mode::Screensaver), ID_MODE_SCREENSAVER, l_mode_ss.as_ptr());
    AppendMenuW(mode_menu, chk(mode == Mode::Both), ID_MODE_BOTH, l_mode_both.as_ptr());

    // ---- Screensaver delay submenu ----
    let delay_menu = CreatePopupMenu();
    let delays: [(u32, usize); 5] =
        [(5, ID_DELAY_5), (10, ID_DELAY_10), (15, ID_DELAY_15), (30, ID_DELAY_30), (60, ID_DELAY_60)];
    let delay_labels: Vec<Vec<u16>> = delays
        .iter()
        .map(|(m, _)| util::wide(&t(&format!("{m} Min."), &format!("{m} min"))))
        .collect();
    for (i, (m, id)) in delays.iter().enumerate() {
        AppendMenuW(delay_menu, chk(*m == delay), *id, delay_labels[i].as_ptr());
    }

    let l_next = util::wide(&t("Nächstes Wallpaper", "Next wallpaper"));
    let l_pause = util::wide(&t("Pausiert", "Paused"));
    let l_mode = util::wide(&t("Modus", "Mode"));
    let l_delay = util::wide(&t("Bildschirmschoner-Verzögerung", "Screensaver delay"));
    let l_fade = util::wide(&t("Übergangseffekt", "Fade transition"));
    let l_summary_boot = util::wide(&t("Verse-News beim Start", "Weekly Verse News on start"));
    let l_auto = util::wide(&t("Mit Windows starten", "Start with Windows"));
    let l_summary_now =
        util::wide(&t("Verse-News-Zusammenfassung jetzt zeigen", "Show Verse News summary now"));
    let l_star = util::wide(&t("Starscape Website öffnen", "Open Starscape website"));
    let l_quit = util::wide(&t("Beenden", "Quit"));

    // Version readout, always first: "aktuell" when we are, "Update verfügbar"
    // only when there really is one. Greyed unless clicking it does something —
    // the tray menu is the updater's ONLY surface, no balloons, no toasts.
    let l_update = util::wide(&update::tray_label(channel));
    let update_flags = MF_STRING | if update::is_actionable() { 0 } else { MF_GRAYED };

    let menu = CreatePopupMenu();
    AppendMenuW(menu, update_flags, ID_UPDATE, l_update.as_ptr());
    AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    AppendMenuW(menu, MF_STRING, ID_NEXT, l_next.as_ptr());
    AppendMenuW(menu, chk(paused), ID_PAUSE, l_pause.as_ptr());
    AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    AppendMenuW(menu, MF_POPUP, mode_menu as usize, l_mode.as_ptr());
    AppendMenuW(menu, MF_POPUP, delay_menu as usize, l_delay.as_ptr());
    AppendMenuW(menu, chk(fade), ID_FADE, l_fade.as_ptr());
    AppendMenuW(menu, chk(summary_on_boot), ID_SUMMARY_ON_BOOT, l_summary_boot.as_ptr());
    AppendMenuW(menu, chk(autostart), ID_AUTOSTART, l_auto.as_ptr());
    AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    AppendMenuW(menu, MF_STRING, ID_SUMMARY_NOW, l_summary_now.as_ptr());
    AppendMenuW(menu, MF_STRING, ID_STARSCAPE, l_star.as_ptr());
    AppendMenuW(menu, MF_STRING, ID_QUIT, l_quit.as_ptr());

    let mut pt: POINT = std::mem::zeroed();
    GetCursorPos(&mut pt);
    SetForegroundWindow(hwnd); // required so the menu closes on click-away
    // Guard the modal loop: it dispatches to this window, so anything that would
    // destroy the window (WM_UPDATE_RESTART) must stand down until we are out.
    MENU_OPEN.store(true, Ordering::SeqCst);
    let cmd = TrackPopupMenu(
        menu,
        TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
        pt.x,
        pt.y,
        0,
        hwnd,
        std::ptr::null(),
    );
    MENU_OPEN.store(false, Ordering::SeqCst);
    // DestroyMenu recursively destroys attached popup submenus too.
    DestroyMenu(menu);
    PostMessageW(hwnd, 0 /* WM_NULL */, 0, 0);

    match cmd as usize {
        ID_NEXT => apply_next(),
        ID_PAUSE => toggle(|c| c.paused = !c.paused),
        ID_FADE => toggle(|c| c.fade = !c.fade),
        ID_AUTOSTART => {
            util::set_autostart(!autostart);
        }
        ID_MODE_WALLPAPER => toggle(|c| c.mode = Mode::Wallpaper),
        ID_MODE_SCREENSAVER => toggle(|c| c.mode = Mode::Screensaver),
        ID_MODE_BOTH => toggle(|c| c.mode = Mode::Both),
        ID_DELAY_5 => toggle(|c| c.screensaver_after_min = 5),
        ID_DELAY_10 => toggle(|c| c.screensaver_after_min = 10),
        ID_DELAY_15 => toggle(|c| c.screensaver_after_min = 15),
        ID_DELAY_30 => toggle(|c| c.screensaver_after_min = 30),
        ID_DELAY_60 => toggle(|c| c.screensaver_after_min = 60),
        ID_SUMMARY_ON_BOOT => toggle(|c| c.summary_on_boot = !c.summary_on_boot),
        ID_SUMMARY_NOW => {
            log::line("summary: on-demand fetch requested from tray");
            spawn_summary_fetch(hwnd as isize, false);
        }
        ID_UPDATE => {
            // Interactive cycle: may open the website sign-in when the locked
            // ring is above the anonymous tier, then install straight away.
            log::line("update: tray entry clicked");
            let hwnd_isize = hwnd as isize;
            std::thread::spawn(move || run_update_cycle(hwnd_isize, true, channel));
        }
        ID_STARSCAPE => util::open_url(STARSCAPE_URL),
        ID_QUIT => {
            DestroyWindow(hwnd);
            return;
        }
        _ => {}
    }

    // An update finished installing while this menu was up (the common case on
    // the interactive path: click → sign in → menu opens → download completes).
    // The restart was postponed rather than dropped — run it now that the modal
    // loop is gone.
    if RESTART_PENDING.swap(false, Ordering::SeqCst) {
        PostMessageW(hwnd, WM_UPDATE_RESTART, 0, 0);
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
    let mut warned_empty = false;

    loop {
        if urls.is_empty() {
            urls = net::fetch_wallpaper_urls();
            if urls.is_empty() {
                if !warned_empty {
                    log::line("prefetch: wallpaper list empty/unreachable — retrying every 15s");
                    warned_empty = true;
                }
                std::thread::sleep(std::time::Duration::from_secs(15));
                continue;
            }
            warned_empty = false;
            log::line(&format!("prefetch: fetched {} wallpaper urls", urls.len()));
        }

        let ready = q.lock().unwrap().len();
        if ready < 3 {
            let url = urls[idx % urls.len()].clone();
            idx += 1;
            let ext = if url.to_lowercase().ends_with(".png") { "png" } else { "jpg" };
            let dest = cache.join(format!("wp_{counter}.{ext}"));
            counter += 1;
            // Skip sources under 1/5 of the primary monitor's pixel count — they
            // look soft/upscaled when cover-fit to the desktop. Read per download
            // so a resolution change is picked up; 0 (metrics failed) disables it.
            let min_pixels = unsafe {
                let cx = GetSystemMetrics(SM_CXSCREEN).max(0) as u64;
                let cy = GetSystemMetrics(SM_CYSCREEN).max(0) as u64;
                (cx * cy) / 5
            };
            if net::download_image(&url, &dest, min_pixels) {
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
