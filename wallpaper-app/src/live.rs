//! Animated constellation desktop (streak rewards sr-live and sr-meteor).
//!
//! Resource budget first, effect second:
//! - **No render loop of its own.** A `SetTimer` on the live window, driven by
//!   the app's existing message loop — 6 fps for the living constellation,
//!   15 fps for the meteor shower.
//! - **Dirty rectangles only.** The static sky is rendered once (`starmap`);
//!   per frame only the pixels a sprite touched are restored from that base,
//!   redrawn and invalidated. A twinkle is a few hundred pixels, not 8 million.
//! - **Paused** (timer drops to a 2 s probe) while a fullscreen app / game /
//!   presentation runs (`SHQueryUserNotificationState`), the foreground window
//!   is maximised (the desktop is not visible anyway), the machine runs on
//!   battery or battery saver, or the Starscape screensaver is up.
//! - The window lives in Explorer's wallpaper layer exactly like the crossfade
//!   overlay ([`crate::gfx::attach_to_desktop`]): a child of `WorkerW`/`Progman`,
//!   never `WS_EX_TOPMOST`, `WS_EX_NOACTIVATE` — it cannot cover an application
//!   or take focus. If that layer is unreachable the animation is not shown at
//!   all; the static wallpaper (already applied) stays.
//!
//! Main-thread only (thread-local state), like the rest of the GDI code.

use std::cell::RefCell;
use std::f64::consts::PI;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EndPaint,
    EnumDisplaySettingsW, InvalidateRect, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DEVMODEW, DIB_RGB_COLORS, ENUM_CURRENT_SETTINGS, HBITMAP, HDC, PAINTSTRUCT, SRCCOPY,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows_sys::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetForegroundWindow, GetSystemMetrics,
    IsZoomed, KillTimer, RegisterClassW, SetTimer, ShowWindow, SM_CXSCREEN, SM_CYSCREEN,
    SW_SHOWNOACTIVATE, WM_ERASEBKGND, WM_PAINT, WM_TIMER, WNDCLASSW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_POPUP,
};

use crate::log;
use crate::screensaver;
use crate::starmap::{Blend, Canvas, Layout, Rgba, Rng};
use crate::util::wide;

const TIMER_FRAME: usize = 1;
pub const LIVE_FPS: u32 = 6;
pub const METEOR_FPS: u32 = 15;
const PAUSED_PROBE_MS: u32 = 2_000;
const MAX_METEORS: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scene {
    /// sr-live: twinkle + breathing constellation + a rare shooting star.
    Live,
    /// sr-meteor: the LIVE-day shower radiating out of the constellation.
    Meteor,
}

impl Scene {
    pub fn frame_ms(self) -> u32 {
        1000 / match self {
            Scene::Live => LIVE_FPS,
            Scene::Meteor => METEOR_FPS,
        }
    }
}

// ---------------- Pure decisions (unit-tested) ----------------

/// Why the animation should rest right now, if at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Environment {
    /// `QUERY_USER_NOTIFICATION_STATE` value.
    pub notification_state: i32,
    pub on_battery: bool,
    pub battery_saver: bool,
    pub foreground_maximized: bool,
    pub screensaver: bool,
}

