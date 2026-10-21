# Unified Taskbar

A [Dank Material Shell](https://danklinux.com) plugin that displays running applications grouped by workspace in pill-shaped containers on the DankBar.

![Unified Taskbar screenshot](screenshot.png)

## Features

- Windows organized by workspace in pill-shaped containers
- Supported compositors: Niri, Hyprland, Sway
- Click workspace pills to switch workspaces
- Click to focus windows, middle-click to close, right-click for context menu
- Optional app grouping with window count badges
- Right-click menu with application desktop-entry actions (when supplied), Close, and grouped-window selection/Close All when Group by App is enabled. Close targets the representative window; Close All affects only the selected workspace/app group.
- Compact icon-only mode
- Horizontal and vertical bar support

## Settings

| Setting | Description |
|---------|-------------|
| Compact Mode | Show only app icons without window titles |
| Group by App | Collapse multiple windows of the same app into one entry with a count badge |
| Show All Monitors | Show workspaces from all monitors instead of only the current one |
| Reverse Monitor Order | Reverse the order in which monitors are displayed when showing all monitors |
| Filled Pills (Vertical) | Use solid filled workspace pills instead of outlined borders |
| Icon Padding | Padding around the icon group inside each workspace pill. Set to 0 for a flush look |
| Item Spacing | Spacing between individual app icons within a workspace |
| Workspace Spacing | Spacing between workspace pills |

## Installation

### Via DMS Settings

Open settings (Mod + ,) → Plugins → Browse → search "Unified Taskbar"

### Via CLI

```bash
dms plugins install unifiedTaskbar
```

### Manual

```bash
git clone https://github.com/jslandau/dms-unified-taskbar.git \
  ~/.config/DankMaterialShell/plugins/UnifiedTaskbar
dms restart
```

## Requirements

- Dank Material Shell >= 1.2.0
- Niri, Hyprland, or Sway

Mango and other compositors are not supported. Legacy DWL code remains in the plugin but is not part of current supported compatibility.

## Development / Testing

The JavaScript tests use Node.js 18 or newer and the built-in `node:test` runner. Run the complete dependency-free suite (including workspace dispatch, TaskbarModel behavior, and QML-runner failure-mode tests) with:

```bash
node --test tests/*.test.js
```

The production-QML integration scenario requires Quickshell `0.3.1` (the installed runtime is Quickshell 0.3.1 on Arch Linux). It launches the standalone harness with an offscreen Qt surface and the software Qt Quick backend, so it does not require a running DMS session:

```bash
node tests/run-qml-tests.js
```

The runner fails on a missing `qs` executable, missing imports/runtime, assertion failures, non-zero exits, or a timeout; it does not silently skip integration coverage. To select a specific executable, use either supported override:

```bash
QS_EXECUTABLE=/path/to/qs node tests/run-qml-tests.js
# or
QS_TEST_EXECUTABLE=/path/to/qs node tests/run-qml-tests.js
```

The runner supplies `QT_QPA_PLATFORM=offscreen` and `QT_QUICK_BACKEND=software` and stages the production components in a unique temporary configuration, cleaned after each run. A warning that `WAYLAND_DISPLAY` is present while using offscreen mode is expected; destroyed-object warnings fail the suite.

Verified development runtime: Dank Material Shell `v1.5.3`, Quickshell `0.3.1`, and Niri `26.04` (`8ed0da4`). The full plugin smoke checklist is only partially completed (results below). Use this manual Niri checklist in both horizontal and vertical modes:

- Exercise grouped and ungrouped entries; switch between populated and empty workspaces.
- Focus and cycle windows, change titles, and verify highlights and titles are current.
- Close the first and middle entries; confirm the current action target is not stale.
- Move windows between workspaces and outputs; verify stable identity and correct membership.
- Toggle follow-focus, all-monitors, and reverse-monitor-order settings.
- Test left-click, middle-click, and right-click/context-menu actions.
- Record DMS/Quickshell versions and note any stale titles, incorrect highlights, or QML warnings.

The isolated harness does not replace this live-session validation and does not claim an automated Niri smoke result. Track this checklist as `niri_taskbar_smoke`: **partially completed**. Live validation on 2026-09-07 loaded the updated plugin in normal systemd-managed DMS, exercised 30 populated/empty workspace switches in each orientation, and restored the bottom bar. No taskbar-related TypeErrors, ReferenceErrors, binding loops, or destroyed-object warnings were found in the checked journal. The operator confirmed correct highlights, titles, and left-click behavior in horizontal non-compact mode. Vertical/compact visual checks, grouping/settings permutations, and window movement/close stress remain unverified; only one output was connected.

Before/after profiling was attempted with `qmlprofiler` attached to Quickshell's debug port, explicitly stopping recording and flushing before disconnecting. Each version ran the same 60-workspace-switch sequence. Both retry traces were saved with successful profiler exits, but contained many negative-duration ranges (54,642/114,176 before; 52,445/110,631 after), so **timing totals are not accepted as performance evidence**. Event counts support reduced reactive work: `entryData` evaluations 2,400 → 0, title evaluations 1,200 → 0, and focus-expression evaluations 2,400 → 160. These are single-run diagnostic counts, not a timing or FPS benchmark; trustworthy comparative timing and many-window close profiling remain pending. Traces and the old installed-plugin backup are under `~/.local/share/polytoken/sessions/0af42y-rack/live-validation/` (`before-retry.qtd`, `after.qtd`, `plugin-before/`). Normal DMS was restored with the updated plugin and debugging disabled.

The operator also verified middle-click close. The then-installed right-click menu showed only **Close**, which inspection confirmed was hard-coded rather than a Niri capability-discovery failure. The subsequent context-menu enhancement adds grouped-window selection, desktop-entry actions, and Close All. Live testing confirmed desktop actions (New Window), grouped-title selection, and Close All. Grouped actions initially failed because plugin-only reload retained an old EntryRecord component; diagnostic inspection showed the new methods were undefined. A full DMS restart loaded the new components and the operator confirmed both actions work. Restart DMS after changing dependent QML component APIs; plugin-only reload may retain cached dependencies. The menu background was made opaque after readability feedback.

The public model snapshot contains `compositor`, selected `workspaces`, the **complete** ordered `windows` list, and `groupByApp`. Callers do not supply keys: the production model derives native Niri keys from `niriWindowId` and otherwise assigns monotonic keys to the actual `toplevel` object. Older inputs without native IDs have object-lifetime stability only, not continuity across unidentified wrapper replacement. Snapshot collection still takes linear work on focus changes; unchanged entry models are retained. DWL retains the existing all-windows-on-client-tags approximation, with unavoidable output replication; workspace sorting is unchanged. The installed DMS 1.5.3 has renamed the legacy DWL service, so legacy DWL full-shell integration is not validated here.

Automated validation for this change: **32 Node tests and 8 real-Quickshell scenarios passed**. The QML scenarios cover keyed delegate reorder/removal, snapshot coalescing, populated active/focus/title updates, empty-workspace transitions, current-wrapper actions/grouped cycling, remove/re-add before retirement, and actual teardown with a queued reconciliation. Tests execute production JS and QML; they do not load DMS services or the full plugin UI.

## License

MIT
