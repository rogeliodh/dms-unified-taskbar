/* Pure, service-free taskbar snapshot normalization and structural comparison. */

function createIdentityState() {
    return { compositor: null, nextSyntheticId: 0, objectKeys: new Map(), liveObjects: new Set(), generation: 0 };
}

function resetIdentityState(state, compositor) {
    if (!state || typeof state !== "object") state = createIdentityState();
    state.compositor = compositor === undefined ? null : compositor;
    state.objectKeys = new Map();
    state.liveObjects = new Set();
    state.generation = (state.generation || 0) + 1;
    return state;
}

function ensureIdentityState(state, compositor) {
    if (!state || typeof state !== "object" || !(state.objectKeys instanceof Map)) state = createIdentityState();
    if (state.compositor !== compositor) resetIdentityState(state, compositor);
    return state;
}

function _objectOf(record) {
    if (!record || typeof record !== "object") return record;
    return record.toplevel === undefined ? record : record.toplevel;
}

function _nativeId(record) {
    return record && record.niriWindowId !== null && record.niriWindowId !== undefined;
}

function _nativeKey(compositor, id) {
    return String(compositor === undefined || compositor === null ? "unknown" : compositor) + ":niri:" + String(id);
}

function _syntheticKey(compositor, index) {
    return String(compositor === undefined || compositor === null ? "unknown" : compositor) + ":synthetic:" + String(index);
}

function identityForWindow(record, compositor, state) {
    state = ensureIdentityState(state, compositor);
    if (_nativeId(record)) return _nativeKey(compositor, record.niriWindowId);
    var object = _objectOf(record);
    if (!state.objectKeys.has(object)) {
        state.objectKeys.set(object, _syntheticKey(compositor, state.nextSyntheticId));
        state.nextSyntheticId += 1;
    }
    state.liveObjects.add(object);
    return state.objectKeys.get(object);
}

function normalizeAppId(value, normalizer) {
    var raw = value === null || value === undefined || value === "" ? "unknown" : value;
    if (typeof normalizer === "function") raw = normalizer(raw);
    return raw === null || raw === undefined || raw === "" ? "unknown" : String(raw);
}

/* Apps such as WhatsApp and Teams prefix the window title with their unread
   count, e.g. "(3) WhatsApp". The view turns the count into a badge and drops
   the prefix; the preview keeps the raw title. */
var _titleCountPrefix = /^\s*\((\d+)\)\s*/;

function splitTitleCount(title) {
    var raw = title === null || title === undefined ? "" : String(title);
    var match = _titleCountPrefix.exec(raw);
    if (!match) return { count: 0, title: raw, rawTitle: raw };
    var stripped = raw.slice(match[0].length);
    return { count: parseInt(match[1], 10) || 0, title: stripped === "" ? raw : stripped, rawTitle: raw };
}

/* A grouped entry reports the sum: two windows with "(1)" mean two unread
   conversations, not one. */
function _sumUnread(entry) {
    var total = 0;
    for (var i = 0; i < entry.windows.length; i++) total += entry.windows[i].unreadCount || 0;
    return total;
}

/* Build once per Hyprland snapshot; callers match the actual Wayland object. */
function buildHyprlandLookup(toplevels) {
    var values = Array.isArray(toplevels) ? toplevels : (toplevels && Array.isArray(toplevels.values) ? toplevels.values : []);
    var result = new Map();
    for (var i = 0; i < values.length; i++) {
        var item = values[i];
        if (item && item.wayland !== undefined && item.wayland !== null && !result.has(item.wayland))
            result.set(item.wayland, item.workspace ? item.workspace.id : undefined);
    }
    return result;
}

function _window(record, compositor, state, options) {
    record = record || {};
    var object = _objectOf(record);
    var workspaceId = record.workspaceId;
    if (workspaceId === undefined && options && options.hyprlandLookup && options.hyprlandLookup.has(object))
        workspaceId = options.hyprlandLookup.get(object);
    var parsedTitle = splitTitleCount(record.title);
    return {
        key: identityForWindow(record, compositor, state),
        toplevel: record.toplevel === undefined ? record : record.toplevel,
        niriWindowId: record.niriWindowId,
        workspaceId: workspaceId,
        appId: normalizeAppId(record.appId, options && options.normalizeAppId),
        title: parsedTitle.rawTitle,
        unreadCount: parsedTitle.count,
        focused: record.focused === true,
        activated: record.activated === true,
        source: record
    };
}

