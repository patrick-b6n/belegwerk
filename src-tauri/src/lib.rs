//! Tauri host. Registers plugins only; all application logic lives in the
//! TypeScript frontend.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Name under which the database is registered with `tauri-plugin-sql`. The
/// frontend opens it with `Database.get(DB_NAME)` (src/persistence).
const DB_NAME: &str = "sqlite:belegwerk.db";
/// File name in the app data directory (`%APPDATA%\de.belegwerk.desktop`).
const DB_FILE: &str = "belegwerk.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .setup(|app| {
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

    let options = SqliteConnectOptions::new()
        .filename(dir.join(DB_FILE))
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
