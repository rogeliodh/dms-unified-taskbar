import QtQml
import "TaskbarModel.js" as Model

QtObject {
    id: root

    // Service-free boundary. The owner supplies a fresh immutable snapshot:
    // { compositor, workspaces, windows, groupByApp }.
    property var snapshot: null
    readonly property var visibleWorkspaces: _visibleWorkspaces
    readonly property int reconcileCount: _reconcileCount
    readonly property int pendingWorkspaceCount: _pendingWorkspaceCount
    readonly property int pendingEntryCount: _pendingEntryCount
    readonly property int pendingRetirementCount: _pendingWorkspaceCount + _pendingEntryCount
    readonly property int generation: _generation

    signal reconciled()
    signal duplicateWindowIdentity(string key)

    property var _visibleWorkspaces: []
    property int _reconcileCount: 0
    property int _generation: 0
    property bool _alive: true
    property bool _reconcileQueued: false
    property bool _flushQueued: false
    property int _pendingWorkspaceCount: 0
    property int _pendingEntryCount: 0
    property var _identityState: Model.createIdentityState()
    property var _workspaceRecords: ({})
    property var _entryRecords: ({})
    property var _pendingWorkspaces: new Set()
    property var _pendingEntries: new Set()
    property var _publishedWorkspaceKeys: new Set()
    property var _publishedEntryKeys: new Set()
    property var _lastBucket: null
    property var _lifetime: ({ alive: true, generation: 0 })

    property Component workspaceComponent: WorkspaceRecord {}
    property Component entryComponent: EntryRecord {}

    onSnapshotChanged: scheduleReconcile()

    function _later(callback, token) {
        var lifetime = _lifetime;
        if (typeof Qt !== "undefined" && typeof Qt.callLater === "function") {
            Qt.callLater(function() {
                // The callback captures only this plain JS lifetime token, not
                // the QObject. Destruction invalidates it before child cleanup.
                if (lifetime.alive && lifetime.generation === token) callback();
            });
        } else if (lifetime.alive && lifetime.generation === token) {
            callback();
        }
    }

    function scheduleReconcile() {
        if (!_alive || _reconcileQueued) return;
        _reconcileQueued = true;
        var token = _generation;
        _later(function() {
            _reconcileQueued = false;
            if (_alive) reconcile();
        }, token);
    }

    function _workspaceKey(id) { return typeof id + ":" + String(id); }
    function _entryKey(workspaceId, key) { return _workspaceKey(workspaceId) + "::" + String(key); }

    function _setProperty(object, name, value) {
        if (object[name] !== value) object[name] = value;
    }

    function _recordWorkspace(descriptor, key) {
        var record = _workspaceRecords[key];
        if (!record) {
            record = workspaceComponent.createObject(root, { workspaceId: descriptor.workspaceId });
            _workspaceRecords[key] = record;
        }
        if (_pendingWorkspaces.delete(key)) _pendingWorkspaceCount = _pendingWorkspaces.size;
        _setProperty(record, "workspaceId", descriptor.workspaceId);
        _setProperty(record, "workspace", descriptor.workspace);
        _setProperty(record, "active", descriptor.active === true);
        _setProperty(record, "hasClients", descriptor.hasClients === true);
        return record;
    }

    function _recordEntry(descriptor, workspaceId, key) {
        var record = _entryRecords[key];
        if (!record) {
            record = entryComponent.createObject(root, { entryKey: descriptor.entryKey });
            _entryRecords[key] = record;
        }
        if (_pendingEntries.delete(key)) _pendingEntryCount = _pendingEntries.size;
        _setProperty(record, "entryKey", descriptor.entryKey);
        _setProperty(record, "appId", descriptor.appId || "unknown");
        _setProperty(record, "isGrouped", descriptor.isGrouped === true);
        var descriptorWindows = descriptor.windows || [];
        var currentWindows = record.windows || [];
        var windowsChanged = currentWindows.length !== descriptorWindows.length;
        if (!windowsChanged) {
            for (var windowIndex = 0; windowIndex < descriptorWindows.length; windowIndex++) {
                var payload = descriptorWindows[windowIndex];
                var wrapper = payload && payload.toplevel !== undefined ? payload.toplevel : payload;
                if (currentWindows[windowIndex] !== wrapper) { windowsChanged = true; break; }
            }
        }
        if (windowsChanged) {
            var wrappers = [];
            for (var replacementIndex = 0; replacementIndex < descriptorWindows.length; replacementIndex++) {
                var replacement = descriptorWindows[replacementIndex];
                wrappers.push(replacement && replacement.toplevel !== undefined ? replacement.toplevel : replacement);
            }
            _setProperty(record, "windows", wrappers);
        }
        // Payloads are notifying snapshots for an already-open menu. Compare
        // their scalar fields first so unchanged reconciles retain the array
        // and avoid allocating per-window objects; copy only on change.
        var currentPayloads = record.payloads || [];
        var payloadsChanged = currentPayloads.length !== descriptorWindows.length;
        if (!payloadsChanged) {
            for (var payloadIndex = 0; payloadIndex < descriptorWindows.length; payloadIndex++) {
                var sourcePayload = descriptorWindows[payloadIndex] || {};
                var currentPayload = currentPayloads[payloadIndex];
                if (!currentPayload
                        || currentPayload.key !== sourcePayload.key
                        || currentPayload.title !== (sourcePayload.title || "")
                        || currentPayload.appId !== (sourcePayload.appId || "unknown")
                        || currentPayload.focused !== (sourcePayload.focused === true)
                        || currentPayload.activated !== (sourcePayload.activated === true)) {
                    payloadsChanged = true;
                    break;
                }
            }
        }
        if (payloadsChanged) {
            var payloadSnapshot = [];
            for (var replacementPayloadIndex = 0; replacementPayloadIndex < descriptorWindows.length; replacementPayloadIndex++) {
                var payload = descriptorWindows[replacementPayloadIndex] || {};
                payloadSnapshot.push({ key: payload.key, title: payload.title || "", appId: payload.appId || "unknown",
                    focused: payload.focused === true, activated: payload.activated === true });
            }
            _setProperty(record, "payloads", payloadSnapshot);
        }
        _setProperty(record, "toplevel", descriptor.toplevel || null);
        _setProperty(record, "focused", descriptor.focused === true);
        _setProperty(record, "title", descriptor.title || "");
        _setProperty(record, "unreadCount", descriptor.unreadCount || 0);
        _setProperty(record, "activatedWindowIndex", descriptor.activatedWindowIndex === undefined ? -1 : descriptor.activatedWindowIndex);
        return record;
    }

    function _retireMissing(nextWorkspaceKeys, nextEntryKeys) {
        _workspaceRecordsForEach(function(key) {
            if (!nextWorkspaceKeys.has(key) && !_pendingWorkspaces.has(key)) _pendingWorkspaces.add(key);
        });
        _entryRecordsForEach(function(key) {
            if (!nextEntryKeys.has(key) && !_pendingEntries.has(key)) _pendingEntries.add(key);
        });
        _pendingWorkspaceCount = _pendingWorkspaces.size;
        _pendingEntryCount = _pendingEntries.size;
        if ((_pendingWorkspaces.size || _pendingEntries.size) && !_flushQueued) {
            _flushQueued = true;
            var token = _generation;
            _later(function() { _flushQueued = false; _flushRetirements(); }, token);
        }
    }

    function _workspaceRecordsForEach(callback) {
        var keys = Object.keys(_workspaceRecords);
        for (var i = 0; i < keys.length; i++) callback(keys[i]);
    }

    function _entryRecordsForEach(callback) {
        var keys = Object.keys(_entryRecords);
        for (var i = 0; i < keys.length; i++) callback(keys[i]);
    }

    function _flushRetirements() {
        if (!_alive) return;
        // Reconcile may have reused a pending key before this turn; only destroy
        // records still absent from all currently published arrays.
        var entryKeys = Array.from(_pendingEntries);
        for (var i = 0; i < entryKeys.length; i++) {
            var entryKey = entryKeys[i];
            if (_publishedEntryKeys.has(entryKey)) { _pendingEntries.delete(entryKey); continue; }
            var entry = _entryRecords[entryKey];
            _pendingEntries.delete(entryKey);
            _pendingEntryCount = _pendingEntries.size;
            delete _entryRecords[entryKey];
            if (entry) entry.destroy();
        }
        var workspaceKeys = Array.from(_pendingWorkspaces);
        for (var j = 0; j < workspaceKeys.length; j++) {
            var workspaceKey = workspaceKeys[j];
            if (_publishedWorkspaceKeys.has(workspaceKey)) { _pendingWorkspaces.delete(workspaceKey); continue; }
            var workspace = _workspaceRecords[workspaceKey];
            _pendingWorkspaces.delete(workspaceKey);
            _pendingWorkspaceCount = _pendingWorkspaces.size;
            delete _workspaceRecords[workspaceKey];
            if (workspace) workspace.destroy();
        }
    }

    function reconcile() {
        if (!_alive) return;
        var bucket = Model.bucketSnapshot(snapshot || {}, _identityState, { previousBucket: _lastBucket });
        _lastBucket = bucket;
        var nextWorkspaceKeys = new Set();
        var nextEntryKeys = new Set();
        var nextVisible = null;
        var visibleCount = 0;
        var descriptors = bucket.workspaces || [];
        for (var i = 0; i < descriptors.length; i++) {
            var descriptor = descriptors[i];
            var workspaceKey = _workspaceKey(descriptor.workspaceId);
            nextWorkspaceKeys.add(workspaceKey);
            var workspaceRecord = _recordWorkspace(descriptor, workspaceKey);
            var entries = descriptor.entries || [];
            var currentEntries = workspaceRecord.entries || [];
            var entriesChanged = currentEntries.length !== entries.length;
            var entryRecords = null;
            for (var j = 0; j < entries.length; j++) {
                var entryDescriptor = entries[j];
                var entryKey = _entryKey(descriptor.workspaceId, entryDescriptor.entryKey);
                nextEntryKeys.add(entryKey);
                var entryRecord = _recordEntry(entryDescriptor, descriptor.workspaceId, entryKey);
                if (!entriesChanged && currentEntries[j] !== entryRecord) {
                    entriesChanged = true;
                    entryRecords = [];
                    for (var prefixIndex = 0; prefixIndex < j; prefixIndex++) entryRecords.push(currentEntries[prefixIndex]);
                }
                if (entryRecords) entryRecords.push(entryRecord);
            }
            if (entriesChanged) {
                if (!entryRecords) {
                    entryRecords = [];
                    for (var changedIndex = 0; changedIndex < entries.length; changedIndex++) {
                        var changedDescriptor = entries[changedIndex];
                        entryRecords.push(_entryRecords[_entryKey(descriptor.workspaceId, changedDescriptor.entryKey)]);
                    }
                }
                _setProperty(workspaceRecord, "entries", entryRecords);
            }
            if (!nextVisible) nextVisible = [];
            nextVisible.push(workspaceRecord);
            visibleCount += 1;
        }
        if (!nextVisible) nextVisible = [];

        // Publish an empty child model before queuing its parent workspace for
        // destruction, so ScriptModel/Repeater consumers process removals first.
        var oldWorkspaceKeys = Object.keys(_workspaceRecords);
        for (var oldWorkspaceIndex = 0; oldWorkspaceIndex < oldWorkspaceKeys.length; oldWorkspaceIndex++) {
            var oldWorkspaceKey = oldWorkspaceKeys[oldWorkspaceIndex];
            if (!nextWorkspaceKeys.has(oldWorkspaceKey) && _workspaceRecords[oldWorkspaceKey])
                _workspaceRecords[oldWorkspaceKey].entries = [];
        }
        _publishedWorkspaceKeys = nextWorkspaceKeys;
        _publishedEntryKeys = nextEntryKeys;
        _retireMissing(nextWorkspaceKeys, nextEntryKeys);
        // The outer array is replaced only when ordered record identities differ.
        var changed = _visibleWorkspaces.length !== visibleCount;
        if (!changed) {
            for (var visibleIndex = 0; visibleIndex < visibleCount; visibleIndex++) {
                if (_visibleWorkspaces[visibleIndex] !== nextVisible[visibleIndex]) { changed = true; break; }
            }
        }
        if (changed) _visibleWorkspaces = nextVisible;
        _reconcileCount += 1;
        if (bucket.duplicateWindowKeys) {
            for (var duplicateIndex = 0; duplicateIndex < bucket.duplicateWindowKeys.length; duplicateIndex++)
                duplicateWindowIdentity(bucket.duplicateWindowKeys[duplicateIndex]);
        }
        reconciled();
    }

    function forceReconcile() { scheduleReconcile(); }

    Component.onCompleted: scheduleReconcile()
    Component.onDestruction: {
        _alive = false;
        _lifetime.alive = false;
        _lifetime.generation += 1;
        _generation += 1;
        _reconcileQueued = false;
        _flushQueued = false;
        var entryKeys = Object.keys(_entryRecords);
        for (var i = 0; i < entryKeys.length; i++) if (_entryRecords[entryKeys[i]]) _entryRecords[entryKeys[i]].destroy();
        var workspaceKeys = Object.keys(_workspaceRecords);
        for (var j = 0; j < workspaceKeys.length; j++) if (_workspaceRecords[workspaceKeys[j]]) _workspaceRecords[workspaceKeys[j]].destroy();
        _entryRecords = ({});
        _workspaceRecords = ({});
        _pendingEntries.clear();
        _pendingWorkspaces.clear();
        _pendingEntryCount = 0;
        _pendingWorkspaceCount = 0;
        _publishedEntryKeys.clear();
        _publishedWorkspaceKeys.clear();
        _visibleWorkspaces = [];
    }
}






    