function _finishEntry(entry) {
    var first = entry.windows[0] || null;
    entry.toplevel = first ? first.toplevel : null;
    entry.title = first ? first.title : "";
    entry.focused = false;
    entry.activatedWindowIndex = -1;
    for (var i = 0; i < entry.windows.length; i++) {
        if (entry.windows[i].focused || entry.windows[i].activated) entry.focused = true;
        if (entry.activatedWindowIndex < 0 && entry.windows[i].activated) entry.activatedWindowIndex = i;
    }
    entry.unreadCount = _sumUnread(entry);
    return entry;
}

function _sameEntryDescriptor(a, b) {
    if (!a || !b || a.entryKey !== b.entryKey || a.appId !== b.appId || a.isGrouped !== b.isGrouped) return false;
    var aw = a.windows || [], bw = b.windows || [];
    if (aw.length !== bw.length) return false;
    for (var i = 0; i < aw.length; i++) if (!aw[i] || !bw[i] || aw[i].key !== bw[i].key) return false;
    return true;
}

function _sameWorkspaceDescriptor(a, b) {
    if (!a || !b || a.workspaceId !== b.workspaceId) return false;
    var ae = a.entries || [], be = b.entries || [];
    if (ae.length !== be.length) return false;
    for (var i = 0; i < ae.length; i++) if (!_sameEntryDescriptor(ae[i], be[i])) return false;
    return true;
}

function sameStructure(previous, next) {
    if (previous === next) return true;
    var a = previous && Array.isArray(previous.workspaces) ? previous.workspaces : [];
    var b = next && Array.isArray(next.workspaces) ? next.workspaces : [];
    if (!!(previous && previous.groupByApp) !== !!(next && next.groupByApp)
            || (previous && previous.groupSignature) !== (next && next.groupSignature)
            || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!_sameWorkspaceDescriptor(a[i], b[i])) return false;
    return true;
}

function compareStructure(previous, next) { return sameStructure(previous, next); }
function structuralEqual(previous, next) { return sameStructure(previous, next); }

var _emptyWindows = [];

function _copyWindowPayload(target, source) {
    if (!target) return source;
    target.key = source.key;
    target.toplevel = source.toplevel;
    target.niriWindowId = source.niriWindowId;
    target.workspaceId = source.workspaceId;
    target.appId = source.appId;
    target.title = source.title;
    target.unreadCount = source.unreadCount || 0;
    target.focused = source.focused;
    target.activated = source.activated;
    target.source = source.source;
    return target;
}

function _refreshEntry(entry) {
    var first = entry.windows[0] || null;
    entry.toplevel = first ? first.toplevel : null;
    entry.title = first ? first.title : "";
    entry.focused = false;
    entry.activatedWindowIndex = -1;
    for (var i = 0; i < entry.windows.length; i++) {
        if (entry.windows[i].focused || entry.windows[i].activated) entry.focused = true;
        if (entry.activatedWindowIndex < 0 && entry.windows[i].activated) entry.activatedWindowIndex = i;
    }
    entry.unreadCount = _sumUnread(entry);
}

function _refreshEntries(entries, wsWindows, grouped, ungroupSet) {
    if (!grouped) {
        for (var i = 0; i < wsWindows.length; i++) {
            _copyWindowPayload(entries[i].windows[0], wsWindows[i]);
            _refreshEntry(entries[i]);
        }
        return;
    }
    var groups = new Map();
    var singleton = new Map();
    for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        var record = entries[entryIndex];
        if (record.isGrouped) groups.set(record.groupKey !== undefined ? record.groupKey : record.appId, record);
        else if (record.windows[0]) singleton.set(record.windows[0].key, record);
    }
    var positions = new Map();
    for (var windowIndex = 0; windowIndex < wsWindows.length; windowIndex++) {
        var window = wsWindows[windowIndex];
        if (ungroupSet && ungroupSet.has(window.appId)) {
            var single = singleton.get(window.key);
            if (single) _copyWindowPayload(single.windows[0], window);
            continue;
        }
        var entry = groups.get(window.appId);
        if (!entry) continue;
        var position = positions.has(window.appId) ? positions.get(window.appId) : 0;
        _copyWindowPayload(entry.windows[position], window);
        positions.set(window.appId, position + 1);
    }
    for (var refreshIndex = 0; refreshIndex < entries.length; refreshIndex++) _refreshEntry(entries[refreshIndex]);
}

