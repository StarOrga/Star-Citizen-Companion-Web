//! Fullscreen screensaver slideshow, shown after user inactivity when the
//! configured [`crate::util::Mode`] includes `Screensaver`. Reuses gfx's image
//! decoding ([`gfx::load_hbitmap`]) and cover-fit paint ([`gfx::blit_cover_fit`]).
//!
//! Always trivially dismissable — this is a screensaver, never a trap: it
//! closes on any genuine keyboard input, mouse-button click, or mouse move
//! beyond a tiny jitter threshold. Runs its own nested modal `GetMessageW`
//! loop on the UI thread and returns once dismissed, so the caller can simply
//! call [`run`] and continue afterwards.
//!
//! All statics here are touched only from the UI thread (same invariant as
//! gfx.rs's `PAINT_BMP` et al.) — never accessed from the prefetch thread.

use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, DeleteObject, EndPaint, GetStockObject, InvalidateRect, BLACK_BRUSH, HBITMAP,
    HBRUSH, PAINTSTRUCT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    GetSystemMetrics, KillTimer, PeekMessageW, PostQuitMessage, RegisterClassW,
    SetForegroundWindow, SetTimer, ShowCursor, ShowWindow, TranslateMessage, MSG, PM_REMOVE,
    SM_CXSCREEN, SM_CYSCREEN, SW_SHOW, WM_DESTROY, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN,
    WM_MOUSEMOVE, WM_PAINT, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_TIMER, WNDCLASSW, WS_EX_TOPMOST,
    WS_POPUP,
};

use crate::gfx;
use crate::log;
use crate::util::{cache_dir, wide};

const TIMER_ADVANCE: usize = 1;
const ADVANCE_MS: u32 = 8_000;
const MOVE_THRESHOLD: i32 = 3;

// UI-thread-only statics (see module doc).
static mut CLASS_REGISTERED: bool = false;
static mut CLOSE_REQUESTED: bool = false;
static mut IMAGES: Vec<PathBuf> = Vec::new();
static mut IDX: usize = 0;
static mut CUR_BMP: HBITMAP = std::ptr::null_mut();
static mut CUR_W: i32 = 0;
static mut CUR_H: i32 = 0;
static mut FIRST_POS: Option<(i32, i32)> = None;

/// True while a screensaver session is on screen. The main window checks this
/// to (a) avoid recursively relaunching it — its nested message loop keeps
/// dispatching the main window's `TIMER_IDLE`, which would otherwise fire again
/// while the user stays idle — and (b) suppress wallpaper rotation underneath it
/// (a crossfade overlay would flash over the screensaver in `Both` mode).
static SS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether the fullscreen screensaver is currently displayed.
pub fn is_active() -> bool {
    SS_ACTIVE.load(Ordering::SeqCst)
}

/// Show the fullscreen slideshow and block (via a nested message loop) until
/// the user dismisses it. Never panics; if there is nothing cached yet it
/// logs and returns immediately without creating a window. Re-entrant calls
/// (from the nested loop's own `TIMER_IDLE`) are no-ops via [`SS_ACTIVE`].
pub fn run() {
    let images = list_gallery_images();
    if images.is_empty() {
        log::line("screensaver: no cached images yet — skipping this trigger");
        return;
    }
    // Re-entrancy guard: without this, staying idle would recursively relaunch
    // the screensaver every idle-poll tick (clobbering the UI-thread statics and
    // stacking fullscreen windows), because run_inner's nested GetMessageW loop
    // dispatches the main window's TIMER_IDLE too.
    if SS_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    unsafe { run_inner(images) };
    SS_ACTIVE.store(false, Ordering::SeqCst);
}

