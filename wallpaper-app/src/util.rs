//! Small OS helpers: paths, config, wallpaper set, autostart registry, open-url.
//! Kept dependency-free (raw Win32 via windows-sys) so the binary stays tiny.

use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER, SW_SHOWNORMAL,
};

/// Null-terminated UTF-16 for Win32 `*W` APIs.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(p: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

/// `%APPDATA%\StarscapeWallpaper` (created on demand). Falls back to the temp dir.
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("StarscapeWallpaper");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Cache dir for prefetched images.
pub fn cache_dir() -> PathBuf {
    let dir = data_dir().join("cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

// ---------------- Config (tiny key=value file) ----------------

#[derive(Clone, Copy)]
pub struct Config {
    pub interval_min: u32,
    pub fade: bool,
    pub paused: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config { interval_min: 30, fade: true, paused: false }
    }
}

impl Config {
    fn path() -> PathBuf {
        data_dir().join("config.ini")
    }

    pub fn load() -> Config {
        let mut cfg = Config::default();
        if let Ok(text) = fs::read_to_string(Config::path()) {
            for line in text.lines() {
                let Some((k, v)) = line.split_once('=') else { continue };
                let (k, v) = (k.trim(), v.trim());
                match k {
                    "interval_min" => {
                        if let Ok(n) = v.parse::<u32>() {
                            cfg.interval_min = n.clamp(1, 24 * 60);
                        }
                    }
                    "fade" => cfg.fade = v == "1" || v.eq_ignore_ascii_case("true"),
                    "paused" => cfg.paused = v == "1" || v.eq_ignore_ascii_case("true"),
                    _ => {}
                }
            }
        }
        cfg
    }

    pub fn save(&self) {
        let text = format!(
            "interval_min={}\nfade={}\npaused={}\n",
            self.interval_min, self.fade as u8, self.paused as u8
        );
        let _ = fs::write(Config::path(), text);
    }
}

// ---------------- Wallpaper ----------------

/// Set the desktop wallpaper to `path`. Windows reads the file lazily, so it must
/// persist on disk (we keep it in the cache dir).
pub fn set_wallpaper(path: &Path) -> bool {
    let w = wide_path(path);
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            w.as_ptr() as *mut c_void,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        ) != 0
    }
}

/// Ensure the OS renders wallpapers "filled" (cover) rather than tiled/centered.
/// One-off write to HKCU\Control Panel\Desktop; ignored on failure.
pub fn set_fill_style() {
    write_hkcu_string("Control Panel\\Desktop", "WallpaperStyle", "10"); // 10 = Fill
    write_hkcu_string("Control Panel\\Desktop", "TileWallpaper", "0");
}

// ---------------- Autostart (HKCU ...\Run) ----------------

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "StarscapeWallpaper";

pub fn autostart_enabled() -> bool {
    read_hkcu_string(RUN_KEY, RUN_VALUE).is_some()
}

pub fn set_autostart(enable: bool) -> bool {
    if enable {
        let exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(_) => return false,
        };
        let quoted = format!("\"{}\"", exe.to_string_lossy());
        write_hkcu_string(RUN_KEY, RUN_VALUE, &quoted)
    } else {
        delete_hkcu_value(RUN_KEY, RUN_VALUE)
    }
}

// ---------------- Open URL in default browser ----------------

pub fn open_url(url: &str) {
    let op = wide("open");
    let u = wide(url);
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            u.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

// ---------------- Registry primitives ----------------

fn open_or_create(sub: &str, access: u32) -> Option<HKEY> {
    let sub_w = wide(sub);
    let mut hkey: HKEY = std::ptr::null_mut();
    let rc = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            sub_w.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            access,
            std::ptr::null(),
            &mut hkey,
            std::ptr::null_mut(),
        )
    };
    if rc == ERROR_SUCCESS {
        Some(hkey)
    } else {
        None
    }
}

fn write_hkcu_string(sub: &str, name: &str, value: &str) -> bool {
    let Some(hkey) = open_or_create(sub, KEY_WRITE) else { return false };
    let name_w = wide(name);
    let val_w = wide(value);
    let bytes = val_w.len() * 2; // includes terminating NUL
    let rc = unsafe {
        RegSetValueExW(
            hkey,
            name_w.as_ptr(),
            0,
            REG_SZ,
            val_w.as_ptr() as *const u8,
            bytes as u32,
        )
    };
    unsafe { RegCloseKey(hkey) };
    rc == ERROR_SUCCESS
}

fn read_hkcu_string(sub: &str, name: &str) -> Option<String> {
    let hkey = open_or_create(sub, KEY_READ)?;
    let name_w = wide(name);
    let mut buf = [0u16; 1024];
    let mut len = (buf.len() * 2) as u32;
    let mut ty: u32 = 0;
    let rc = unsafe {
        RegQueryValueExW(
            hkey,
            name_w.as_ptr(),
            std::ptr::null(),
            &mut ty,
            buf.as_mut_ptr() as *mut u8,
            &mut len,
        )
    };
    unsafe { RegCloseKey(hkey) };
    if rc == ERROR_SUCCESS && ty == REG_SZ {
        let chars = (len as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..chars]))
    } else {
        None
    }
}

fn delete_hkcu_value(sub: &str, name: &str) -> bool {
    let Some(hkey) = open_or_create(sub, KEY_WRITE) else { return false };
    let name_w = wide(name);
    let rc = unsafe { RegDeleteValueW(hkey, name_w.as_ptr()) };
    unsafe { RegCloseKey(hkey) };
    // Deleting an absent value is still "disabled" → treat as success.
    rc == ERROR_SUCCESS || rc == 2 /* ERROR_FILE_NOT_FOUND */
}

// Prevent a second instance (autostart + manual launch). Returns a handle we
// intentionally leak for the process lifetime, or None if one already runs.
pub fn acquire_single_instance() -> Option<HANDLE> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name = wide("Global\\StarscapeWallpaperSingleton");
    let h = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if h.is_null() {
        return Some(std::ptr::null_mut()); // couldn't create → don't block startup
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        return None;
    }
    Some(h)
}
