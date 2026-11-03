# Changelog

## [Unreleased]

## [0.3.1] - 2026-11-03

### Fixed

- Explicitly verify and delete source branches after CI auto-merges, preserving new commits, protected branches and references from other open PRs when native automatic deletion leaves branches behind.

- Upgrade all JavaScript Actions used by CI and packaging to Node 24 runtimes, removing Node 20 deprecation warnings; use Node 24.22.2 LTS for builds.

- Resolve draft releases correctly and recover uploads from a verified same-source Release run with all four native packages successful, without moving tags.

## [0.3.0] - 2026-11-03

### Added

- Provide the 0.3.0 development preview with generic workflow editing, standard ZIP templates, an embedded browser, AI configuration, local schedules and run history.
- Add candidate packaging and GitHub Releases for both macOS architectures, Windows x64 and Linux x64, including SHA-256 checksums.
- Add a bilingual changelog watchdog for PR updates, release archives and protection of published notes.

### Fixed

- Use runner-compatible lipo argument ordering and consistent x64 filenames for Linux packages.

- Block auto-merge on workflow-level GitHub approval requirements, including runs that have not created check objects yet.

- Validate release branches with the dedicated strict SemVer rule so version dots in release-v0.3.0 are accepted.

- Allow packaging reruns to replace same-run Actions artifacts and verify the version inside the packaged application archive.

### Limitations

- This is a development preview. Packages do not certify full platform functionality or real business acceptance. Distribution certificates are not configured and macOS packages are not notarized.
- Application window and selection helpers are macOS-only; script execution is currently unavailable on Windows. Websites, browsers and AI providers retain their individual acceptance limits.