function _sourceMatches(workspace, wsWindows, groupSignature) {
    if (!workspace || workspace._groupByApp !== groupSignature || !workspace._sourceWindows) return false;
    var prior = workspace._sourceWindows;
    if (prior.length !== wsWindows.length) return false;
    for (var i = 0; i < wsWindows.length; i++) {
        if (prior[i].key !== wsWindows[i].key || prior[i].appId !== wsWindows[i].appId) return false;
    }
    return true;
}

function bucketSnapshot(snapshot, identityState, options) {
    snapshot = snapshot || {};
    options = options || {};
    if (!identityState || typeof identityState !== "object" || !(identityState.objectKeys instanceof Map))
        identityState = createIdentityState();
    var compositor = snapshot.compositor === undefined || snapshot.compositor === null ? "unknown" : String(snapshot.compositor);
    identityState = ensureIdentityState(identityState, compositor);
    identityState.liveObjects = new Set();

    // Normalize every complete sorted-toplevel before filtering, preserving
    // fallback identity while a window is off-screen.
    var sourceWindows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
    var windows = [], seen = new Set(), duplicateWindowKeys = [];
    for (var i = 0; i < sourceWindows.length; i++) {
        if (!sourceWindows[i]) continue;
        var current = _window(sourceWindows[i], compositor, identityState, {
            normalizeAppId: options.normalizeAppId || snapshot.normalizeAppId,
            hyprlandLookup: options.hyprlandLookup
        });
        if (seen.has(current.key)) { duplicateWindowKeys.push(current.key); continue; }
        seen.add(current.key);
        windows.push(current);
    }
    var stale = [];
    identityState.objectKeys.forEach(function (key, object) { if (!identityState.liveObjects.has(object)) stale.push(object); });
    for (var staleIndex = 0; staleIndex < stale.length; staleIndex++) identityState.objectKeys.delete(stale[staleIndex]);

    var selected = [], byId = new Map();
    var sourceWorkspaces = Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [];
    for (var workspaceIndex = 0; workspaceIndex < sourceWorkspaces.length; workspaceIndex++) {
        var source = sourceWorkspaces[workspaceIndex];
        if (!source || source.workspaceId === undefined || source.workspaceId === null || byId.has(source.workspaceId)) continue;
        var workspace = { workspaceId: source.workspaceId, workspace: source.workspace, active: source.active === true,
            hasClients: source.hasClients === true, entries: null };
        byId.set(workspace.workspaceId, workspace);
        selected.push(workspace);
    }
    var windowsByWorkspace = new Map();
    for (var windowIndex = 0; windowIndex < windows.length; windowIndex++) {
        var win = windows[windowIndex];
        if (!windowsByWorkspace.has(win.workspaceId)) windowsByWorkspace.set(win.workspaceId, []);
        windowsByWorkspace.get(win.workspaceId).push(win);
    }

    var previous = options.previousBucket;
    var previousVisible = previous && Array.isArray(previous.workspaces) ? previous.workspaces : [];
    var previousById = new Map();
    for (var previousIndex = 0; previousIndex < previousVisible.length; previousIndex++)
        previousById.set(previousVisible[previousIndex].workspaceId, previousVisible[previousIndex]);
    var grouped = snapshot.groupByApp === true;
    var ungroupAppIds = Array.isArray(snapshot.ungroupAppIds) ? snapshot.ungroupAppIds.map(String) : [];
    var ungroupSet = new Set(ungroupAppIds);
    // Window entries are only reusable when the grouping *signature* (on/off +
    // the ungroup list) is unchanged, so an ungroupAppIds edit rebuilds them.
    var groupSignature = (grouped ? "1" : "0") + "|" + ungroupAppIds.slice().sort().join("\u0000");
    var commonDwlWindows = compositor.toLowerCase() === "dwl" ? windows : null;
    var commonDwlEntries = null;
    if (commonDwlWindows && commonDwlWindows.length > 0) {
        // An active empty tag can precede client tags. Find a client-bearing
        // source rather than assuming the first visible tag owns the common list.
        var priorDwl = null;
        for (var dwlIndex = 0; dwlIndex < previousVisible.length; dwlIndex++) {
            if (previousVisible[dwlIndex].hasClients) { priorDwl = previousVisible[dwlIndex]; break; }
        }
        if (_sourceMatches(priorDwl, commonDwlWindows, groupSignature)) {
            _refreshEntries(priorDwl.entries, commonDwlWindows, grouped, ungroupSet);
            commonDwlEntries = priorDwl.entries;
        } else {
            commonDwlEntries = _makeEntries(commonDwlWindows, grouped, ungroupSet);
        }
    }

    var visibleScratch = [];
    for (var selectedIndex = 0; selectedIndex < selected.length; selectedIndex++) {
        var currentWorkspace = selected[selectedIndex];
        var wsWindows = commonDwlWindows
            ? (currentWorkspace.hasClients ? commonDwlWindows : _emptyWindows)
            : (windowsByWorkspace.get(currentWorkspace.workspaceId) || _emptyWindows);
        if (wsWindows.length === 0 && !currentWorkspace.active) continue;
        var priorWorkspace = previousById.get(currentWorkspace.workspaceId);
        var sourceMatches = _sourceMatches(priorWorkspace, wsWindows, groupSignature);
        if (sourceMatches) {
            // No entry/window arrays are allocated on this path. Refresh the
            // existing payload objects and retain all structural references.
            _refreshEntries(priorWorkspace.entries, wsWindows, grouped, ungroupSet);
            priorWorkspace.workspace = currentWorkspace.workspace;
            priorWorkspace.active = currentWorkspace.active;
            priorWorkspace.hasClients = currentWorkspace.hasClients;
            priorWorkspace._sourceWindows = wsWindows;
            visibleScratch.push(priorWorkspace);
            continue;
        }
        var entries;
        if (wsWindows.length === 0)
            entries = [];
        else if (commonDwlWindows && currentWorkspace.hasClients && commonDwlEntries)
            entries = _cloneEntries(commonDwlEntries);
        else
            entries = _makeEntries(wsWindows, grouped, ungroupSet);
        currentWorkspace.entries = entries;
        currentWorkspace._sourceWindows = wsWindows;
        currentWorkspace._groupByApp = groupSignature;
        visibleScratch.push(currentWorkspace);
    }

    var structureSame = !!previous && previous.groupSignature === groupSignature && previousVisible.length === visibleScratch.length;
    if (structureSame) {
        for (var structureIndex = 0; structureIndex < visibleScratch.length; structureIndex++) {
            if (previousVisible[structureIndex] !== visibleScratch[structureIndex]) { structureSame = false; break; }
        }
    }
    var visible = structureSame ? previousVisible : visibleScratch;
    return { compositor: compositor, groupByApp: grouped, groupSignature: groupSignature, ungroupAppIds: ungroupAppIds,
        windows: windows, workspaces: visible,
        selectedWorkspaces: selected, duplicateWindowKeys: duplicateWindowKeys, identityState: identityState };
}

