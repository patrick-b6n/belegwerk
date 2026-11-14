//! Auto-update from GitHub releases (#71).
//!
//! Tauri's updater plugin needs an installer or archive; Belegwerk ships a
//! bare, unsigned `.exe` (docs/release.md). So the app replaces itself:
//!
//! 1. `check_for_update`: `GET /repos/{REPOSITORY}/releases/latest` and a
//!    SemVer comparison with the running version.
//! 2. `install_update`: asks GitHub again (never trusts URLs from the
//!    WebView), downloads `belegwerk-<version>.exe.sha256` and
//!    `belegwerk-<version>.exe` – the latter into a staging file next to the
//!    running exe (same volume, so the swap is a rename) – checks size and
//!    SHA-256, then swaps the files and restarts the app.
//! 3. The swap renames the running exe to `<exe>.old` (Windows allows
//!    renaming a running image, not overwriting it) and the staged file to
//!    the exe's name; if the second rename fails, the first is undone. The
//!    next start deletes the leftover `<exe>.old` ([`cleanup_after_update`]).
//!
//! Until the swap nothing next to the exe changes but the staging file, which
//! is removed on every failure: the old version stays intact. Debug builds
//! (`tauri dev`) refuse to install.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;

/// The public repository the releases come from.
const REPOSITORY: &str = "patrick-b6n/belegwerk-next";
/// No personal data: GitHub only requires some User-Agent.
const USER_AGENT: &str = "Belegwerk-Updater";
/// Upper bound for the downloaded exe (the release exe has about 13 MB).
const MAX_EXE_SIZE: u64 = 256 * 1024 * 1024;
/// Upper bound for the checksum file (one line in `sha256sum` format).
const MAX_CHECKSUM_FILE_SIZE: usize = 4096;

/// Result of [`check_for_update`], sent to the WebView.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// Version of the running app as CalVer (`2026-11-14-2000`; `0.0.0` in
    /// development).
    pub current_version: String,
    /// Version of the latest GitHub release (tag without `v`, CalVer).
    pub latest_version: String,
    /// Whether the latest release is newer than the running app (compared in
    /// SemVer form).
    pub update_available: bool,
    /// The release page (release notes) on GitHub.
    pub release_url: String,
}

/// Progress of the download in [`install_update`], sent over a channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// What went wrong; the WebView maps `kind` to a German message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateErrorKind {
    /// No connection to GitHub (offline, DNS, TLS, timeout).
    Network,
    /// GitHub answered with an error status (e.g. rate limit).
    Http,
    /// The repository has no published release yet.
    NoRelease,
    /// The release is unusable: bad tag, missing or unexpected assets, bad
    /// checksum file, size mismatch.
    InvalidRelease,
    /// The downloaded exe does not match the published SHA-256.
    ChecksumMismatch,
    /// `install_update` was called, but there is no newer version.
    NoUpdate,
    /// Debug build (`tauri dev`): the exe is never replaced.
    DevBuild,
    /// Writing the staging file or swapping the exe failed (e.g. no write
    /// access to the exe's folder). The old exe is unchanged.
    FileSystem,
}

/// Error of the update commands. `message` is technical (English) detail for
/// the log and the console; the UI text comes from `kind`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateError {
    pub kind: UpdateErrorKind,
    pub message: String,
}

impl UpdateError {
    fn new(kind: UpdateErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl From<reqwest::Error> for UpdateError {
    fn from(error: reqwest::Error) -> Self {
        // `without_url`: the URLs are public, but keep the message short.
        let error = error.without_url();
        match error.status() {
            Some(status) => Self::new(UpdateErrorKind::Http, format!("HTTP {status}")),
            None => Self::new(UpdateErrorKind::Network, error.to_string()),
        }
    }
}

// --- GitHub API (only the fields used) ---

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// The exe and checksum asset of a release.
#[derive(Debug)]
struct ReleaseAssets<'a> {
    exe: &'a GithubAsset,
    checksum: &'a GithubAsset,
}

// --- Pure logic (unit-tested) ---

// Versions are CalVer `YYYY-MM-DD-HHMM` (local release time) in tags, asset
// names, UI and logs; the app itself (package.json, Tauri) carries the SemVer
// form `YYYY.(MM*100+DD).(HH*100+MM)`. Same conversion as
// src/business/updates/calver.ts.

/// A release version in both forms.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ReleaseVersion {
    /// `2026-11-14-2000`
    calver: String,
    /// `2026.1114.2000`
    semver: semver::Version,
}

fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        2 if (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Whether the parts are a valid date and time (year 1000–9999).
fn is_valid_calver(year: u64, month: u64, day: u64, hour: u64, minute: u64) -> bool {
    (1000..=9999).contains(&year)
        && (1..=12).contains(&month)
        && day >= 1
        && day <= days_in_month(year, month)
        && hour <= 23
        && minute <= 59
}

/// `2026-11-14-2000` → `2026.1114.2000`; `None` if it is no valid CalVer.
fn calver_to_semver(calver: &str) -> Option<semver::Version> {
    let bytes = calver.as_bytes();
    let shape_ok = bytes.len() == 15
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 | 10 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    if !shape_ok {
        return None;
    }
    let number = |range: std::ops::Range<usize>| calver[range].parse::<u64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute) = (number(11..13)?, number(13..15)?);
    is_valid_calver(year, month, day, hour, minute)
        .then(|| semver::Version::new(year, month * 100 + day, hour * 100 + minute))
}

/// `2026.1114.2000` → `2026-11-14-2000`; `None` if it encodes no valid date
/// and time (e.g. the development version `0.0.0`).
fn semver_to_calver(version: &semver::Version) -> Option<String> {
    if !version.pre.is_empty() || !version.build.is_empty() {
        return None;
    }
    let (year, month, day) = (version.major, version.minor / 100, version.minor % 100);
    let (hour, minute) = (version.patch / 100, version.patch % 100);
    is_valid_calver(year, month, day, hour, minute)
        .then(|| format!("{year:04}-{month:02}-{day:02}-{hour:02}{minute:02}"))
}

/// How a version of the app is shown: CalVer, or SemVer if it has none
/// (`0.0.0` in development).
fn display_version(version: &semver::Version) -> String {
    semver_to_calver(version).unwrap_or_else(|| version.to_string())
}

/// Parses a release tag `v<YYYY-MM-DD-HHMM>`.
fn parse_tag(tag: &str) -> Result<ReleaseVersion, UpdateError> {
    tag.strip_prefix('v')
        .and_then(|calver| {
            calver_to_semver(calver).map(|semver| ReleaseVersion {
                calver: calver.to_string(),
                semver,
            })
        })
        .ok_or_else(|| {
            UpdateError::new(
                UpdateErrorKind::InvalidRelease,
                format!("release tag {tag:?} is not v<YYYY-MM-DD-HHMM>"),
            )
        })
}

/// Whether `latest` is newer than `current`, compared in SemVer form. The
/// development version `0.0.0` is older than every release.
fn is_newer(current: &semver::Version, latest: &semver::Version) -> bool {
    latest > current
}

/// File name of the exe asset of `version` (scripts/release.ts).
fn exe_asset_name(version: &ReleaseVersion) -> String {
    format!("belegwerk-{}.exe", version.calver)
}

fn release_page_prefix() -> String {
    format!("https://github.com/{REPOSITORY}/releases/")
}

fn download_prefix() -> String {
    format!("https://github.com/{REPOSITORY}/releases/download/")
}

/// Turns the API response into an [`UpdateCheck`]; refuses release pages
/// outside the repository (the WebView opens that URL).
fn evaluate_release(
    current: &semver::Version,
    release: &GithubRelease,
) -> Result<UpdateCheck, UpdateError> {
    let latest = parse_tag(&release.tag_name)?;
    if !release.html_url.starts_with(&release_page_prefix()) {
        return Err(UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("unexpected release URL {:?}", release.html_url),
        ));
    }
    Ok(UpdateCheck {
        current_version: display_version(current),
        latest_version: latest.calver,
        update_available: is_newer(current, &latest.semver),
        release_url: release.html_url.clone(),
    })
}

