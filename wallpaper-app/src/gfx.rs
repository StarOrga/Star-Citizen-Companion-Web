//! GDI+ image loading, the tray HICON (parsed from the embedded .ico), and the
//! optional crossfade overlay. All of this runs on the main (UI) thread only, so
//! the few `static mut`s used to hand the bitmap to the overlay's window proc are
//! never touched concurrently.
//!
//! The crossfade overlay lives *inside Explorer's wallpaper layer* (the `WorkerW`
//! window behind the desktop icons), never as a normal top-level window — see
//! [`desktop_layer`]. That is what keeps a wallpaper change from interrupting
//! whatever the user is doing.

use std::path::Path;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, DeleteDC, DeleteObject, EndPaint, SelectObject,
    SetStretchBltMode, StretchBlt, UpdateWindow, HALFTONE, HBITMAP, HDC, PAINTSTRUCT, SRCCOPY,
};
use windows_sys::Win32::Graphics::GdiPlus::{
    GdipCreateBitmapFromFile, GdipCreateHBITMAPFromBitmap, GdipDisposeImage, GdipGetImageHeight,
    GdipGetImageWidth, GdiplusShutdown, GdiplusStartup, GdiplusStartupInput, GpBitmap, GpImage,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateIconFromResourceEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    FindWindowExW, FindWindowW, GetAncestor, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect,
    IsWindowVisible, PeekMessageW, RegisterClassW, SendMessageTimeoutW, SetLayeredWindowAttributes,
    SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow, TranslateMessage, GA_PARENT, GWL_STYLE,
    HICON, HWND_BOTTOM, LR_DEFAULTCOLOR, LWA_ALPHA, MSG, PM_REMOVE, SMTO_ABORTIFHUNG, SMTO_NORMAL,
    SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_SHOWNOACTIVATE, WM_DESTROY,
    WM_PAINT, WNDCLASSW, WS_CHILD, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use crate::util::{set_wallpaper, wide};

const EMBEDDED_ICON: &[u8] = include_bytes!("../assets/scc.ico");

// Handed to the overlay window proc for painting (main-thread-only, see above).
static mut PAINT_BMP: HBITMAP = std::ptr::null_mut();
static mut PAINT_W: i32 = 0;
static mut PAINT_H: i32 = 0;
static mut FADE_CLASS_REGISTERED: bool = false;

/// Start GDI+; returns the token to pass to [`shutdown`]. A non-zero status means
/// image decoding will silently fail later — log it so that shows up as a cause.
pub fn startup() -> usize {
    unsafe {
        let mut token: usize = 0;
        let mut input: GdiplusStartupInput = std::mem::zeroed();
        input.GdiplusVersion = 1;
        let status = GdiplusStartup(&mut token, &input, std::ptr::null_mut());
        if status != 0 {
            crate::log::line(&format!(
                "gfx: GdiplusStartup failed (status {status}) — image decode disabled"
            ));
        }
        token
    }
}

pub fn shutdown(token: usize) {
    unsafe { GdiplusShutdown(token) };
}

/// Build the tray HICON from the embedded .ico (no resource compiler needed).
pub fn load_tray_icon() -> HICON {
    if EMBEDDED_ICON.len() < 6 {
        return std::ptr::null_mut();
    }
    let count = u16::from_le_bytes([EMBEDDED_ICON[4], EMBEDDED_ICON[5]]) as usize;
    if count == 0 {
        return std::ptr::null_mut();
    }
    // Pick the entry closest to 32px (nice at typical tray DPI), else the first.
    let mut best: Option<(u32, u32)> = None; // (bytes_in_res, image_offset)
    let mut best_score = i32::MAX;
    for i in 0..count {
        let base = 6 + i * 16;
        if base + 16 > EMBEDDED_ICON.len() {
            break;
        }
        let width = match EMBEDDED_ICON[base] {
            0 => 256,
            w => w as i32,
        };
        let bytes = u32::from_le_bytes(EMBEDDED_ICON[base + 8..base + 12].try_into().unwrap());
        let offset = u32::from_le_bytes(EMBEDDED_ICON[base + 12..base + 16].try_into().unwrap());
        let score = (width - 32).abs();
        if score < best_score {
            best_score = score;
            best = Some((bytes, offset));
        }
    }
    let Some((bytes, offset)) = best else { return std::ptr::null_mut() };
    let (start, end) = (offset as usize, offset as usize + bytes as usize);
    if end > EMBEDDED_ICON.len() {
        return std::ptr::null_mut();
    }
    unsafe {
        CreateIconFromResourceEx(
            EMBEDDED_ICON[start..end].as_ptr(),
            bytes,
            1, // fIcon = TRUE
            0x0003_0000,
            0,
            0,
            LR_DEFAULTCOLOR,
        )
    }
}

/// Decode an image file to a device-independent HBITMAP + its pixel size.
/// Shared by the wallpaper crossfade overlay and the screensaver slideshow.
pub(crate) unsafe fn load_hbitmap(path: &Path) -> Option<(HBITMAP, i32, i32)> {
    let pw = wide(&path.to_string_lossy());
    let mut bmp: *mut GpBitmap = std::ptr::null_mut();
    if GdipCreateBitmapFromFile(pw.as_ptr(), &mut bmp) != 0 || bmp.is_null() {
        crate::log::line(&format!("gfx: could not decode {}", path.display()));
        return None;
    }
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    GdipGetImageWidth(bmp as *mut GpImage, &mut w);
    GdipGetImageHeight(bmp as *mut GpImage, &mut h);
    let mut hbm: HBITMAP = std::ptr::null_mut();
    // Opaque black background for any (rare) transparent pixels; we blit opaquely
    // and fade via global window alpha, so per-pixel alpha is irrelevant.
    let st = GdipCreateHBITMAPFromBitmap(bmp, &mut hbm, 0xFF00_0000);
    GdipDisposeImage(bmp as *mut GpImage);
    if st != 0 || hbm.is_null() || w == 0 || h == 0 {
        return None;
    }
    Some((hbm, w as i32, h as i32))
}

/// Cover-fit blit of `bmp` (size `iw`x`ih`) into the `sw`x`sh` area of `hdc`:
/// scale to fill, center, crop the overflow. Shared by the wallpaper crossfade
/// overlay and the screensaver slideshow.
pub(crate) unsafe fn blit_cover_fit(hdc: HDC, bmp: HBITMAP, iw: i32, ih: i32, sw: i32, sh: i32) {
    if bmp.is_null() || iw <= 0 || ih <= 0 {
        return;
    }
    let scale = (sw as f64 / iw as f64).max(sh as f64 / ih as f64);
    let dw = (iw as f64 * scale).round() as i32;
    let dh = (ih as f64 * scale).round() as i32;
    let dx = (sw - dw) / 2;
    let dy = (sh - dh) / 2;
    let mem = CreateCompatibleDC(hdc);
    let old = SelectObject(mem, bmp as _);
    SetStretchBltMode(hdc, HALFTONE);
    StretchBlt(hdc, dx, dy, dw, dh, mem, 0, 0, iw, ih, SRCCOPY);
    SelectObject(mem, old);
    DeleteDC(mem);
}

extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut ps);
                let sw = GetSystemMetrics(SM_CXSCREEN);
                let sh = GetSystemMetrics(SM_CYSCREEN);
                blit_cover_fit(hdc, PAINT_BMP, PAINT_W.max(1), PAINT_H.max(1), sw, sh);
                EndPaint(hwnd, &ps);
                0
            }
            WM_DESTROY => 0,
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