function normalizeSnapshot(snapshot, identityState, options) { return bucketSnapshot(snapshot, identityState, options); }
function reconcileSnapshot(snapshot, identityState, options) { return bucketSnapshot(snapshot, identityState, options); }

function _makeEntries(wsWindows, grouped, ungroupSet) {
    var entries = [];
    if (grouped) {
        var groups = new Map();
        for (var i = 0; i < wsWindows.length; i++) {
            var win = wsWindows[i];
            // Apps listed in ungroupAppIds are never merged: one entry per window.
            if (ungroupSet && ungroupSet.has(win.appId)) {
                entries.push(_finishEntry({ entryKey: win.key, appId: win.appId, isGrouped: false, windows: [win] }));
                continue;
            }
            var entry = groups.get(win.appId);
            if (!entry) {
                entry = { entryKey: "group:" + win.appId, appId: win.appId, groupKey: win.appId, isGrouped: true, windows: [] };
                groups.set(win.appId, entry);
                entries.push(entry);
            }
            entry.windows.push(win);
        }
        for (var finishIndex = 0; finishIndex < entries.length; finishIndex++)
            if (entries[finishIndex].isGrouped) _finishEntry(entries[finishIndex]);
    } else {
        for (var j = 0; j < wsWindows.length; j++) {
            var ungrouped = wsWindows[j];
            entries.push(_finishEntry({ entryKey: ungrouped.key, appId: ungrouped.appId, isGrouped: false, windows: [ungrouped] }));
        }
    }
    return entries;
}