/// Picks `belegwerk-<version>.exe` and `belegwerk-<version>.exe.sha256` from
/// the release; both must be downloads of this repository.
fn select_assets<'a>(
    release: &'a GithubRelease,
    version: &ReleaseVersion,
) -> Result<ReleaseAssets<'a>, UpdateError> {
    let exe_name = exe_asset_name(version);
    let checksum_name = format!("{exe_name}.sha256");
    let find = |name: &str| {
        let asset = release
            .assets
            .iter()
            .find(|asset| asset.name == name)
            .ok_or_else(|| {
                UpdateError::new(
                    UpdateErrorKind::InvalidRelease,
                    format!("release {} has no asset {name}", release.tag_name),
                )
            })?;
        if !asset.browser_download_url.starts_with(&download_prefix()) {
            return Err(UpdateError::new(
                UpdateErrorKind::InvalidRelease,
                format!(
                    "unexpected download URL {:?} for {name}",
                    asset.browser_download_url
                ),
            ));
        }
        Ok(asset)
    };
    let exe = find(&exe_name)?;
    if exe.size == 0 || exe.size > MAX_EXE_SIZE {
        return Err(UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("implausible size {} of {exe_name}", exe.size),
        ));
    }
    Ok(ReleaseAssets {
        exe,
        checksum: find(&checksum_name)?,
    })
}

/// Reads the SHA-256 (lowercase hex) for `file_name` from a checksum file in
/// `sha256sum` format (`<hex>  <name>`, binary mode `<hex> *<name>`). A line
/// with the hash alone is accepted as well; a line naming another file is
/// refused.
fn parse_checksum_file(content: &str, file_name: &str) -> Result<String, UpdateError> {
    let invalid = |detail: &str| {
        UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("invalid checksum file: {detail}"),
        )
    };
    let line = content
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| invalid("empty"))?;
    let mut parts = line.splitn(2, char::is_whitespace);
    let hash = parts.next().unwrap_or_default();
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("no SHA-256 hash"));
    }
    if let Some(name) = parts.next() {
        let name = name.trim();
        let name = name.strip_prefix('*').unwrap_or(name);
        if name != file_name {
            return Err(invalid(&format!("names {name:?} instead of {file_name:?}")));
        }
    }
    Ok(hash.to_ascii_lowercase())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Where the running exe is parked during the swap.
fn backup_path(exe: &Path) -> PathBuf {
    let mut path = exe.as_os_str().to_owned();
    path.push(".old");
    PathBuf::from(path)
}

/// Where the new exe is downloaded to: next to the running exe, so the swap
/// is a rename on the same volume.
fn staging_path(exe: &Path) -> PathBuf {
    let mut path = exe.as_os_str().to_owned();
    path.push(".update");
    PathBuf::from(path)
}

/// Replaces `exe` with `staged`: `exe` → `<exe>.old`, `staged` → `exe`. If the
/// second rename fails, the first is undone, so `exe` is either the old or
/// the new version, never missing (unless the rollback itself fails, which
/// is logged; `<exe>.old` is then still there).
fn replace_executable(exe: &Path, staged: &Path) -> io::Result<()> {
    let backup = backup_path(exe);
    match fs::remove_file(&backup) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::rename(exe, &backup)?;
    if let Err(error) = fs::rename(staged, exe) {
        if let Err(rollback) = fs::rename(&backup, exe) {
            log::error!(
                "update: could not restore {} from {}: {rollback}",
                exe.display(),
                backup.display()
            );
        }
        return Err(error);
    }
    Ok(())
}

/// Deletes the staging file when dropped, unless [`StagingFile::keep`] was
/// called – so every early return removes a partial download.
struct StagingFile {
    path: PathBuf,
    keep: bool,
}

impl StagingFile {
    fn keep(mut self) {
        self.keep = true;
    }
}

impl Drop for StagingFile {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_file(&self.path);
        }
    }
}

// --- Network ---

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, UpdateError> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60));
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(UpdateError::from)
}

async fn fetch_latest_release() -> Result<GithubRelease, UpdateError> {
    let url = format!("https://api.github.com/repos/{REPOSITORY}/releases/latest");
    let response = client(Some(Duration::from_secs(30)))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(UpdateError::new(
            UpdateErrorKind::NoRelease,
            "the repository has no published release",
        ));
    }
    let body = response.error_for_status()?.bytes().await?;
    serde_json::from_slice(&body).map_err(|error| {
        UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("unexpected GitHub response: {error}"),
        )
    })
}

fn current_version(app: &tauri::AppHandle) -> Result<semver::Version, UpdateError> {
    let version = app.package_info().version.to_string();
    semver::Version::parse(&version).map_err(|error| {
        UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("own version {version:?} is no SemVer version: {error}"),
        )
    })
}