pub fn should_pause(e: &Environment) -> bool {
    matches!(e.notification_state, QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
        || e.on_battery
        || e.battery_saver
        || e.foreground_maximized
        || e.screensaver
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Meteor {
    pub x: f64,
    pub y: f64,
    pub dx: f64,
    pub dy: f64,
    pub speed: f64,
    pub age: f64,
    pub life: f64,
    pub width: f64,
    pub color: Rgba,
    pub fireball: bool,
}

const PALETTE: [Rgba; 4] = [
    Rgba(255.0, 255.0, 255.0, 1.0),
    Rgba(170.0, 215.0, 255.0, 1.0),
    Rgba(255.0, 214.0, 140.0, 1.0),
    Rgba(195.0, 165.0, 255.0, 1.0),
];

/// One meteor bursting away from `radiant`. Deterministic for a given RNG.
pub fn spawn_meteor(rnd: &mut Rng, radiant: (f64, f64), u: f64, fireball: bool) -> Meteor {
    let a = rnd.next() * PI * 2.0;
    let d0 = (40.0 + rnd.next() * 220.0) * u;
    let speed = (350.0 + rnd.next() * 650.0) * u * if fireball { 0.7 } else { 1.0 };
    let color = PALETTE[(rnd.next() * PALETTE.len() as f64) as usize % PALETTE.len()];
    Meteor {
        x: radiant.0 + a.cos() * d0,
        y: radiant.1 + a.sin() * d0,
        dx: a.cos(),
        dy: a.sin(),
        speed,
        age: 0.0,
        life: if fireball { 1.6 } else { 0.5 + rnd.next() * 0.7 },
        width: if fireball { 5.0 } else { 1.2 + rnd.next() * 1.4 } * u,
        color: if fireball { PALETTE[2] } else { color },
        fireball,
    }
}

/// Shower intensity over time: a steady drizzle, a dense burst every ~18 s.
pub fn spawn_rate(t: f64) -> f64 {
    let phase = t % 18.0;
    if phase < 1.6 { 22.0 } else { 3.5 }
}

// ---------------- Window + state ----------------

struct Twinkle {
    x: f64,
    y: f64,
    r: f64,
    phase: f64,
    speed: f64,
}

struct State {
    hwnd: HWND,
    memdc: HDC,
    dib: HBITMAP,
    old: *mut core::ffi::c_void,
    bits: *mut u32,
    base: Vec<u32>,
    w: i32,
    h: i32,
    layout: Layout,
    scene: Scene,
    rnd: Rng,
    twinkles: Vec<Twinkle>,
    meteors: Vec<Meteor>,
    flares: Vec<f64>,
    prev: Vec<RECT>,
    t: f64,
    spawn_acc: f64,
    next_fireball: f64,
    next_shooting: f64,
    paused: bool,
}

thread_local! {
    static LIVE: RefCell<Option<State>> = const { RefCell::new(None) };
}
static mut CLASS_REGISTERED: bool = false;

pub fn is_active() -> bool {
    LIVE.with(|l| l.borrow().is_some())
}

pub fn active_scene() -> Option<Scene> {
    LIVE.with(|l| l.borrow().as_ref().map(|s| s.scene))
}

/// Primary screen in this process's window coordinates — what the animation
/// window spans. Physical pixels: the process is per-monitor DPI aware
/// (manifest in build.rs + `util::enable_dpi_awareness`), so at 125-150 %
/// scaling the window is not bitmap-stretched by Windows and stays sharp.
pub fn window_screen() -> (i32, i32) {
    unsafe { (GetSystemMetrics(SM_CXSCREEN).max(1), GetSystemMetrics(SM_CYSCREEN).max(1)) }
}

/// Physical pixels of the primary display mode — what the wallpaper FILE is
/// rendered at (up to 4K), so a 150 %-scaled 4K screen still gets 3840×2160.
pub fn physical_screen() -> (u32, u32) {
    unsafe {
        let mut dm: DEVMODEW = std::mem::zeroed();
        dm.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(std::ptr::null(), ENUM_CURRENT_SETTINGS, &mut dm) != 0
            && dm.dmPelsWidth > 0
            && dm.dmPelsHeight > 0
        {
            return (dm.dmPelsWidth, dm.dmPelsHeight);
        }
    }
    let (w, h) = window_screen();
    (w as u32, h as u32)
}

fn environment() -> Environment {
    unsafe {
        let mut state = 0i32;
        if SHQueryUserNotificationState(&mut state) != 0 {
            state = 0;
        }
        let mut ps: SYSTEM_POWER_STATUS = std::mem::zeroed();
        let (on_battery, saver) = if GetSystemPowerStatus(&mut ps) != 0 {
            (ps.ACLineStatus == 0, ps.SystemStatusFlag == 1)
        } else {
            (false, false)
        };
        let fg = GetForegroundWindow();
        Environment {
            notification_state: state,
            on_battery,
            battery_saver: saver,
            foreground_maximized: !fg.is_null() && IsZoomed(fg) != 0,
            screensaver: screensaver::is_active(),
        }
    }
}

/// Start (or replace) the animation over `base` (`w`×`h` = [`window_screen`], physical pixels).
pub fn start(base: Vec<u32>, w: i32, h: i32, layout: Layout, scene: Scene, seed: &str) {
    stop();
    if base.len() != (w * h) as usize {
        return;
    }
    unsafe {
        let hinst = GetModuleHandleW(std::ptr::null());
        let class = wide("SccStarscapeLive");
        if !CLASS_REGISTERED {
            let mut wc: WNDCLASSW = std::mem::zeroed();
            wc.lpfnWndProc = Some(proc_);
            wc.hInstance = hinst;
            wc.lpszClassName = class.as_ptr();
            RegisterClassW(&wc);
            CLASS_REGISTERED = true;
        }
        let title = wide("");
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            w,
            h,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinst,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return;
        }
        if !crate::gfx::attach_to_desktop(hwnd, w, h) {
            DestroyWindow(hwnd);
            log::line("live: desktop wallpaper layer unavailable — keeping the static wallpaper");
            return;
        }
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -h; // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;
        let memdc = CreateCompatibleDC(std::ptr::null_mut());
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(memdc, &bi, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        if dib.is_null() || bits.is_null() {
            DeleteDC(memdc);
            DestroyWindow(hwnd);
            log::line("live: DIB allocation failed — keeping the static wallpaper");
            return;
        }
        let old = SelectObject(memdc, dib as _);
        std::ptr::copy_nonoverlapping(base.as_ptr(), bits as *mut u32, base.len());

        let u = layout.u;
        let mut tw_rnd = Rng::from_text(&format!("{seed}:live"));
        let twinkles = (0..40)
            .map(|_| Twinkle {
                x: tw_rnd.next() * w as f64,
                y: tw_rnd.next() * h as f64,
                r: (1.0 + tw_rnd.next() * 1.4) * u,
                phase: tw_rnd.next() * PI * 2.0,
                speed: 0.6 + tw_rnd.next() * 1.2,
            })
            .collect();
        let flares = vec![0.0; layout.stars.len()];
        let state = State {
            hwnd,
            memdc,
            dib,
            old: old as _,
            bits: bits as *mut u32,
            base,
            w,
            h,
            layout,
            scene,
            rnd: Rng::from_text(&format!("{seed}:meteor")),
            twinkles,
            meteors: Vec::new(),
            flares,
            prev: Vec::new(),
            t: 0.0,
            spawn_acc: 0.0,
            next_fireball: 6.0,
            next_shooting: 12.0,
            paused: false,
        };
        LIVE.with(|l| *l.borrow_mut() = Some(state));
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        InvalidateRect(hwnd, std::ptr::null(), 0);
        SetTimer(hwnd, TIMER_FRAME, scene.frame_ms(), None);
        log::line(&format!("live: {scene:?} scene started at {w}x{h}"));
    }
}

pub fn stop() {
    let Some(s) = LIVE.with(|l| l.borrow_mut().take()) else { return };
    unsafe {
        KillTimer(s.hwnd, TIMER_FRAME);
        DestroyWindow(s.hwnd);
        SelectObject(s.memdc, s.old as _);
        DeleteObject(s.dib as _);
        DeleteDC(s.memdc);
    }
    log::line("live: scene stopped");
}

extern "system" fn proc_(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut ps);
                LIVE.with(|l| {
                    if let Some(s) = l.borrow().as_ref() {
                        let r = ps.rcPaint;
                        BitBlt(hdc, r.left, r.top, r.right - r.left, r.bottom - r.top, s.memdc, r.left, r.top, SRCCOPY);
                    }
                });
                EndPaint(hwnd, &ps);
                0
            }
            WM_TIMER if wp == TIMER_FRAME => {
                tick();
                0
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn tick() {
    let env = environment();
    LIVE.with(|l| {
        let mut b = l.borrow_mut();
        let Some(s) = b.as_mut() else { return };
        let pause = should_pause(&env);
        if pause != s.paused {
            s.paused = pause;
            let ms = if pause { PAUSED_PROBE_MS } else { s.scene.frame_ms() };
            unsafe { SetTimer(s.hwnd, TIMER_FRAME, ms, None) };
            log::line(if pause { "live: paused (fullscreen/maximised/battery)" } else { "live: resumed" });
        }
        if pause {
            return;
        }
        frame(s);
    });
}

fn frame(s: &mut State) {
    let dt = s.scene.frame_ms() as f64 / 1000.0;
    s.t += dt;
    let len = (s.w * s.h) as usize;
    // SAFETY: `bits` is the DIB section of exactly w*h u32, owned by `s`.
    let px = unsafe { std::slice::from_raw_parts_mut(s.bits, len) };

    // 1 — restore the base under last frame's sprites.
    for r in &s.prev {
        for y in r.top.max(0)..r.bottom.min(s.h) {
            let a = (y * s.w + r.left.max(0)) as usize;
            let z = (y * s.w + r.right.min(s.w)) as usize;
            if a < z {
                px[a..z].copy_from_slice(&s.base[a..z]);
            }
        }
    }

    let mut c = Canvas::new(s.w, s.h, px);
    let mut rects: Vec<RECT> = Vec::new();
    let u = s.layout.u;
    let t = s.t;
    let mut take = |c: &mut Canvas| {
        if let Some((l, tp, r, b)) = c.dirty.take() {
            rects.push(RECT { left: l, top: tp, right: r, bottom: b });
        }
    };

    // 2 — twinkle (both scenes; mirrors the web's animateConstellation).
    for tw in &s.twinkles {
        let a = 0.5 + 0.5 * (tw.phase + t * tw.speed).sin();
        c.glow(tw.x, tw.y, tw.r * 5.0, Rgba(220.0, 235.0, 255.0, 0.7), Rgba(220.0, 235.0, 255.0, 0.0), a, Blend::Lighter);
        take(&mut c);
    }

    // 3 — the constellation breathes; meteor hits make a star flare.
    for (i, &(x, y)) in s.layout.stars.iter().enumerate() {
        let breathe = 0.18 + 0.12 * (t * 1.3 + i as f64 * 0.9).sin();
        let a = breathe + s.flares[i];
        let r = 3.2 * (14.0 + 26.0 * s.flares[i].min(1.0)) * u;
        c.glow(x, y, r, Rgba(200.0, 225.0, 255.0, 0.9), Rgba(120.0, 170.0, 255.0, 0.0), a.min(1.0), Blend::Lighter);
        take(&mut c);
        s.flares[i] = (s.flares[i] - dt * 1.4).max(0.0);
    }

    match s.scene {
        Scene::Live => {
            if t >= s.next_shooting && s.meteors.is_empty() {
                let origin = (s.rnd.next() * s.w as f64, s.rnd.next() * s.h as f64 * 0.4);
                let m = spawn_meteor(&mut s.rnd, origin, u, false);
                s.meteors.push(m);
                s.next_shooting = t + 20.0 + s.rnd.next() * 25.0;
            }
        }
        Scene::Meteor => {
            // Soft pulsing radiant in the heart of the constellation.
            let (rx, ry) = s.layout.radiant;
            let pulse = 0.22 + 0.1 * (t * 2.1).sin() + if t % 18.0 < 1.6 { 0.25 } else { 0.0 };
            c.glow(rx, ry, 70.0 * u, Rgba(255.0, 240.0, 255.0, 0.8), Rgba(160.0, 120.0, 255.0, 0.0), pulse, Blend::Lighter);
            take(&mut c);
            s.spawn_acc += spawn_rate(t) * dt;
            while s.spawn_acc >= 1.0 {
                s.spawn_acc -= 1.0;
                if s.meteors.len() < MAX_METEORS {
                    let m = spawn_meteor(&mut s.rnd, s.layout.radiant, u, false);
                    s.meteors.push(m);
                }
            }
            if t >= s.next_fireball {
                let m = spawn_meteor(&mut s.rnd, s.layout.radiant, u, true);
                s.meteors.push(m);
                s.next_fireball = t + 9.0 + s.rnd.next() * 8.0;
            }
        }
    }

    // 4 — meteors: glowing head, long fading tail, a wide faint trail.
    let stars = &s.layout.stars;
    let flares = &mut s.flares;
    s.meteors.retain_mut(|m| {
        m.age += dt;
        if m.age >= m.life {
            return false;
        }
        m.x += m.dx * m.speed * dt;
        m.y += m.dy * m.speed * dt;
        let env = (PI * m.age / m.life).sin();
        let tail = m.speed * if m.fireball { 0.35 } else { 0.22 } * env.max(0.2);
        let (tx, ty) = (m.x - m.dx * tail, m.y - m.dy * tail);
        c.line(m.x, m.y, tx, ty, m.width * 3.0, m.color, 0.18 * env, 1.0, Blend::Lighter);
        c.line(m.x, m.y, tx, ty, m.width, m.color, 0.95 * env, 1.0, Blend::Lighter);
        c.glow(m.x, m.y, m.width * if m.fireball { 9.0 } else { 5.0 }, Rgba(255.0, 255.0, 255.0, 0.9), Rgba(m.color.0, m.color.1, m.color.2, 0.0), env, Blend::Lighter);
        take(&mut c);
        for (i, &(sx, sy)) in stars.iter().enumerate() {
            if (sx - m.x).abs() < 24.0 * u && (sy - m.y).abs() < 24.0 * u {
                flares[i] = (flares[i] + 0.6).min(1.2);
            }
        }
        true
    });

    // 5 — invalidate old + new sprite rectangles only.
    unsafe {
        for r in s.prev.iter().chain(rects.iter()) {
            InvalidateRect(s.hwnd, r, 0);
        }
    }
    s.prev = rects;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Environment {
        Environment { notification_state: 5, on_battery: false, battery_saver: false, foreground_maximized: false, screensaver: false }
    }

    #[test]
    fn pauses_for_fullscreen_battery_and_maximised() {
        assert!(!should_pause(&env()), "QUNS_ACCEPTS_NOTIFICATIONS = idle desktop");
        for st in [QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE] {
            assert!(should_pause(&Environment { notification_state: st, ..env() }));
        }
        assert!(should_pause(&Environment { on_battery: true, ..env() }));
        assert!(should_pause(&Environment { battery_saver: true, ..env() }));
        assert!(should_pause(&Environment { foreground_maximized: true, ..env() }));
        assert!(should_pause(&Environment { screensaver: true, ..env() }));
    }

    #[test]
    fn fps_caps_are_low() {
        assert!(Scene::Live.frame_ms() >= 150);
        assert!(Scene::Meteor.frame_ms() >= 60);
    }

    #[test]
    fn meteors_are_deterministic_and_leave_the_radiant() {
        let mut a = Rng::from_text("4.4:meteor");
        let mut b = Rng::from_text("4.4:meteor");
        let ma = spawn_meteor(&mut a, (500.0, 300.0), 1.0, false);
        let mb = spawn_meteor(&mut b, (500.0, 300.0), 1.0, false);
        assert_eq!(ma, mb);
        let (ox, oy) = (ma.x - 500.0, ma.y - 300.0);
        assert!(ox * ma.dx + oy * ma.dy > 0.0, "moves outward from the radiant");
        assert!((ma.dx * ma.dx + ma.dy * ma.dy - 1.0).abs() < 1e-9);
    }

    #[test]
    fn bursts_are_denser_than_the_drizzle() {
        assert!(spawn_rate(0.5) > spawn_rate(5.0) * 4.0);
    }
}
