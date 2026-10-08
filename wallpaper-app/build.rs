//! Embeds a Windows resource into the release binary:
//!   * the Starscape brand icon (assets/starscape.ico) as the default application icon, so
//!     Explorer, the taskbar, Alt-Tab and Task Manager show the real mark
//!     instead of a generic placeholder;
//!   * a VERSIONINFO block. Task Manager's process "Name" column shows the
//!     `FileDescription` string — setting it to "Starscape" is what makes the
//!     process appear as *Starscape* rather than the raw `starscape-wallpaper.exe`.
//!
//! winresource is a build-only dependency (it shells out to `rc.exe` on MSVC or
//! `windres` on GNU) and adds nothing to the runtime binary.

fn main() {
    println!("cargo:rerun-if-changed=assets/starscape.ico");
    println!("cargo:rerun-if-changed=assets/starscape-tray.ico");
    println!("cargo:rerun-if-changed=build.rs");
    // src/update.rs bakes the per-release token in via `option_env!`, which is
    // resolved at compile time. Without this, a cached build would keep an older
    // (or absent) token when CI rotates it.
    println!("cargo:rerun-if-env-changed=SC_RELEASE_TOKEN");
    // Same story for the telemetry signing key baked in by src/telemetry.rs.
    println!("cargo:rerun-if-env-changed=SC_TELEMETRY_HMAC_KEY");

    // The resource compiler only exists for Windows targets; skip elsewhere so a
    // non-Windows toolchain (e.g. a docs/lint job) can still build the crate.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut res = winresource::WindowsResource::new();
    res.set_icon("assets/starscape.ico");
    // FileDescription drives the Task Manager process name — keep it "Starscape".
    res.set("FileDescription", "Starscape");
    res.set("ProductName", "Starscape");
    res.set("OriginalFilename", "starscape-wallpaper.exe");
    res.set("CompanyName", "Star Citizen Companion");
    res.set("LegalCopyright", "MIT License");
    // FileVersion / ProductVersion default from CARGO_PKG_VERSION.
    // Per-monitor DPI awareness (v2, falling back to v1 / system-aware on older
    // builds). Without it Windows bitmap-stretches every window of the process
    // at 125-150 % scaling, which blurs the live/meteor animation. With it every
    // size the app reads (SM_CXSCREEN, GetWindowRect of the wallpaper layer,
    // GetCursorPos for the tray menu) is in physical pixels, so the animation
    // and crossfade windows match the screen 1:1. main() repeats the request at
    // runtime for a build whose resource step failed (see util::enable_dpi_awareness).
    res.set_manifest(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"#,
    );

    if let Err(e) = res.compile() {
        // Don't hard-fail the build if the Windows SDK's rc.exe is missing on a
        // given dev box — surface it as a warning so the exe just lacks the
        // resource rather than failing to compile at all.
        println!("cargo:warning=winresource failed to embed the icon/version resource: {e}");
    }
}
