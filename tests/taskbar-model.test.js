"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// TaskbarModel.js is ordinary JavaScript, not a CommonJS module. This loader
// evaluates the production source unchanged and explicitly exposes the top-level
// functions used by the behavioral tests. QML-only directives must fail parsing.
function loadProductionModel() {
    const filename = path.join(__dirname, "..", "TaskbarModel.js");
    const source = readFileSync(filename, "utf8");
    const exposed = [
        "createIdentityState",
        "resetIdentityState",
        "ensureIdentityState",
        "identityForWindow",
        "normalizeAppId",
        "buildHyprlandLookup",
        "bucketSnapshot",
        "normalizeSnapshot",
        "reconcileSnapshot",
        "sameStructure",
        "compareStructure",
        "structuralEqual",
        "splitTitleCount",
    ];
    const context = vm.createContext({});
    const exportSource = `${source}
this.__taskbarModelCountMakeEntries = function (callback) {
    var count = 0;
    var original = _makeEntries;
    _makeEntries = function (windows, grouped) {
        count++;
        return original(windows, grouped);
    };
    try {
        callback();
    } finally {
        _makeEntries = original;
    }
    return count;
};
this.__taskbarModelExports = { ${exposed
        .map(name => `${name}: ${name}`)
        .join(", ")}, countMakeEntries: this.__taskbarModelCountMakeEntries };`;
    new vm.Script(exportSource, { filename }).runInContext(context);
    return context.__taskbarModelExports;
}

const model = loadProductionModel();

function windowRecord(id, workspaceId, appId, options = {}) {
    const toplevel = options.toplevel || { name: id };
    return {
        toplevel,
        workspaceId,
        appId,
        niriWindowId: options.niriWindowId,
        title: options.title || id,
        focused: options.focused === true,
        activated: options.activated === true,
    };
}

function workspace(workspaceId, options = {}) {
    return {
        workspaceId,
        workspace: options.workspace || { id: workspaceId },
        active: options.active === true,
        hasClients: options.hasClients === true,
    };
}

function snapshot(options = {}) {
    return {
        compositor: options.compositor || "niri",
        groupByApp: options.groupByApp === true,
        ungroupAppIds: Array.isArray(options.ungroupAppIds) ? options.ungroupAppIds : [],
        workspaces: options.workspaces || [],
        windows: options.windows || [],
    };
}

function bucket(input, state, options) {
    return model.bucketSnapshot(input, state || model.createIdentityState(), options);
}

function entryFor(result, workspaceId, index = 0) {
    const item = result.workspaces.find(workspaceItem => workspaceItem.workspaceId === workspaceId);
    assert.ok(item, `workspace ${workspaceId} should be visible`);
    return item.entries[index];
}

function ids(items) {
    return Array.from(items, item => item.workspaceId);
}

function countedValues(values) {
    let indexedReads = 0;
    const array = new Proxy(values, {
        get(target, property, receiver) {
            if (/^\d+$/.test(String(property))) indexedReads++;
            return Reflect.get(target, property, receiver);
        },
    });
    return {
        values: array,
        indexedReads: () => indexedReads,
    };
}

test("taskbar_model_vm_loader_exposes_production_functions", () => {
    for (const name of ["bucketSnapshot", "buildHyprlandLookup", "sameStructure", "createIdentityState"]) {
        assert.equal(typeof model[name], "function", `${name} must be a production export exposed by the VM loader`);
    }
});

test("bucket_order_and_membership", () => {
    const zero = windowRecord("zero", 0, "zero", { niriWindowId: "zero" });
    const first = windowRecord("first", 7, "editor", { niriWindowId: "first" });
    const second = windowRecord("second", 7, "terminal", { niriWindowId: "second" });
    const unknown = windowRecord("unknown", 99, "ignored", { niriWindowId: "unknown" });
    const result = bucket(snapshot({
        workspaces: [
            workspace(7),
            workspace(0),
            workspace(8),
        ],
        windows: [zero, first, second, unknown],
    }));

    assert.deepEqual(ids(result.workspaces), [7, 0], "selected workspace order is preserved and empty inactive workspaces are omitted");
    assert.deepEqual(Array.from(result.workspaces[0].entries, entry => entry.toplevel), [first.toplevel, second.toplevel]);
    assert.equal(entryFor(result, 0).toplevel, zero.toplevel, "numeric workspace ID zero is matched strictly");
    assert.equal(result.workspaces.some(item => item.workspaceId === 99), false, "unknown membership is omitted");
});

