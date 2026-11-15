//! Tauri host. Registers plugins; all application logic lives in the
//! TypeScript frontend. The only own commands are the auto-update (#71,
//! [`updater`]): network access and replacing the exe belong in Rust.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};
use tauri_plugin_window_state::StateFlags;

mod updater;

/// Name under which the database is registered with `tauri-plugin-sql`. The
/// frontend opens it with `Database.get(DB_NAME)` (src/persistence).
const DB_NAME: &str = "sqlite:belegwerk.db";
/// File name in the app data directory (`%APPDATA%\de.belegwerk.desktop`).
/// Debug builds (`pnpm tauri dev`) use their own file, so development and
/// testing never touch the real data; the release build uses `belegwerk.db`.
const DB_FILE: &str = if cfg!(debug_assertions) {
    "belegwerk-dev.db"
} else {
    "belegwerk.db"
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single instance (#33): must be the first plugin. A second start of
        // the .exe exits right away and brings the running window to the
        // front instead of opening the same database a second time.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Info
                } else {
                    log::LevelFilter::Warn
                })
                .build(),
        )
        .plugin(tauri_plugin_sql::Builder::new().build())
        // CSV export (#24): save dialog, then writing the chosen file. The
        // dialog adds the chosen path to the fs scope; capabilities grant no
        // other paths (src-tauri/capabilities/default.json).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Stripe client (#29): HTTPS performed in Rust, the WebView talks to
        // it over the IPC. The capability allows only the Stripe API's
        // application fee endpoints (src-tauri/capabilities/default.json).
        .plugin(tauri_plugin_http::init())
        // Release notes of an update (#71) in the default browser; the
        // capability allows only this repository's release pages.
        .plugin(tauri_plugin_opener::init())
        // Restores the last window size, position and maximized state and
        // saves them on resize/close (`.window-state.json` in the app config
        // directory). Only geometry: visibility, decorations and fullscreen
        // stay as configured in tauri.conf.json.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            updater::check_for_update,
            updater::install_update
        ])
        .setup(|app| {
            // Leftovers of an update (#71): the previous exe (`.old`).
            updater::cleanup_after_update();
            // Without a pool the frontend gets "database not loaded" and shows
            // its startup error screen; the cause is in the log.
            if let Err(error) = tauri::async_runtime::block_on(register_database(app.handle())) {
                log::error!("could not open database: {error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Opens the SQLite database with a pool of exactly one connection and hands
/// it to `tauri-plugin-sql` (its own `load` always creates a pool of up to
/// ten connections).
///
/// One connection is required: the frontend runs `PRAGMA`s and transactions
/// as separate `execute` calls, which only work if they all hit the same
/// connection (docs/data-model.md). The connection is never recycled, so an
/// open transaction cannot get lost between two calls.
async fn register_database(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;

    let file = dir.join(DB_FILE);
    log::info!("database file: {}", file.display());
    let options = SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await?;

    app.state::<DbInstances>()
        .0
        .write()
        .await
        .insert(DB_NAME.to_string(), DbPool::Sqlite(pool));
    Ok(())
}
