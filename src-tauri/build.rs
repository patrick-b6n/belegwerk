fn main() {
    // The exe's version comes from package.json (tauri.conf.json has
    // `"version": "../package.json"`), but tauri-build only reruns when
    // tauri.conf.json changes. Without this line a version bump would not
    // reach the Windows resource on incremental builds (#33).
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