unsafe fn pump() {
    let mut msg: MSG = std::mem::zeroed();
    while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

/// Undocumented Progman message that makes Explorer spawn the `WorkerW` window
/// hosting the desktop wallpaper — the layer behind the desktop icons.
const WM_SPAWN_WORKER_W: u32 = 0x052C;

/// Reject the pile of tiny hidden `WorkerW` stubs Explorer keeps around: the
/// real wallpaper layer is visible and spans at least the primary monitor.
unsafe fn is_wallpaper_layer(h: HWND) -> bool {
    if h.is_null() || IsWindowVisible(h) == 0 {
        return false;
    }
    let mut r: RECT = std::mem::zeroed();
    if GetWindowRect(h, &mut r) == 0 {
        return false;
    }
    r.right - r.left >= GetSystemMetrics(SM_CXSCREEN)
        && r.bottom - r.top >= GetSystemMetrics(SM_CYSCREEN)
}

/// Handle of Explorer's desktop-wallpaper layer, asking Progman to spawn it
/// first. Null only when Progman is gone (no shell); every other path ends at a
/// window that is part of the desktop and therefore behind all applications.
///
/// Explorer's layout differs per Windows build, so probe in order:
/// 1. the icons (`SHELLDLL_DefView`) live in a `WorkerW` → the wallpaper is the
///    next `WorkerW` behind it (classic Windows 8/10),
/// 2. the icons live in `Progman` and a `WorkerW` was spawned behind it,
/// 3. no separate `WorkerW` at all → `Progman` itself. This is what current
///    Windows 11 does (verified on 10.0.26200: `Progman` hosts the icons, is the
///    bottom-most window in the Z-order, and `0x052C` spawns nothing usable).
unsafe fn desktop_layer() -> HWND {
    let progman_class = wide("Progman");
    let progman = FindWindowW(progman_class.as_ptr(), std::ptr::null());
    if progman.is_null() {
        return std::ptr::null_mut();
    }

    // All three parameter forms are in the wild across builds; they are
    // idempotent once the layer exists, and Windows 11 ignores the message
    // entirely. ABORTIFHUNG + a 1s timeout keeps a wedged Explorer from
    // stalling our UI thread — a plain SendMessage here would hang the app.
    let flags = SMTO_NORMAL | SMTO_ABORTIFHUNG;
    let mut res: usize = 0;
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER_W, 0x0D, 0x00, flags, 1_000, &mut res);
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER_W, 0x0D, 0x01, flags, 1_000, &mut res);
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER_W, 0x00, 0x00, flags, 1_000, &mut res);

    let workerw = wide("WorkerW");
    let defview = wide("SHELLDLL_DefView");
    let nul = std::ptr::null_mut();

    // 1 — icons inside a WorkerW → the next WorkerW behind that one.
    let mut top = FindWindowExW(nul, nul, workerw.as_ptr(), std::ptr::null());
    while !top.is_null() {
        if !FindWindowExW(top, nul, defview.as_ptr(), std::ptr::null()).is_null() {
            let w = FindWindowExW(nul, top, workerw.as_ptr(), std::ptr::null());
            if is_wallpaper_layer(w) {
                return w;
            }
        }
        top = FindWindowExW(nul, top, workerw.as_ptr(), std::ptr::null());
    }

    // 2 — icons under Progman and a real WorkerW behind it.
    let w = FindWindowExW(nul, progman, workerw.as_ptr(), std::ptr::null());
    if is_wallpaper_layer(w) {
        return w;
    }

    // 3 — Progman is the desktop.
    progman
}

