import QtQml

QtObject {
    id: root

    property string entryKey: ""
    property string appId: ""
    property bool isGrouped: false
    property var windows: []
    property var payloads: []
    property var toplevel: null
    property bool focused: false
    property string title: ""
    property int unreadCount: 0
    property int activatedWindowIndex: -1

    function _windowAt(index) {
        var current = windows || [];
        if (index < 0 || index >= current.length) return null;
        // TaskbarModel normalizes descriptor payloads to live compositor
        // wrappers before publishing this array. A wrapper may itself expose a
        // native `toplevel` property, so never unwrap by property presence here.
        return current[index] || null;
    }

    function _indexForKey(key) {
        var current = payloads || [];
        for (var i = 0; i < current.length; i++) {
            if (current[i] && String(current[i].key) === String(key)) return i;
        }
        return -1;
    }

    function _invokeWindow(key, method) {
        var index = _indexForKey(key);
        var target = _windowAt(index);
        if (target && typeof target[method] === "function") {
            target[method]();
            return true;
        }
        return false;
    }

    // Resolve the current wrapper at call time. Menu rows retain only a stable
    // payload key, so wrapper replacement/reordering while the menu is open is
    // safe.
    function activateWindow(key) { return _invokeWindow(key, "activate"); }
    function closeWindow(key) { return _invokeWindow(key, "close"); }

    // Preserve the existing activated-only cycling rule, but resolve the
    // current wrapper at call time rather than capturing an old delegate value.
    function activateNext() {
        var current = windows || [];
        if (current.length === 0) return false;
        var index = -1;
        for (var i = 0; i < current.length; i++) {
            if (current[i] && current[i].activated === true) { index = i; break; }
        }
        var next = _windowAt((index + 1) % current.length);
        if (next && typeof next.activate === "function") { next.activate(); return true; }
        return false;
    }

    function activateRepresentative() {
        var target = _windowAt(0);
        if (target && typeof target.activate === "function") { target.activate(); return true; }
        return false;
    }

    function closeRepresentative() {
        var target = _windowAt(0);
        if (target && typeof target.close === "function") { target.close(); return true; }
        return false;
    }

    function closeAllWindows() {
        var current = windows || [];
        if (!isGrouped || current.length <= 1) return false;
        var closed = false;
        for (var i = 0; i < current.length; i++) {
            var target = _windowAt(i);
            if (target && typeof target.close === "function") {
                target.close();
                closed = true;
            }
        }
        return closed;
    }

    function contextTarget() {
        return _windowAt(0);
    }
}






    