test("group_first_occurrence_order", () => {
    const windows = [
        windowRecord("terminal-1", 1, "terminal", { niriWindowId: "terminal-1" }),
        windowRecord("editor", 1, "editor", { niriWindowId: "editor" }),
        windowRecord("terminal-2", 1, "terminal", { niriWindowId: "terminal-2" }),
    ];
    const result = bucket(snapshot({
        groupByApp: true,
        workspaces: [workspace(1)],
        windows,
    }));
    const entries = result.workspaces[0].entries;

    assert.deepEqual(Array.from(entries, entry => entry.appId), ["terminal", "editor"]);
    assert.deepEqual(Array.from(entries[0].windows, item => item.toplevel), [
        windows[0].toplevel,
        windows[2].toplevel,
    ], "windows within a group retain sortedToplevels order");
    assert.equal(entries[0].toplevel, windows[0].toplevel, "the first window remains the representative");
});

test("ungroup_app_ids_never_merge_listed_apps", () => {
    const windows = [
        windowRecord("browser-1", 1, "browser", { niriWindowId: "browser-1" }),
        windowRecord("editor", 1, "editor", { niriWindowId: "editor" }),
        windowRecord("browser-2", 1, "browser", { niriWindowId: "browser-2" }),
        windowRecord("editor-2", 1, "editor", { niriWindowId: "editor-2" }),
    ];
    const result = bucket(snapshot({
        groupByApp: true,
        ungroupAppIds: ["browser"],
        workspaces: [workspace(1)],
        windows,
    }));
    const entries = result.workspaces[0].entries;

    assert.deepEqual(Array.from(entries, entry => entry.appId), ["browser", "editor", "browser"]);
    assert.equal(entries[0].isGrouped, false);
    assert.equal(entries[0].windows.length, 1);
    assert.equal(entries[0].entryKey, entries[0].windows[0].key, "an ungrouped window keeps its own entry key");
    assert.equal(entries[2].windows.length, 1);
    assert.equal(entries[1].isGrouped, true);
    assert.deepEqual(Array.from(entries[1].windows, item => item.toplevel), [windows[1].toplevel, windows[3].toplevel]);
});

test("ungroup_app_ids_change_rebuilds_structure", () => {
    const state = model.createIdentityState();
    const windows = [
        windowRecord("browser-1", 1, "browser", { niriWindowId: "browser-1" }),
        windowRecord("browser-2", 1, "browser", { niriWindowId: "browser-2" }),
    ];
    const grouped = bucket(snapshot({ groupByApp: true, workspaces: [workspace(1)], windows }), state);
    const ungrouped = bucket(snapshot({
        groupByApp: true, ungroupAppIds: ["browser"], workspaces: [workspace(1)], windows,
    }), state);

    assert.equal(grouped.workspaces[0].entries.length, 1);
    assert.equal(ungrouped.workspaces[0].entries.length, 2);
    assert.equal(model.sameStructure(grouped, ungrouped), false);
});

test("empty_active_visibility", () => {
    const result = bucket(snapshot({
        workspaces: [
            workspace(1, { active: false }),
            workspace(2, { active: true }),
            workspace(3, { active: false }),
        ],
        windows: [windowRecord("window", 1, "editor", { niriWindowId: "window" })],
    }));

    assert.deepEqual(ids(result.workspaces), [1, 2]);
    assert.equal(result.workspaces[1].entries.length, 0, "an empty active workspace remains visible");
    assert.equal(result.workspaces[1].active, true);
});

