//! GDI+ image loading, the tray HICON (parsed from the embedded .ico), and the
//! optional crossfade overlay. All of this runs on the main (UI) thread only, so
//! the few `static mut`s used to hand the bitmap to the overlay's window proc are
//! never touched concurrently.

use std::path::Path;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, DeleteDC, DeleteObject, EndPaint, SelectObject,
    SetStretchBltMode, StretchBlt, UpdateWindow, HALFTONE, HBITMAP, PAINTSTRUCT, SRCCOPY,
};
use windows_sys::Win32::Graphics::GdiPlus::{
    GdipCreateBitmapFromFile, GdipCreateHBITMAPFromBitmap, GdipDisposeImage, GdipGetImageHeight,
    GdipGetImageWidth, GdiplusShutdown, GdiplusStartup, GdiplusStartupInput, GpBitmap, GpImage,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateIconFromResourceEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    GetSystemMetrics, PeekMessageW, RegisterClassW, SetLayeredWindowAttributes, ShowWindow,
    TranslateMessage, HICON, LR_DEFAULTCOLOR, LWA_ALPHA, MSG, PM_REMOVE,
    SM_CXSCREEN, SM_CYSCREEN, SW_SHOWNOACTIVATE, WM_DESTROY, WM_PAINT, WNDCLASSW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
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

unsafe fn load_hbitmap(path: &Path) -> Option<(HBITMAP, i32, i32)> {
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

extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut ps);
                let bmp = PAINT_BMP;
                if !bmp.is_null() {
                    let sw = GetSystemMetrics(SM_CXSCREEN);
                    let sh = GetSystemMetrics(SM_CYSCREEN);
                    let (iw, ih) = (PAINT_W.max(1), PAINT_H.max(1));
                    // Cover-fit: scale to fill, center, crop the overflow.
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
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
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