function _cloneEntries(entries) {
    // DWL tags deliberately share normalized payloads: every client-bearing tag
    // has the same source order/app IDs. QML records and wrapper arrays remain
    // independent; prior bucket payloads are mutable reconciliation state.
    var result = [];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        result.push({ entryKey: entry.entryKey, appId: entry.appId, groupKey: entry.groupKey, isGrouped: entry.isGrouped, windows: entry.windows.slice(),
            toplevel: entry.toplevel, title: entry.title, unreadCount: entry.unreadCount, focused: entry.focused, activatedWindowIndex: entry.activatedWindowIndex });
    }
    return result;
}

/* Width-aware layout planning for the horizontal taskbar.
 *
 * The DankBar lays its left, center and right sections out independently, so a
 * left section that grows past the center/right widgets is painted underneath
 * them. The taskbar therefore receives the width DMS makes available and has to
 * fit inside it. Labels shrink first; they never disappear automatically here,
 * because compact mode is the explicit icons-only setting. If the minimum label
 * still does not fit, trailing entries move into a +N overflow menu.
 */
var TASKBAR_DEFAULT_MAX_LABEL_WIDTH = 120;
var TASKBAR_MIN_LABEL_WIDTH = 32;

function _layoutNumber(value, fallback) {
    var number = Number(value);
    return value !== undefined && value !== null && isFinite(number) && number >= 0 ? number : fallback;
}

function _layoutMetrics(metrics) {
    metrics = metrics || {};
    return {
        budget: _layoutNumber(metrics.budget, Infinity),
        compact: metrics.compact === true,
        iconSize: _layoutNumber(metrics.iconSize, 24),
        iconPadding: _layoutNumber(metrics.iconPadding, 4),
        itemSpacing: _layoutNumber(metrics.itemSpacing, 2),
        workspaceSpacing: _layoutNumber(metrics.workspaceSpacing, 4),
        pillInset: _layoutNumber(metrics.pillInset, 4),
        minLabelWidth: _layoutNumber(metrics.minLabelWidth, TASKBAR_MIN_LABEL_WIDTH),
        maxLabelWidth: _layoutNumber(metrics.maxLabelWidth, TASKBAR_DEFAULT_MAX_LABEL_WIDTH),
        overflowWidth: _layoutNumber(metrics.overflowWidth, 40)
    };
}

function _layoutEntryCount(workspaces) {
    var count = 0;
    for (var i = 0; i < workspaces.length; i++) {
        var entries = workspaces[i] && workspaces[i].entries ? workspaces[i].entries : [];
        count += entries.length;
    }
    return count;
}

function _layoutWidth(workspaces, kept, metrics, entryWidth, overflowVisible, keepActiveEmpty) {
    // Width of the actual pill row. `kept` is a [workspace][entry] matrix of
    // booleans (null means every entry), so the planner can measure a trial
    // layout without touching the production records.
    var total = 0;
    var pills = 0;
    for (var i = 0; i < workspaces.length; i++) {
        var workspace = workspaces[i];
        var entries = workspace && workspace.entries ? workspace.entries : [];
        var count = 0;
        for (var j = 0; j < entries.length; j++) {
            if (!kept || kept[i][j]) count += 1;
        }
        if (count === 0) {
            if (workspace && workspace.active && keepActiveEmpty) {
                total += metrics.pillInset * 2;
                pills += 1;
            }
            continue;
        }
        total += count * entryWidth + (count - 1) * metrics.itemSpacing + metrics.pillInset * 2;
        pills += 1;
    }
    if (overflowVisible) {
        total += metrics.overflowWidth;
        pills += 1;
    }
    if (pills > 1) total += (pills - 1) * metrics.workspaceSpacing;
    return total;
}

function _layoutBaseEntryWidth(metrics) {
    return metrics.compact ? metrics.iconSize + metrics.iconPadding * 2
                           : metrics.iconSize + metrics.iconPadding * 3;
}

function _layoutBaseWidth(workspaces, metrics) {
    // Everything except the labels: icons, paddings, inter-entry spacing and
    // workspace-pill chrome. An active workspace with no clients keeps its
    // (empty) pill, exactly like the view does.
    return _layoutWidth(workspaces, null, metrics, _layoutBaseEntryWidth(metrics), false, true);
}