test("dwl_shared_membership", () => {
    const windows = [
        windowRecord("one", 999, "one", { niriWindowId: "one" }),
        windowRecord("two", 998, "two", { niriWindowId: "two" }),
    ];
    const result = bucket(snapshot({
        compositor: "dwl",
        workspaces: [
            workspace(1, { hasClients: true }),
            workspace(2, { hasClients: false, active: true }),
            workspace(3, { hasClients: true }),
        ],
        windows,
    }));

    assert.deepEqual(ids(result.workspaces), [1, 2, 3]);
    assert.deepEqual(Array.from(result.workspaces[0].entries, entry => entry.toplevel), [windows[0].toplevel, windows[1].toplevel]);
    assert.deepEqual(Array.from(result.workspaces[1].entries), [], "an active tag without clients remains empty");
    assert.deepEqual(Array.from(result.workspaces[2].entries, entry => entry.toplevel), [windows[0].toplevel, windows[1].toplevel]);
});

test("hyprland_linear_lookup_counts", () => {
    const hyprlandWindows = Array.from({ length: 37 }, (_, index) => ({
        wayland: { name: `wayland-${index}` },
        workspace: { id: index % 3 },
    }));
    const countedHyprland = countedValues(hyprlandWindows);
    const lookup = model.buildHyprlandLookup(countedHyprland.values);
    assert.equal(countedHyprland.indexedReads(), hyprlandWindows.length, "Hyprland values are visited once while building the lookup");

    let hasCalls = 0;
    let getCalls = 0;
    const countingLookup = {
        has(object) {
            hasCalls++;
            return lookup.has(object);
        },
        get(object) {
            getCalls++;
            return lookup.get(object);
        },
    };
    const windowSource = countedValues(hyprlandWindows.map((item, index) => ({
        toplevel: item.wayland,
        appId: `app-${index}`,
    })));
    const result = bucket(snapshot({
        compositor: "hyprland",
        workspaces: [workspace(0), workspace(1), workspace(2)],
        windows: windowSource.values,
    }), model.createIdentityState(), { hyprlandLookup: countingLookup });

    assert.ok(windowSource.indexedReads() <= hyprlandWindows.length * 2, "normal window matching remains linear in the number of windows");
    assert.equal(hasCalls, hyprlandWindows.length, "workspace matching performs one lookup per window");
    assert.equal(getCalls, hyprlandWindows.length, "matching retrieves each workspace once");
    assert.equal(result.windows.length, hyprlandWindows.length);
    assert.equal(result.workspaces.reduce((count, item) => count + item.entries.length, 0), hyprlandWindows.length);
});

test("stable_keys_lifecycle", () => {
    const state = model.createIdentityState();
    const firstWindow = { name: "first" };
    const secondWindow = { name: "second" };
    const thirdWindow = { name: "third" };
    const first = [
        windowRecord("first", 1, "first", { toplevel: firstWindow }),
        windowRecord("second", 1, "second", { toplevel: secondWindow }),
        windowRecord("third", 1, "third", { toplevel: thirdWindow }),
    ];
    const initial = bucket(snapshot({ workspaces: [workspace(1)], windows: first }), state);
    const initialKeys = new Map(initial.windows.map(item => [item.toplevel, item.key]));

    const afterRemoval = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [first[2], first[1]],
    }), state);
    assert.equal(afterRemoval.windows[0].key, initialKeys.get(thirdWindow), "reordering retains the third window key");
    assert.equal(afterRemoval.windows[1].key, initialKeys.get(secondWindow), "removing a preceding window does not shift keys");

    const moved = windowRecord("second", 2, "second", { toplevel: secondWindow });
    const afterMove = bucket(snapshot({
        workspaces: [workspace(2)],
        windows: [moved],
    }), state);
    assert.equal(afterMove.windows[0].key, initialKeys.get(secondWindow), "workspace movement retains object-lifetime identity");
    assert.equal(state.objectKeys.has(thirdWindow), false, "closed windows are pruned from the identity map");

    const replacementObject = { name: "new-window" };
    const replacement = bucket(snapshot({
        workspaces: [workspace(2)],
        windows: [windowRecord("new-window", 2, "new", { toplevel: replacementObject })],
    }), state);
    assert.notEqual(replacement.windows[0].key, initialKeys.get(thirdWindow), "synthetic keys are never reused");
});