async fn download_checksum(asset: &GithubAsset, exe_name: &str) -> Result<String, UpdateError> {
    let response = client(Some(Duration::from_secs(60)))?
        .get(&asset.browser_download_url)
        .send()
        .await?
        .error_for_status()?;
    let body = response.bytes().await?;
    if body.len() > MAX_CHECKSUM_FILE_SIZE {
        return Err(UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            "checksum file too large",
        ));
    }
    let content = std::str::from_utf8(&body).map_err(|_| {
        UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            "checksum file is not UTF-8",
        )
    })?;
    parse_checksum_file(content, exe_name)
}

fn file_system_error(action: &str, path: &Path, error: io::Error) -> UpdateError {
    UpdateError::new(
        UpdateErrorKind::FileSystem,
        format!("{action} {}: {error}", path.display()),
    )
}

/// Downloads the exe into `staging.path`, hashing it on the way; checks size
/// and hash. Progress goes to `on_progress` (at most about once per percent).
async fn download_exe(
    asset: &GithubAsset,
    expected_hash: &str,
    staging: &StagingFile,
    on_progress: &Channel<DownloadProgress>,
) -> Result<(), UpdateError> {
    let total = asset.size;
    let mut response = client(None)?
        .get(&asset.browser_download_url)
        .send()
        .await?
        .error_for_status()?;
    let mut file = File::create(&staging.path)
        .map_err(|error| file_system_error("could not create", &staging.path, error))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut reported_percent = u64::MAX;
    while let Some(chunk) = response.chunk().await? {
        downloaded += chunk.len() as u64;
        if downloaded > total {
            return Err(UpdateError::new(
                UpdateErrorKind::InvalidRelease,
                format!("download is larger than the announced {total} bytes"),
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|error| file_system_error("could not write", &staging.path, error))?;
        let percent = downloaded * 100 / total;
        if percent != reported_percent {
            reported_percent = percent;
            let _ = on_progress.send(DownloadProgress { downloaded, total });
        }
    }
    file.sync_all()
        .map_err(|error| file_system_error("could not write", &staging.path, error))?;
    drop(file);
    if downloaded != total {
        return Err(UpdateError::new(
            UpdateErrorKind::InvalidRelease,
            format!("downloaded {downloaded} of {total} bytes"),
        ));
    }
    let actual = to_hex(&hasher.finalize());
    if actual != expected_hash {
        return Err(UpdateError::new(
            UpdateErrorKind::ChecksumMismatch,
            format!("SHA-256 is {actual}, the release says {expected_hash}"),
        ));
    }
    Ok(())
}

// --- Commands ---

/// Asks GitHub for the latest release and compares it with the running
/// version. Errors are logged here as well (the startup check only logs).
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheck, UpdateError> {
    let result = async {
        let current = current_version(&app)?;
        let release = fetch_latest_release().await?;
        evaluate_release(&current, &release)
    }
    .await;
    if let Err(error) = &result {
        log::warn!("update check failed: {error}");
    }
    result
}

/// Downloads, verifies and installs the latest release, then restarts the
/// app (does not return on success). On failure the running exe is unchanged
/// and the error says why.
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), UpdateError> {
    if let Err(error) = install(&app, &on_progress).await {
        log::warn!("update failed: {error}");
        return Err(error);
    }
    log::info!("update installed, restarting");
    app.restart();
}

async fn install(
    app: &tauri::AppHandle,
    on_progress: &Channel<DownloadProgress>,
) -> Result<(), UpdateError> {
    if cfg!(debug_assertions) {
        return Err(UpdateError::new(
            UpdateErrorKind::DevBuild,
            "debug builds (tauri dev) are never replaced; test with a release build",
        ));
    }
    let current = current_version(app)?;
    let release = fetch_latest_release().await?;
    let check = evaluate_release(&current, &release)?;
    if !check.update_available {
        return Err(UpdateError::new(
            UpdateErrorKind::NoUpdate,
            format!(
                "latest release {} is not newer than {}",
                check.latest_version, check.current_version
            ),
        ));
    }
    let latest = parse_tag(&release.tag_name)?;
    let assets = select_assets(&release, &latest)?;
    let expected_hash = download_checksum(assets.checksum, &assets.exe.name).await?;

    // The path the app was started from; `app.restart()` starts that path
    // again, which then is the new version.
    let exe = tauri::utils::platform::current_exe()
        .map_err(|error| UpdateError::new(UpdateErrorKind::FileSystem, error.to_string()))?;
    let staging = StagingFile {
        path: staging_path(&exe),
        keep: false,
    };
    download_exe(assets.exe, &expected_hash, &staging, on_progress).await?;
    replace_executable(&exe, &staging.path)
        .map_err(|error| file_system_error("could not replace", &exe, error))?;
    // Renamed to the exe: nothing left to delete.
    staging.keep();
    log::info!(
        "updated {} from {} to {}",
        exe.display(),
        check.current_version,
        latest.calver
    );
    Ok(())
}

/// Deletes what an update left next to the exe: `<exe>.old` (the previous
/// version, still running while the new one starts) and a stale `<exe>.update`.
/// Runs on its own thread and retries for a few seconds, until the previous
/// process has exited.
pub fn cleanup_after_update() {
    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return;
    };
    std::thread::spawn(move || {
        for path in [backup_path(&exe), staging_path(&exe)] {
            for attempt in 0..40 {
                match fs::remove_file(&path) {
                    Ok(()) => break,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => break,
                    Err(error) if attempt == 39 => {
                        log::warn!("update: could not delete {}: {error}", path.display());
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(250)),
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> semver::Version {
        semver::Version::parse(text).unwrap()
    }

    /// The running version in the tests (2026-11-01-0930).
    const OLDER: &str = "2026.1101.930";
    /// The release `v2026-11-14-2000`.
    const LATEST_SEMVER: &str = "2026.1114.2000";

    fn latest() -> ReleaseVersion {
        parse_tag("v2026-11-14-2000").unwrap()
    }

    fn asset(name: &str, size: u64) -> GithubAsset {
        GithubAsset {
            name: name.to_string(),
            browser_download_url: format!(
                "https://github.com/{REPOSITORY}/releases/download/v2026-11-14-2000/{name}"
            ),
            size,
        }
    }

    fn release(tag: &str, assets: Vec<GithubAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/{REPOSITORY}/releases/tag/{tag}"),
            assets,
        }
    }

    const HASH: &str = "3f786850e387550fdab836ed7e6dc881de23001b8f2a6b3c1b0e4a3b6a1c2d3e";

    #[test]
    fn converts_calver_to_semver_and_back() {
        for (calver, semver) in [
            ("2026-11-14-2000", "2026.1114.2000"),
            ("2026-01-05-0930", "2026.105.930"),
            ("2026-01-01-0000", "2026.101.0"),
            ("2026-12-31-2359", "2026.1231.2359"),
            ("2028-02-29-0001", "2028.229.1"),
        ] {
            assert_eq!(calver_to_semver(calver), Some(version(semver)), "{calver}");
            assert_eq!(
                semver_to_calver(&version(semver)).as_deref(),
                Some(calver),
                "{semver}"
            );
        }
    }

    #[test]
    fn refuses_invalid_calver() {
        for calver in [
            "2026-13-01-0000",
            "2026-00-10-0000",
            "2026-02-30-0000",
            "2027-02-29-0000",
            "2026-11-14-2400",
            "2026-11-14-2060",
            "2026-11-14-200",
            "2026-11-14",
            "2026-11-14-20000",
            "+026-11-14-2000",
            "2026.1114.2000",
            "",
        ] {
            assert_eq!(calver_to_semver(calver), None, "{calver}");
        }
        for semver in [
            "0.0.0",
            "0.1.0",
            "2026.1314.2000",
            "2026.1114.2460",
            "2026.1114.2000-rc.1",
        ] {
            assert_eq!(semver_to_calver(&version(semver)), None, "{semver}");
        }
    }

    #[test]
    fn displays_versions_as_calver_or_unchanged() {
        assert_eq!(
            display_version(&version("2026.1114.2000")),
            "2026-11-14-2000"
        );
        assert_eq!(display_version(&version("0.0.0")), "0.0.0");
    }

    #[test]
    fn parses_calver_tags() {
        assert_eq!(
            parse_tag("v2026-11-14-2000").unwrap(),
            ReleaseVersion {
                calver: "2026-11-14-2000".into(),
                semver: version("2026.1114.2000"),
            }
        );
    }

    #[test]
    fn refuses_other_tags() {
        for tag in [
            "",
            "v",
            "latest",
            "v1.2.3",
            "2026-11-14-2000",
            "v2026.1114.2000",
            "v2026-11-14-2000-1",
        ] {
            assert_eq!(
                parse_tag(tag).unwrap_err().kind,
                UpdateErrorKind::InvalidRelease,
                "{tag}"
            );
        }
    }

    #[test]
    fn compares_in_semver_form() {
        let semver = |calver: &str| calver_to_semver(calver).unwrap();
        assert!(is_newer(&version("0.0.0"), &semver("2026-01-01-0000")));
        assert!(is_newer(
            &semver("2026-01-05-0930"),
            &semver("2026-01-05-0931")
        ));
        assert!(is_newer(
            &semver("2026-01-31-2359"),
            &semver("2026-02-01-0000")
        ));
        assert!(is_newer(
            &semver("2026-09-30-2000"),
            &semver("2026-10-01-0000")
        ));
        assert!(is_newer(
            &semver("2026-12-31-2359"),
            &semver("2027-01-01-0000")
        ));
        assert!(!is_newer(
            &semver("2026-11-14-2000"),
            &semver("2026-11-14-2000")
        ));
        assert!(!is_newer(
            &semver("2026-11-14-2000"),
            &semver("2026-11-14-1959")
        ));
    }

    #[test]
    fn evaluates_a_newer_release() {
        let check =
            evaluate_release(&version(OLDER), &release("v2026-11-14-2000", vec![])).unwrap();
        assert_eq!(
            check,
            UpdateCheck {
                current_version: "2026-11-01-0930".into(),
                latest_version: "2026-11-14-2000".into(),
                update_available: true,
                release_url: format!(
                    "https://github.com/{REPOSITORY}/releases/tag/v2026-11-14-2000"
                ),
            }
        );
    }

    #[test]
    fn evaluates_the_same_release_as_up_to_date() {
        let check = evaluate_release(
            &version(LATEST_SEMVER),
            &release("v2026-11-14-2000", vec![]),
        )
        .unwrap();
        assert!(!check.update_available);
    }

    #[test]
    fn refuses_a_release_page_outside_the_repository() {
        let mut other = release("v2026-11-14-2000", vec![]);
        other.html_url = "https://example.com/releases/v2026-11-14-2000".into();
        assert_eq!(
            evaluate_release(&version(OLDER), &other).unwrap_err().kind,
            UpdateErrorKind::InvalidRelease
        );
    }

    #[test]
    fn selects_the_exe_and_checksum_of_the_version() {
        let release = release(
            "v2026-11-14-2000",
            vec![
                asset("belegwerk-2026-11-01-0930.exe", 100),
                asset("belegwerk-2026-11-14-2000.exe.sha256", 85),
                asset("belegwerk-2026-11-14-2000.exe", 13_000_000),
            ],
        );
        let assets = select_assets(&release, &latest()).unwrap();
        assert_eq!(assets.exe.name, "belegwerk-2026-11-14-2000.exe");
        assert_eq!(assets.checksum.name, "belegwerk-2026-11-14-2000.exe.sha256");
    }

    #[test]
    fn refuses_a_release_without_exe_or_checksum() {
        let only_exe = release(
            "v2026-11-14-2000",
            vec![asset("belegwerk-2026-11-14-2000.exe", 100)],
        );
        let only_checksum = release(
            "v2026-11-14-2000",
            vec![asset("belegwerk-2026-11-14-2000.exe.sha256", 85)],
        );
        for release in [only_exe, only_checksum] {
            assert_eq!(
                select_assets(&release, &latest()).unwrap_err().kind,
                UpdateErrorKind::InvalidRelease
            );
        }
    }

    #[test]
    fn refuses_downloads_outside_the_repository() {
        let mut exe = asset("belegwerk-2026-11-14-2000.exe", 100);
        exe.browser_download_url = "https://example.com/belegwerk-2026-11-14-2000.exe".into();
        let release = release(
            "v2026-11-14-2000",
            vec![exe, asset("belegwerk-2026-11-14-2000.exe.sha256", 85)],
        );
        assert_eq!(
            select_assets(&release, &latest()).unwrap_err().kind,
            UpdateErrorKind::InvalidRelease
        );
    }

    #[test]
    fn refuses_an_implausible_exe_size() {
        for size in [0, MAX_EXE_SIZE + 1] {
            let release = release(
                "v2026-11-14-2000",
                vec![
                    asset("belegwerk-2026-11-14-2000.exe", size),
                    asset("belegwerk-2026-11-14-2000.exe.sha256", 85),
                ],
            );
            assert!(select_assets(&release, &latest()).is_err(), "{size}");
        }
    }

    #[test]
    fn parses_the_checksum_file_of_the_release_script() {
        let content = format!("{HASH}  belegwerk-2026-11-14-2000.exe\n");
        assert_eq!(
            parse_checksum_file(&content, "belegwerk-2026-11-14-2000.exe").unwrap(),
            HASH
        );
    }

    #[test]
    fn parses_binary_mode_uppercase_bom_and_bare_hashes() {
        let upper = HASH.to_ascii_uppercase();
        for content in [
            format!("{HASH} *belegwerk-2026-11-14-2000.exe"),
            format!("{upper}  belegwerk-2026-11-14-2000.exe\r\n"),
            format!("\u{feff}{HASH}  belegwerk-2026-11-14-2000.exe"),
            format!("\n{HASH}\n"),
        ] {
            assert_eq!(
                parse_checksum_file(&content, "belegwerk-2026-11-14-2000.exe").unwrap(),
                HASH,
                "{content:?}"
            );
        }
    }

    #[test]
    fn refuses_invalid_checksum_files() {
        for content in [
            String::new(),
            "   \n".to_string(),
            "not-a-hash  belegwerk-2026-11-14-2000.exe".to_string(),
            format!("{}  belegwerk-2026-11-14-2000.exe", &HASH[..63]),
            format!("{}g  belegwerk-2026-11-14-2000.exe", &HASH[..63]),
            format!("{HASH}  belegwerk-2026-11-01-0930.exe"),
        ] {
            assert_eq!(
                parse_checksum_file(&content, "belegwerk-2026-11-14-2000.exe")
                    .unwrap_err()
                    .kind,
                UpdateErrorKind::InvalidRelease,
                "{content:?}"
            );
        }
    }

    #[test]
    fn formats_hashes_as_lowercase_hex() {
        assert_eq!(
            to_hex(&Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn serializes_errors_and_checks_for_the_webview() {
        let error = UpdateError::new(UpdateErrorKind::ChecksumMismatch, "detail");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "kind": "checksumMismatch", "message": "detail" })
        );
        let check =
            evaluate_release(&version(OLDER), &release("v2026-11-14-2000", vec![])).unwrap();
        let json = serde_json::to_value(&check).unwrap();
        assert_eq!(json["currentVersion"], "2026-11-01-0930");
        assert_eq!(json["updateAvailable"], true);
    }

    /// A fresh directory under the system temp folder for one test.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "belegwerk-updater-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_the_exe_and_keeps_the_old_one_as_backup() {
        let dir = temp_dir("replace");
        let exe = dir.join("belegwerk.exe");
        let staged = staging_path(&exe);
        fs::write(&exe, "old").unwrap();
        fs::write(&staged, "new").unwrap();
        fs::write(backup_path(&exe), "stale backup").unwrap();

        replace_executable(&exe, &staged).unwrap();

        assert_eq!(fs::read_to_string(&exe).unwrap(), "new");
        assert_eq!(fs::read_to_string(backup_path(&exe)).unwrap(), "old");
        assert!(!staged.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_the_old_exe_if_the_new_one_cannot_be_moved_in() {
        let dir = temp_dir("rollback");
        let exe = dir.join("belegwerk.exe");
        fs::write(&exe, "old").unwrap();
        // The staged file is missing: the second rename fails.
        let error = replace_executable(&exe, &staging_path(&exe)).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(fs::read_to_string(&exe).unwrap(), "old");
        assert!(!backup_path(&exe).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn staging_file_is_removed_unless_kept() {
        let dir = temp_dir("staging");
        let path = dir.join("belegwerk.exe.update");
        fs::write(&path, "partial").unwrap();
        drop(StagingFile {
            path: path.clone(),
            keep: false,
        });
        assert!(!path.exists());

        fs::write(&path, "complete").unwrap();
        StagingFile {
            path: path.clone(),
            keep: false,
        }
        .keep();
        assert!(path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn derives_backup_and_staging_paths_next_to_the_exe() {
        let exe = Path::new(r"C:\Programme mit Ümlaut\belegwerk.exe");
        assert_eq!(
            backup_path(exe),
            Path::new(r"C:\Programme mit Ümlaut\belegwerk.exe.old")
        );
        assert_eq!(
            staging_path(exe),
            Path::new(r"C:\Programme mit Ümlaut\belegwerk.exe.update")
        );
    }
}