/// Move `hwnd` into the desktop wallpaper layer, where it can never cover an
/// application window or take focus, and align it with the primary monitor.
/// Returns false if the layer could not be found or the re-parent did not take.
unsafe fn attach_to_desktop(hwnd: HWND, sw: i32, sh: i32) -> bool {
    let layer = desktop_layer();
    if layer.is_null() {
        return false;
    }

    // `SetParent` requires WS_CHILD instead of WS_POPUP to be set beforehand,
    // otherwise the window keeps being treated as top-level for Z-order.
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
    SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & !WS_POPUP) | WS_CHILD) as isize);
    SetParent(hwnd, layer);
    // SetParent returns the *previous* parent — null for a window that was
    // top-level, i.e. indistinguishable from failure. GetParent is no good
    // either (it reports the owner for non-WS_CHILD windows), so ask for the
    // real parent explicitly.
    if GetAncestor(hwnd, GA_PARENT) != layer {
        return false;
    }

    // Child coordinates are relative to the layer, which spans the whole virtual
    // desktop and can start at negative screen coordinates on multi-monitor
    // setups. Offset back so the overlay lines up with the primary monitor.
    let (mut x, mut y) = (0, 0);
    let mut r: RECT = std::mem::zeroed();
    if GetWindowRect(layer, &mut r) != 0 {
        x = -r.left;
        y = -r.top;
    }
    // HWND_BOTTOM puts the overlay at the bottom of the layer's own children,
    // i.e. behind the desktop icons. They stay readable because the desktop
    // list view is transparent (verified: LVS_EX_TRANSPARENTBKGND is set).
    SetWindowPos(hwnd, HWND_BOTTOM, x, y, sw, sh, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    true
}