test("niri_wrapper_replacement", () => {
    const state = model.createIdentityState();
    const original = windowRecord("old", 1, "editor", {
        niriWindowId: 42,
        title: "Old title",
        toplevel: { generation: 1 },
    });
    const first = bucket(snapshot({ workspaces: [workspace(1)], windows: [original] }), state);
    const replacement = windowRecord("new", 1, "editor", {
        niriWindowId: 42,
        title: "New title",
        focused: true,
        toplevel: { generation: 2 },
    });
    const second = bucket(snapshot({ workspaces: [workspace(1)], windows: [replacement] }), state);

    assert.equal(first.windows[0].key, "niri:niri:42");
    assert.equal(second.windows[0].key, first.windows[0].key, "native Niri identity survives wrapper replacement");
    assert.equal(entryFor(second, 1).toplevel, replacement.toplevel, "the current wrapper is the representative");
    assert.equal(entryFor(second, 1).title, "New title");
    assert.equal(entryFor(second, 1).focused, true);
});

test("identity_cleanup_and_duplicate_guard", () => {
    const state = model.createIdentityState();
    const duplicateA = windowRecord("a", 1, "editor", { niriWindowId: "same", toplevel: { generation: 1 } });
    const duplicateB = windowRecord("b", 1, "editor", { niriWindowId: "same", toplevel: { generation: 2 } });
    const duplicateResult = bucket(snapshot({ workspaces: [workspace(1)], windows: [duplicateA, duplicateB] }), state);

    assert.equal(duplicateResult.windows.length, 1, "duplicate native identities retain the first occurrence");
    assert.deepEqual(Array.from(duplicateResult.duplicateWindowKeys), ["niri:niri:same"]);
    assert.equal(entryFor(duplicateResult, 1).toplevel, duplicateA.toplevel);

    const transientObject = { name: "transient" };
    bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [windowRecord("transient", 1, "app", { toplevel: transientObject })],
    }), state);
    assert.equal(state.objectKeys.has(transientObject), true);
    bucket(snapshot({ workspaces: [workspace(1)], windows: [] }), state);
    assert.equal(state.objectKeys.has(transientObject), false, "identity cleanup removes objects absent from complete input");
});

test("focus_title_and_native_wrapper_only_refresh_without_entry_allocations", () => {
    const state = model.createIdentityState();
    const first = windowRecord("first", 1, "editor", {
        niriWindowId: "first",
        title: "before",
        focused: true,
        toplevel: { generation: 1 },
    });
    const before = bucket(snapshot({ workspaces: [workspace(1)], windows: [first] }), state);

    const focusTitle = windowRecord("first", 1, "editor", {
        niriWindowId: "first",
        title: "after",
        focused: false,
        toplevel: { generation: 2 },
    });
    let focusedResult;
    const focusTitleAllocations = model.countMakeEntries(() => {
        focusedResult = bucket(snapshot({ workspaces: [workspace(1)], windows: [focusTitle] }), state, { previousBucket: before });
    });
    assert.equal(focusTitleAllocations, 0, "focus/title and a native wrapper replacement refresh existing entries");
    assert.equal(entryFor(focusedResult, 1).title, "after");
    assert.equal(entryFor(focusedResult, 1).toplevel, focusTitle.toplevel);
});

test("focus_only_preserves_structure", () => {
    const state = model.createIdentityState();
    const firstWindow = windowRecord("first", 1, "editor", {
        niriWindowId: "first",
        title: "before",
        focused: true,
    });
    const secondWindow = windowRecord("second", 2, "terminal", {
        niriWindowId: "second",
        title: "terminal",
    });
    const before = bucket(snapshot({
        workspaces: [workspace(1, { active: true }), workspace(2)],
        windows: [firstWindow, secondWindow],
    }), state);
    const after = bucket(snapshot({
        workspaces: [workspace(1, { active: false }), workspace(2, { active: true })],
        windows: [
            windowRecord("first", 1, "editor", { niriWindowId: "first", title: "after", focused: false }),
            windowRecord("second", 2, "terminal", { niriWindowId: "second", title: "terminal", focused: true }),
        ],
    }), state, { previousBucket: before });

    assert.equal(model.sameStructure(before, after), true, "focus, active state, and titles are not structural");
    assert.equal(before.workspaces[0].entries[0].windows[0].key, after.workspaces[0].entries[0].windows[0].key);
    assert.equal(after.workspaces, before.workspaces, "focus-only updates retain the outer workspace array");
    assert.equal(after.workspaces[0], before.workspaces[0], "focus-only updates retain populated workspace records");
    assert.equal(after.workspaces[0].entries, before.workspaces[0].entries, "focus-only updates retain entry arrays");
    assert.equal(after.workspaces[0].entries[0], before.workspaces[0].entries[0], "focus-only updates retain entry records");
    assert.equal(after.workspaces[1].entries[0].focused, true);
    assert.equal(after.workspaces[0].entries[0].title, "after");
});

