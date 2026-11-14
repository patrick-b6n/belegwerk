fn main() {
    // The exe's version comes from package.json (tauri.conf.json has
    // `"version": "../package.json"`), but tauri-build only reruns when
    // tauri.conf.json changes. Without this line a version bump would not
    // reach the Windows resource on incremental builds (#33).
    println!("cargo:rerun-if-changed=../package.json");
    // Same for the icons: the .ico goes into the Windows resource and
    // generate_context! embeds the window icon; neither is rebuilt when only
    // the icon files change, so a new icon would not reach the exe.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