unsafe fn ensure_class(hinst: *mut std::ffi::c_void) -> Vec<u16> {
    let class_name = wide("SccWallpaperFade");
    if !FADE_CLASS_REGISTERED {
        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(overlay_proc);
        wc.hInstance = hinst;
        wc.lpszClassName = class_name.as_ptr();
        RegisterClassW(&wc);
        FADE_CLASS_REGISTERED = true;
    }
    class_name
}

/// Apply `path` as the wallpaper. When `fade` is on, crossfade via a fullscreen
/// layered overlay first; any failure falls back to an instant switch.
///
/// The overlay is created hidden and immediately re-parented into Explorer's
/// wallpaper layer ([`attach_to_desktop`]) — it is never `WS_EX_TOPMOST` and is
/// never shown as a top-level window, so a wallpaper change cannot pop in front
/// of an application (fullscreen games included) or move the focus. If the
/// desktop layer cannot be reached, the fade is skipped rather than risking a
/// window on top of the user's work.
pub fn crossfade_set(path: &Path, fade: bool) -> bool {
    if !fade {
        return set_wallpaper(path);
    }
    unsafe {
        let Some((hbm, w, h)) = load_hbitmap(path) else {
            return set_wallpaper(path);
        };
        PAINT_BMP = hbm;
        PAINT_W = w;
        PAINT_H = h;

        let hinst = GetModuleHandleW(std::ptr::null());
        let class_name = ensure_class(hinst);
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);

        let title = wide("");
        // No WS_EX_TOPMOST: this window belongs behind everything. WS_EX_NOACTIVATE
        // keeps it from ever taking focus, WS_EX_TOOLWINDOW out of Alt-Tab.
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
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
            PAINT_BMP = std::ptr::null_mut();
            DeleteObject(hbm as _);
            return set_wallpaper(path);
        }

        // Sink it into the desktop layer *before* it is ever shown. If that
        // fails there is no safe way to display it, so switch without a fade.
        if !attach_to_desktop(hwnd, sw, sh) {
            DestroyWindow(hwnd);
            pump();
            PAINT_BMP = std::ptr::null_mut();
            DeleteObject(hbm as _);
            crate::log::line(
                "gfx: desktop wallpaper layer unavailable — switching without crossfade",
            );
            return set_wallpaper(path);
        }

        // Start fully transparent, show (without stealing focus), paint once.
        SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA);
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        UpdateWindow(hwnd);
        pump();

        // Ramp global alpha 0 → 255 over ~600ms.
        let steps = 34;
        for i in 1..=steps {
            let a = (255 * i / steps) as u8;
            SetLayeredWindowAttributes(hwnd, 0, a, LWA_ALPHA);
            // Keep servicing WM_PAINT: as a child of the desktop layer the
            // overlay is repainted whenever Explorer invalidates the desktop.
            pump();
            std::thread::sleep(std::time::Duration::from_millis(16));
        }

        // Overlay is now fully opaque → swap the real desktop underneath it, then
        // tear the overlay down (desktop already matches, so it's seamless).
        let ok = set_wallpaper(path);
        std::thread::sleep(std::time::Duration::from_millis(60));
        DestroyWindow(hwnd);
        pump();

        PAINT_BMP = std::ptr::null_mut();
        DeleteObject(hbm as _);
        ok
    }
}