test("replacement_payload_refresh", () => {
    const state = model.createIdentityState();
    const beforeWrapper = { generation: 1 };
    const afterWrapper = { generation: 2 };
    const before = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [windowRecord("editor", 1, "editor", {
            niriWindowId: 9,
            title: "before",
            toplevel: beforeWrapper,
        })],
    }), state);
    const after = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [windowRecord("editor", 1, "editor", {
            niriWindowId: 9,
            title: "after",
            focused: true,
            activated: true,
            toplevel: afterWrapper,
        })],
    }), state);

    assert.equal(model.sameStructure(before, after), true);
    const beforeEntry = entryFor(before, 1);
    const afterEntry = entryFor(after, 1);
    assert.equal(beforeEntry.entryKey, afterEntry.entryKey);
    assert.equal(afterEntry.toplevel, afterWrapper, "payload points at the replacement wrapper");
    assert.equal(afterEntry.title, "after");
    assert.equal(afterEntry.focused, true);
    assert.equal(afterEntry.activatedWindowIndex, 0);
});

test("unrelated_empty_active_workspace_change_does_not_rebuild_populated_entries", () => {
    const state = model.createIdentityState();
    const windows = [
        windowRecord("one", 1, "editor", { niriWindowId: "one" }),
        windowRecord("two", 1, "terminal", { niriWindowId: "two" }),
    ];
    const before = bucket(snapshot({
        workspaces: [workspace(1), workspace(2, { active: true })],
        windows,
    }), state);
    const afterSnapshot = snapshot({
        workspaces: [workspace(1), workspace(2, { active: true, workspace: { id: 2, renamed: true } })],
        windows: windows.map(item => windowRecord(item.title, item.workspaceId, item.appId, {
            niriWindowId: item.niriWindowId,
            toplevel: item.toplevel,
        })),
    });
    let after;
    const allocations = model.countMakeEntries(() => {
        after = bucket(afterSnapshot, state, { previousBucket: before });
    });
    assert.equal(allocations, 0, "an unrelated empty-active workspace change does not rebuild populated entries");
    assert.equal(after.workspaces[0], before.workspaces[0]);
    assert.equal(after.workspaces[0].entries, before.workspaces[0].entries);
});

test("new_empty_active_and_empty_dwl_do_not_build_entry_specs", () => {
    for (const compositor of ["niri", "dwl"]) {
        const state = model.createIdentityState();
        const before = bucket(snapshot({ compositor }), state);
        const calls = model.countMakeEntries(() => bucket(snapshot({ compositor,
            workspaces: [workspace(0, { active: true })]
        }), state, { previousBucket: before }));
        assert.equal(calls, 0, `${compositor}: empty visibility needs no entry specification`);
    }
});

test("dwl_all_tags_refresh_shared_payloads", () => {
    const state = model.createIdentityState();
    const original = { name: "old" }, replacement = { name: "new" };
    const input = snapshot({ compositor: "dwl", groupByApp: true,
        workspaces: [workspace(1, { hasClients: true }), workspace(2, { hasClients: true })],
        windows: [windowRecord("one", 99, "editor", { niriWindowId: 0, toplevel: original })] });
    const before = bucket(input, state);
    const after = bucket({ ...input, windows: [{ ...input.windows[0],
        toplevel: replacement, title: "updated", focused: true, activated: true }]
    }, state, { previousBucket: before });
    for (const ws of after.workspaces) {
        assert.equal(ws.entries[0].toplevel, replacement);
        assert.equal(ws.entries[0].title, "updated");
        assert.equal(ws.entries[0].focused, true);
        assert.equal(ws.entries[0].activatedWindowIndex, 0);
    }
    assert.notEqual(after.workspaces[0].entries, after.workspaces[1].entries);
});

