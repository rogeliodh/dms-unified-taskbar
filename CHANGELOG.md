# Changelog

## Unreleased

- Narrow advertised compositor compatibility to Niri, Hyprland, and Sway. Mango and other compositors, including legacy DWL, are not currently supported; existing dispatch code is unchanged.
- Use theme-derived font sizes for missing-icon fallback letters and grouped-window count badges. Count badges grow with their text while retaining a 14px minimum size.

## 1.2.0 — 2026-09-07

### Performance

- Reduce unnecessary taskbar updates by bucketing windows in a linear pass instead of repeatedly scanning windows for every workspace. Hyprland membership lookups are built once per snapshot.
- Keep ungrouped window keys stable across insertion, removal, and reordering; native Niri IDs also preserve identity when window wrappers are replaced.
- Update focus, active-workspace state, titles, and action targets through persistent records without rebuilding unchanged entry models.
- Preserve the existing DWL tag-membership approximation. These are targeted efficiency improvements; no numeric timing or FPS gain is claimed.

### Context menu

- With **Group by App** enabled, select a specific grouped window by title or close an individual window from the menu.
- Show application-provided desktop-entry actions, such as **New Window**, when available.
- Add **Close All** for entries containing multiple grouped windows, scoped to the selected workspace/app group. Existing **Close** remains available for the representative window.
- Use an opaque menu background for readability, scroll long menus, and keep menus within the screen in horizontal and vertical layouts.
- Resolve window actions against current wrappers to avoid stale targets after window updates.

### Testing and upgrade notes

- Add production-JavaScript behavioral tests and a real Quickshell model/delegate integration harness, including identity, notification, lifecycle, action-target, and runner-failure coverage.
- Live Niri validation confirmed horizontal highlights/titles, left-click activation, middle-click close, grouped-window selection, desktop-entry New Window, and Close All. See README for remaining validation limits.
- **Restart DMS after upgrading.** Plugin-only reload can retain cached dependent QML components and leave the new menu actions unavailable.
- Minimum DMS requirement remains **1.2.0**; no new settings are introduced.