function _clampLabelWidth(value, metrics) {
    if (!isFinite(value)) return metrics.maxLabelWidth;
    return Math.max(metrics.minLabelWidth, Math.min(metrics.maxLabelWidth, Math.floor(value)));
}

function _copyWorkspace(workspace, entries) {
    return {
        workspaceId: workspace.workspaceId,
        workspace: workspace.workspace,
        active: workspace.active,
        hasClients: workspace.hasClients,
        entries: entries
    };
}

function planTaskbarLayout(workspaces, metrics) {
    workspaces = Array.isArray(workspaces) ? workspaces : [];
    metrics = _layoutMetrics(metrics);
    var entryCount = _layoutEntryCount(workspaces);
    var labelWidth = 0;
    if (!metrics.compact && entryCount > 0) {
        var availableForLabels = metrics.budget - _layoutBaseWidth(workspaces, metrics);
        labelWidth = _clampLabelWidth(availableForLabels / entryCount, metrics);
    }
    var entryWidth = metrics.compact ? metrics.iconSize + metrics.iconPadding * 2
                                     : metrics.iconSize + metrics.iconPadding * 3 + labelWidth;
    var allVisibleWidth = _layoutWidth(workspaces, null, metrics, entryWidth, false, true);
    if (!isFinite(metrics.budget) || allVisibleWidth <= metrics.budget) {
        return {
            labelWidth: labelWidth,
            entryWidth: entryWidth,
            visibleWorkspaces: workspaces,
            hiddenEntries: [],
            overflowCount: 0
        };
    }

    // The minimum label still does not fit: move trailing entries into the
    // overflow menu instead of drawing underneath the next widget. Focused
    // entries are the last ones to leave the bar.
    var kept = [];
    for (var workspaceIndex = 0; workspaceIndex < workspaces.length; workspaceIndex++) {
        var workspaceEntries = workspaces[workspaceIndex] && workspaces[workspaceIndex].entries
            ? workspaces[workspaceIndex].entries : [];
        var keptEntries = [];
        for (var entryIndex = 0; entryIndex < workspaceEntries.length; entryIndex++) keptEntries.push(true);
        kept.push(keptEntries);
    }
    var hiddenCount = 0;
    var width = allVisibleWidth;
    var keepActiveEmpty = true;

    function removeTrailing(predicate) {
        for (var wi = workspaces.length - 1; wi >= 0; wi--) {
            var entries = workspaces[wi] && workspaces[wi].entries ? workspaces[wi].entries : [];
            for (var ei = entries.length - 1; ei >= 0; ei--) {
                if (!kept[wi][ei] || !predicate(entries[ei])) continue;
                kept[wi][ei] = false;
                hiddenCount += 1;
                width = _layoutWidth(workspaces, kept, metrics, entryWidth, true, keepActiveEmpty);
                if (width <= metrics.budget) return true;
            }
        }
        return false;
    }

    if (!removeTrailing(function (entry) { return !entry.focused; }))
        removeTrailing(function () { return true; });

    if (width > metrics.budget) {
        // Keep the +N pill reachable even when the active workspace pill itself
        // no longer fits (very narrow bar / very large font).
        keepActiveEmpty = false;
        width = _layoutWidth(workspaces, kept, metrics, entryWidth, true, keepActiveEmpty);
    }

    var visibleWorkspaces = [];
    var hiddenEntries = [];
    for (var visibleIndex = 0; visibleIndex < workspaces.length; visibleIndex++) {
        var workspace = workspaces[visibleIndex];
        var entries = workspace && workspace.entries ? workspace.entries : [];
        var visibleEntries = [];
        for (var candidateIndex = 0; candidateIndex < entries.length; candidateIndex++) {
            var entry = entries[candidateIndex];
            if (kept[visibleIndex][candidateIndex]) {
                visibleEntries.push(entry);
            } else {
                hiddenEntries.push({
                    workspaceId: workspace.workspaceId,
                    workspace: workspace.workspace,
                    entry: entry
                });
            }
        }
        if (visibleEntries.length > 0 || (workspace.active && keepActiveEmpty))
            visibleWorkspaces.push(_copyWorkspace(workspace, visibleEntries));
    }

    return {
        labelWidth: labelWidth,
        entryWidth: entryWidth,
        visibleWorkspaces: visibleWorkspaces,
        hiddenEntries: hiddenEntries,
        overflowCount: hiddenEntries.length
    };
}






    