test("dwl_empty_first_focus_does_not_rebuild_common_groups", () => {
    const state = model.createIdentityState();
    const input = snapshot({ compositor: "dwl", groupByApp: true,
        workspaces: [workspace(0, { active: true }), workspace(1, { hasClients: true })],
        windows: [windowRecord("one", 99, "editor")] });
    const before = bucket(input, state);
    const calls = model.countMakeEntries(() => bucket({ ...input,
        windows: input.windows.map(w => ({ ...w, focused: true }))
    }, state, { previousBucket: before }));
    assert.equal(calls, 0, "an empty first tag must not force common groups to be rebuilt on focus");
});

test("dwl_empty_active_then_client_tags_share_one_entry_build", () => {
    const state = model.createIdentityState();
    const emptyActive = bucket(snapshot({
        compositor: "dwl",
        groupByApp: true,
        workspaces: [workspace(1, { active: true, hasClients: false })],
        windows: [],
    }), state);
    const taggedWindows = [
        windowRecord("one", 99, "editor", { niriWindowId: "one" }),
        windowRecord("two", 98, "editor", { niriWindowId: "two" }),
        windowRecord("three", 97, "terminal", { niriWindowId: "three" }),
    ];
    let tagged;
    const allocations = model.countMakeEntries(() => {
        tagged = bucket(snapshot({
            compositor: "dwl",
            groupByApp: true,
            workspaces: [
                workspace(1, { active: true, hasClients: true }),
                workspace(2, { hasClients: true }),
                workspace(3, { hasClients: true }),
            ],
            windows: taggedWindows,
        }), state, { previousBucket: emptyActive });
    });
    assert.equal(allocations, 1, "DWL client tags reconstruct one common group specification");
    assert.deepEqual(Array.from(tagged.workspaces[0].entries, entry => entry.appId), ["editor", "terminal"]);
    assert.deepEqual(Array.from(tagged.workspaces[1].entries, entry => entry.appId), ["editor", "terminal"]);
    assert.deepEqual(Array.from(tagged.workspaces[2].entries, entry => entry.appId), ["editor", "terminal"]);
});

test("fallback_move_and_app_id_change_rebuild_structure", () => {
    const state = model.createIdentityState();
    const fallbackObject = { name: "fallback" };
    const before = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [windowRecord("fallback", 1, "editor", { toplevel: fallbackObject })],
    }), state);
    let moved;
    const moveAllocations = model.countMakeEntries(() => {
        moved = bucket(snapshot({
            workspaces: [workspace(2)],
            windows: [windowRecord("fallback", 2, "editor", { toplevel: fallbackObject })],
        }), state, { previousBucket: before });
    });
    assert.equal(moveAllocations, 1, "a fallback-identified window moving workspaces rebuilds the affected structure");
    assert.equal(moved.windows[0].key, before.windows[0].key);
    assert.equal(entryFor(moved, 2).workspaceId, undefined, "entry payload remains window-shaped while workspace membership is external");

    let appChanged;
    const appIdAllocations = model.countMakeEntries(() => {
        appChanged = bucket(snapshot({
            workspaces: [workspace(2)],
            windows: [windowRecord("fallback", 2, "terminal", { toplevel: fallbackObject })],
        }), state, { previousBucket: moved });
    });
    assert.equal(appIdAllocations, 1, "an appId change rebuilds the entry structure");
    assert.equal(entryFor(appChanged, 2).appId, "terminal");
});

