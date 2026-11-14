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
    // Own commands (#71, src/updater.rs): declared in the app manifest, so
    // the WebView may call them only with a permission in a capability
    // (`allow-check-for-update`, `allow-install-update`).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["check_for_update", "install_update"]),
    ))
    .expect("failed to run tauri-build");
}