unsafe fn run_inner(images: Vec<PathBuf>) {
    CLOSE_REQUESTED = false;
    FIRST_POS = None;
    CUR_BMP = std::ptr::null_mut();
    CUR_W = 0;
    CUR_H = 0;
    IDX = 0;
    IMAGES = images;

    let hinst = GetModuleHandleW(std::ptr::null());
    let class_name = ensure_class(hinst);

    let sw = GetSystemMetrics(SM_CXSCREEN);
    let sh = GetSystemMetrics(SM_CYSCREEN);
    let title = wide("");
    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST,
        class_name.as_ptr(),
        title.as_ptr(),
        WS_POPUP,
        0,
        0,
        sw,
        sh,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        hinst,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        log::line("screensaver: window creation failed — aborting this trigger");
        (&mut *std::ptr::addr_of_mut!(IMAGES)).clear();
        return;
    }

    let first = (&*std::ptr::addr_of!(IMAGES))[IDX].clone();
    load_image(&first);

    ShowWindow(hwnd, SW_SHOW);
    SetForegroundWindow(hwnd);
    ShowCursor(0);
    SetTimer(hwnd, TIMER_ADVANCE, ADVANCE_MS, None);
    log::line("screensaver: launched");

    let mut msg: MSG = std::mem::zeroed();
    let mut got_quit = false;
    loop {
        if CLOSE_REQUESTED {
            break;
        }
        let r = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
        if r <= 0 {
            got_quit = true;
            break;
        }
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    KillTimer(hwnd, TIMER_ADVANCE);
    ShowCursor(1);
    DestroyWindow(hwnd);
    // Drain any messages still queued for this window (e.g. the WM_DESTROY
    // DispatchMessageW would otherwise pick up on the *outer* loop).
    let mut drain: MSG = std::mem::zeroed();
    while PeekMessageW(&mut drain, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
        DispatchMessageW(&drain);
    }
    free_current();
    (&mut *std::ptr::addr_of_mut!(IMAGES)).clear();
    log::line("screensaver: closed");

    // A genuine WM_QUIT (app shutting down) must still reach the outer main
    // message loop — repost it so Quit works even while the screensaver is up.
    if got_quit {
        PostQuitMessage(msg.wParam as i32);
    }
}

unsafe fn ensure_class(hinst: *mut c_void) -> Vec<u16> {
    let class_name = wide("SccScreensaver");
    if !CLASS_REGISTERED {
        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(sc_proc);
        wc.hInstance = hinst;
        wc.lpszClassName = class_name.as_ptr();
        wc.hbrBackground = GetStockObject(BLACK_BRUSH) as HBRUSH;
        RegisterClassW(&wc);
        CLASS_REGISTERED = true;
    }
    class_name
}

unsafe fn load_image(path: &PathBuf) {
    free_current();
    if let Some((bmp, w, h)) = gfx::load_hbitmap(path) {
        CUR_BMP = bmp;
        CUR_W = w;
        CUR_H = h;
    }
}

unsafe fn free_current() {
    if !CUR_BMP.is_null() {
        DeleteObject(CUR_BMP as _);
        CUR_BMP = std::ptr::null_mut();
    }
}

/// Newest-first list of already-prefetched gallery images in the cache dir
/// (the same files the wallpaper rotation downloads — `wp_*`). Excludes any
/// non-gallery cache entries (e.g. the boot summary image).
fn list_gallery_images() -> Vec<PathBuf> {
    let dir = cache_dir();
    let Ok(rd) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut files: Vec<(SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("wp_"))
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, e.path()))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    files.into_iter().map(|(_, p)| p).collect()
}

extern "system" fn sc_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut ps);
                let sw = GetSystemMetrics(SM_CXSCREEN);
                let sh = GetSystemMetrics(SM_CYSCREEN);
                gfx::blit_cover_fit(hdc, CUR_BMP, CUR_W.max(1), CUR_H.max(1), sw, sh);
                EndPaint(hwnd, &ps);
                0
            }
            WM_TIMER => {
                if wp == TIMER_ADVANCE {
                    let images_ref = &*std::ptr::addr_of!(IMAGES);
                    let len = images_ref.len();
                    if len > 0 {
                        IDX = (IDX + 1) % len;
                        let path = images_ref[IDX].clone();
                        load_image(&path);
                        InvalidateRect(hwnd, std::ptr::null(), 0);
                    }
                }
                0
            }
            WM_KEYDOWN | WM_SYSKEYDOWN | WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
                CLOSE_REQUESTED = true;
                0
            }
            WM_MOUSEMOVE => {
                let x = (lp as isize & 0xFFFF) as i16 as i32;
                let y = ((lp as isize >> 16) & 0xFFFF) as i16 as i32;
                match FIRST_POS {
                    None => FIRST_POS = Some((x, y)),
                    Some((fx, fy)) => {
                        if (x - fx).abs() > MOVE_THRESHOLD || (y - fy).abs() > MOVE_THRESHOLD {
                            CLOSE_REQUESTED = true;
                        }
                    }
                }
                0
            }
            WM_DESTROY => {
                CLOSE_REQUESTED = true;
                0
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}