test("structure_comparison_detects_membership_and_grouping_changes", () => {
    const state = model.createIdentityState();
    const base = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [windowRecord("one", 1, "editor", { niriWindowId: "one" })],
    }), state);
    const added = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [
            windowRecord("one", 1, "editor", { niriWindowId: "one" }),
            windowRecord("two", 1, "editor", { niriWindowId: "two" }),
        ],
    }), state);
    const grouped = bucket(snapshot({
        groupByApp: true,
        workspaces: [workspace(1)],
        windows: [windowRecord("one", 1, "editor", { niriWindowId: "one" })],
    }), state);

    assert.equal(model.sameStructure(base, added), false);
    assert.equal(model.sameStructure(base, grouped), false);
});

test("title_unread_count_splits_into_badge_count", () => {
    // splitTitleCount runs inside the VM realm, so re-wrap its result before
    // comparing it with a strict deep equal.
    const split = title => {
        const parsed = model.splitTitleCount(title);
        return { count: parsed.count, title: parsed.title, rawTitle: parsed.rawTitle };
    };

    assert.deepEqual(split("(3) WhatsApp"), { count: 3, title: "WhatsApp", rawTitle: "(3) WhatsApp" });
    assert.deepEqual(split("(12)  Teams | Microsoft Teams"), { count: 12, title: "Teams | Microsoft Teams", rawTitle: "(12)  Teams | Microsoft Teams" });
    assert.deepEqual(split("(1)"), { count: 1, title: "(1)", rawTitle: "(1)" }, "a count with no title keeps the raw text");
    assert.deepEqual(split("Report (1) - editor"), { count: 0, title: "Report (1) - editor", rawTitle: "Report (1) - editor" }, "only a leading count is a badge");
    assert.deepEqual(split(""), { count: 0, title: "", rawTitle: "" });

    const result = bucket(snapshot({
        workspaces: [workspace(1)],
        windows: [
            windowRecord("chat", 1, "elecwhat", { niriWindowId: "chat", title: "(4) WhatsApp" }),
            windowRecord("docs", 1, "editor", { niriWindowId: "docs", title: "notes.md" }),
        ],
    }));

    assert.equal(result.windows[0].unreadCount, 4);
    assert.equal(result.windows[0].title, "(4) WhatsApp", "the model preview keeps the raw title the view strips");
    assert.equal(entryFor(result, 1).unreadCount, 4);
    assert.equal(entryFor(result, 1).title, "(4) WhatsApp");
    assert.equal(result.windows[1].unreadCount, 0, "titles without a leading count never badge");
    assert.equal(result.windows[1].title, "notes.md");
});

test("grouped_unread_counts_sum_and_refresh_in_place", () => {
    const state = model.createIdentityState();
    const first = windowRecord("chat-1", 1, "elecwhat", { niriWindowId: "chat-1", title: "(1) WhatsApp" });
    const second = windowRecord("chat-2", 1, "elecwhat", { niriWindowId: "chat-2", title: "(2) WhatsApp" });
    const before = bucket(snapshot({
        groupByApp: true,
        workspaces: [workspace(1)],
        windows: [first, second],
    }), state);
    const groupedEntry = entryFor(before, 1);

    assert.equal(groupedEntry.unreadCount, 3, "a grouped entry reports the sum of its windows");
    assert.equal(groupedEntry.title, "(1) WhatsApp");

    const read = windowRecord("chat-1", 1, "elecwhat", { niriWindowId: "chat-1", title: "WhatsApp" });
    let after;
    const allocations = model.countMakeEntries(() => {
        after = bucket(snapshot({
            groupByApp: true,
            workspaces: [workspace(1)],
            windows: [read, second],
        }), state, { previousBucket: before });
    });

    assert.equal(allocations, 0, "a read count refreshes the existing entries");
    assert.equal(entryFor(after, 1), groupedEntry, "the entry record is reused");
    assert.equal(entryFor(after, 1).unreadCount, 2);

    const ungrouped = bucket(snapshot({
        groupByApp: true,
        ungroupAppIds: ["elecwhat"],
        workspaces: [workspace(1)],
        windows: [first, second],
    }), state);
    assert.deepEqual(Array.from(ungrouped.workspaces[0].entries, entry => entry.unreadCount), [1, 2], "ungrouped windows keep their own counts");
});
