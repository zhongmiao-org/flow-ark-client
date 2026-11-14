# Changelog

## [Unreleased]

- Recheck the same nonsecure input control before each Unicode text chunk, allowing the current input to change its own text or selection without resuming after focus moves.
- Query the current system accessibility focus owner for macOS foreground checks instead of depending on the command helper refreshing the NSWorkspace cache; retain exact-window and dispatch guards.
- Check ARIA disabled, read-only, inert and composed-tree states before embedded browser input, and AXEnabled before macOS element clicks. Label Excel headers as source evidence rather than target webpage fields.

- Resolve an assembled authoring baseline by the exact public revision, preserve current unassembled work on that revision, and reject stale-base reuse instead of reverting current source to an older conversation draft.

- Add redacted read-only instance and runtime preflight evidence, separate generation, client and prerequisite failures in the Skill, keep analysis in recovery mode, and distinguish native dispatch receipts from document replacement receipts.

- Show protected-workspace initialization explicitly and avoid displaying an empty inbox before workspace loading completes.

- Inspect project-owned failed runs and pending evidence automatically; add enforced read-only AI analysis and local repair planning, and allow technical corrections within approved nodes while retaining scope, unknown-result and run reviews.

- Route synthetic desktop input to the bound process, check posting access before dispatch, and retain foreground and observation checks; dispatch receipts do not prove selection changes.

- Preserve bounded clipboard snapshots up to 16 MiB for desktop copy/paste, including image formats; reject changes during capture and oversized snapshots before modifying clipboard contents.

- Remove project AI request/time budgets and cost checkboxes. Show provider-reported cumulative tokens, read selected workbook headers, and attach owned run diagnostics; require confirmation before repairs and execution.

- Provide at least three choices and custom input for assisted decisions; preselection does not submit, corrections do not approve the old plan, and explicit paid retries retain the conversation.

- Add assisted project conversations with explicit plan and node selection, pause after generation or diagnostics, and assemble locally without model calls. Reuse Markdown/Mermaid rendering and retain detailed history in a collapsed view.

- Generate typed desktop observations, receipts, selection and effect SDK declarations from their schemas, and expose the same response shapes through MCP.

- Validate replacement entries against the new public file list, preserve old files, and keep failed assembly revisions monotonic. Recover affected drafts through read-only inspection and a new plan; unrelated edits no longer reset repeated-error stops.

- Add candidate macOS window observations and actions, plus a bundled authoring Skill with staged node planning, SDK type checks, deterministic assembly and no-progress stops. Business acceptance remains separate.

- Allow standalone flows and authoring copies to be classified as development work without changing their definitions or history; retain the classification when saving.

- Group template entry flows into task cards and separate development instances without deleting history; add Monaco project file models, SDK/schema hints, draft diagnostics, and block navigation.

### Added

- Local workflow projects bind stable Mermaid block IDs to JS/TS, schemas, public constants and configuration. Block and source edits share revision checks and preserve conflicting edits.
- Packaged CLI, paired local stdio MCP and an AI authoring tool loop using protected credentials, explicit compatible endpoints/protocols/models, request budgets and saved progress.
- Development runs use the existing host and permission review. Profile/env/explicit overrides are fixed per run; private data stays out of public ZIPs. Source ZIP round trips and explicit same-boundary instance rebuilds retain history.

### Fixed

- Preserve already-bound result references, deduplication records and unknown outcomes across project rebuilds. Full reviews use a scrollable dialog and never execute after cancellation or timeout.
- Inject root context only into tools that declare it. Explicitly retry confirmed-unexecuted local packaging/import validation failures without model requests; never replay runs or unknown external effects.
- Preserve complete independent author copies while bounding exported code size; script workers inherit only necessary host-selected environment variables.

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
