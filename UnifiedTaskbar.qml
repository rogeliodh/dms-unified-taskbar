import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Wayland
import Quickshell.Widgets
import Quickshell.Hyprland
import Quickshell.I3
import qs.Common
import qs.Modules.Plugins
import qs.Services
import qs.Widgets
import "TaskbarModel.js" as TaskbarLogic

PluginComponent {
    id: root

    layerNamespacePlugin: "unified-taskbar"

    readonly property string screenName: parentScreen?.name ?? ""

    readonly property string effectiveScreenName: {
        if (!SettingsData.workspaceFollowFocus)
            return root.screenName;

        switch (CompositorService.compositor) {
        case "niri":
            return NiriService.currentOutput || root.screenName;
        case "hyprland":
            return Hyprland.focusedWorkspace?.monitor?.name || root.screenName;
        case "dwl":
            return typeof DwlService !== "undefined" ? (DwlService.activeOutput || root.screenName) : root.screenName;
        case "sway":
        case "scroll":
        case "miracle":
            const focusedWs = I3.workspaces?.values?.find(ws => ws.focused === true);
            return focusedWs?.monitor?.name || root.screenName;
        default:
            return root.screenName;
        }
    }

    // Per-screen settings: pluginData.screenOverrides is a JSON object keyed by
    // screen (output) name whose keys override the global plugin settings for
    // that monitor only, e.g.
    //   {"HDMI-A-2": {"ungroupAppIds": "firefox_firefox", "compactMode": true}}
    readonly property var screenOverrides: {
        try {
            const parsed = JSON.parse(String(pluginData.screenOverrides ?? ""));
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function setting(key, fallback) {
        const override = root.screenOverrides[root.screenName];
        if (override && override[key] !== undefined)
            return override[key];
        return pluginData[key] !== undefined ? pluginData[key] : fallback;
    }

    function appIdList(value) {
        return String(value ?? "").split(",").map(s => s.trim()).filter(s => s !== "");
    }

    readonly property bool groupByApp: setting("groupByApp", false)
    readonly property bool compactMode: setting("compactMode", false)
    readonly property bool allMonitors: setting("allMonitors", false)
    readonly property bool currentWorkspaceOnly: setting("currentWorkspaceOnly", false)
    readonly property var hiddenAppIds: appIdList(setting("hiddenAppIds", ""))
    readonly property var ungroupAppIds: appIdList(setting("ungroupAppIds", ""))
    readonly property bool reverseMonitorOrder: setting("reverseMonitorOrder", false)
    readonly property bool filledPills: setting("filledPills", false)

    readonly property real iconPadding: setting("iconPadding", Theme.spacingS)
    readonly property real itemSpacing: setting("itemSpacing", Theme.spacingXS)
    readonly property real workspaceSpacing: setting("workspaceSpacing", Theme.spacingXS)

    // Maximum width of the context menu (grouped-window list), bounded by the
    // screen so the popup can never exceed the monitor.
    readonly property real menuWidth: {
        const configured = Number(setting("menuWidth", 360));
        const limit = root.parentScreen ? root.parentScreen.width - 24 : 360;
        return Math.max(180, Math.min(isFinite(configured) ? configured : 360, limit));
    }

    readonly property real iconCellSize: widgetThickness - ((barConfig?.removeWidgetPadding ?? false) ? 0 : Theme.snap((barConfig?.widgetPadding ?? 12) * (widgetThickness / 30), 1)) * 2

    property int _desktopEntriesUpdateTrigger: 0
    property int _appIdSubstitutionsTrigger: 0

    function getWorkspaceList() {
        let list = getWorkspaceListUnfiltered();
        if (root.currentWorkspaceOnly)
            list = list.filter(ws => root.isWorkspaceActive(ws));
        return list;
    }

    function getWorkspaceListUnfiltered() {
        if (CompositorService.isNiri) {
            let workspaces;
            if (root.allMonitors) {
                workspaces = NiriService.allWorkspaces;
            } else if (!root.screenName || SettingsData.workspaceFollowFocus) {
                workspaces = NiriService.getCurrentOutputWorkspaces();
            } else {
                workspaces = NiriService.allWorkspaces.filter(ws => ws.output === root.effectiveScreenName);
            }
            if (root.allMonitors && root.reverseMonitorOrder) {
                // Group by output, reverse the groups, flatten back
                const groups = [];
                let currentOutput = null;
                let currentGroup = [];
                for (const ws of workspaces) {
                    if (ws.output !== currentOutput) {
                        if (currentGroup.length > 0) groups.push(currentGroup);
                        currentGroup = [];
                        currentOutput = ws.output;
                    }
                    currentGroup.push(ws);
                }
                if (currentGroup.length > 0) groups.push(currentGroup);
                groups.reverse();
                workspaces = [].concat.apply([], groups);
            }
            return workspaces.length > 0 ? workspaces : [];
        } else if (CompositorService.isHyprland) {
            const filtered = Array.from(Hyprland.workspaces?.values || []).filter(ws => {
                if (ws.id < 0) return false;
                if (!root.allMonitors && root.screenName && ws.monitor?.name !== root.effectiveScreenName) return false;
                return true;
            });
            if (root.allMonitors && root.reverseMonitorOrder) {
                filtered.sort((a, b) => {
                    const monCmp = (b.monitor?.name ?? "").localeCompare(a.monitor?.name ?? "");
                    return monCmp !== 0 ? monCmp : a.id - b.id;
                });
            } else {
                filtered.sort((a, b) => {
                    if (root.allMonitors) {
                        const monCmp = (a.monitor?.name ?? "").localeCompare(b.monitor?.name ?? "");
                        if (monCmp !== 0) return monCmp;
                    }
                    return a.id - b.id;
                });
            }
            return filtered;
        } else if (CompositorService.isDwl) {
            if (typeof DwlService === "undefined" || !DwlService.dwlAvailable) return [];
            const output = DwlService.getOutputState(root.effectiveScreenName);
            if (!output || !output.tags || output.tags.length === 0) return [];
            if (SettingsData.dwlShowAllTags) {
                return output.tags.map(tag => ({
                    "tag": tag.tag, "state": tag.state,
                    "clients": tag.clients, "focused": tag.focused
                }));
            }
            const visibleTagIndices = DwlService.getVisibleTags(root.effectiveScreenName);
            return visibleTagIndices.map(tagIndex => {
                const tagData = output.tags.find(t => t.tag === tagIndex);
                return {
                    "tag": tagIndex, "state": tagData?.state ?? 0,
                    "clients": tagData?.clients ?? 0, "focused": tagData?.focused ?? false
                };
            });
        } else if (CompositorService.isSway || CompositorService.isScroll || CompositorService.isMiracle) {
            const workspaces = I3.workspaces?.values || [];
            const filtered = Array.from(workspaces).filter(ws => {
                if (!root.allMonitors && root.screenName && ws.output !== root.effectiveScreenName) return false;
                return true;
            });
            if (root.allMonitors && root.reverseMonitorOrder) {
                filtered.sort((a, b) => {
                    const monCmp = (b.output ?? "").localeCompare(a.output ?? "");
                    return monCmp !== 0 ? monCmp : (a.num ?? 0) - (b.num ?? 0);
                });
            } else {
                filtered.sort((a, b) => {
                    if (root.allMonitors) {
                        const monCmp = (a.output ?? "").localeCompare(b.output ?? "");
                        if (monCmp !== 0) return monCmp;
                    }
                    return (a.num ?? 0) - (b.num ?? 0);
                });
            }
            return filtered;
        }
        return [];
    }

    function getWorkspaceId(ws) {
        if (CompositorService.isNiri) {
            return ws.id;
        } else if (CompositorService.isHyprland) {
            return ws.id;
        } else if (CompositorService.isDwl) {
            return ws.tag;
        } else if (CompositorService.isSway || CompositorService.isScroll || CompositorService.isMiracle) {
            return ws.num;
        }
        return undefined;
    }

    function isWorkspaceActive(ws) {
        if (CompositorService.isNiri) {
            return ws.is_active === true;
        } else if (CompositorService.isSway || CompositorService.isScroll || CompositorService.isMiracle) {
            return ws.focused === true;
        } else if (CompositorService.isDwl) {
            return ws.state === 1;
        } else if (CompositorService.isHyprland) {
            const focusedWs = Hyprland.focusedWorkspace;
            return focusedWs ? (focusedWs.id === ws.id) : false;
        }
        return false;
    }

    // Service reads stay here; the model adapter is usable without a DMS session.
    // Snapshots may run on focus changes, but unchanged structural arrays survive.
    property int _dwlStateRevision: 0
    property int _toplevelRevision: 0
    Connections {
        target: CompositorService
        function onToplevelsChanged() { root._toplevelRevision++; }
    }
    Connections {
        // Newer DMS versions renamed this backend; do not resolve an absent
        // legacy service while running another compositor (notably Niri).
        target: CompositorService.isDwl && typeof DwlService !== "undefined" ? DwlService : null
        function onStateChanged() { root._dwlStateRevision++; }
    }

    readonly property var taskbarSnapshot: {
        const compositor = CompositorService.compositor;
        root._toplevelRevision;
        if (CompositorService.isDwl) root._dwlStateRevision;
        root._appIdSubstitutionsTrigger;
        const workspaces = getWorkspaceList().map(ws => ({
            workspaceId: getWorkspaceId(ws), workspace: ws,
            active: isWorkspaceActive(ws), hasClients: ws.clients > 0
        }));
        // One Hyprland lookup table per snapshot, never a search per window.
        const membership = CompositorService.isHyprland
            ? TaskbarLogic.buildHyprlandLookup(Array.from(Hyprland.toplevels?.values || []))
            : null;
        const windows = [];
        // Identity allocation uses ALL windows, before workspace/output filtering.
        for (const w of CompositorService.sortedToplevels || []) {
            if (!w) continue;
            let workspaceId;
            if (CompositorService.isNiri) workspaceId = w.niriWorkspaceId ?? w.workspace_id;
            else if (CompositorService.isHyprland) workspaceId = membership.get(w);
            else if (CompositorService.isSway || CompositorService.isScroll || CompositorService.isMiracle)
                workspaceId = w.workspace?.num;
            const appId = Paths.moddedAppId(w.appId || "unknown");
            if (root.hiddenAppIds.indexOf(appId) !== -1)
                continue;
            windows.push({
                toplevel: w, niriWindowId: CompositorService.isNiri ? w.niriWindowId : undefined,
                workspaceId: workspaceId, appId: appId,
                title: w.title || "(Unnamed)", focused: !!(w.activated || w.is_focused),
                activated: !!w.activated
            });
        }
        return { compositor: compositor, workspaces: workspaces, windows: windows, groupByApp: root.groupByApp,
            ungroupAppIds: root.ungroupAppIds };
    }

    TaskbarModel {
        id: taskbarModel
        snapshot: root.taskbarSnapshot
    }

    function switchToWorkspace(ws) {
        if (!ws) return;
        if (CompositorService.isNiri) {
            NiriService.switchToWorkspace(ws.id);
        } else if (CompositorService.isHyprland) {
            Hyprland.dispatch(`workspace ${ws.id}`);
        } else if (CompositorService.isDwl) {
            if (typeof DwlService !== "undefined")
                DwlService.setTags(root.effectiveScreenName, 1 << ws.tag, 0);
        } else if (CompositorService.isSway || CompositorService.isScroll || CompositorService.isMiracle) {
            I3.dispatch(`workspace number ${ws.num}`);
        }
    }

    readonly property var groupedWorkspaces: taskbarModel.visibleWorkspaces

    property var _pendingContextMenu: null

    Loader {
        id: windowContextMenuLoader
        active: false
        onLoaded: {
            if (root._pendingContextMenu && item) {
                const pending = root._pendingContextMenu;
                item.showAt(pending.x, pending.y, root.isVertical, root.axis?.edge,
                    pending.entryRecord, pending.entryKey);
                root._pendingContextMenu = null;
            }
        }
        sourceComponent: PanelWindow {
            id: contextMenuWindow

            property var currentEntryRecord: null
            property string currentEntryKey: ""
            property var desktopEntry: currentEntryRecord && currentEntryRecord.appId
                ? DesktopEntries.heuristicLookup(currentEntryRecord.appId) : null
            property bool isVisible: false
            property point anchorPos: Qt.point(0, 0)
            property bool isVertical: false
            property string edge: "bottom"
            readonly property bool windowSelectionVisible: root.groupByApp && currentEntryRecord
                && currentEntryRecord.isGrouped && (currentEntryRecord.payloads || []).length > 1
            readonly property bool hasDesktopActions: desktopEntry && desktopEntry.actions
                && desktopEntry.actions.length > 0
            readonly property bool hasWindows: currentEntryRecord && (currentEntryRecord.windows || []).length > 0
            readonly property bool closeAllVisible: root.groupByApp && currentEntryRecord
                && currentEntryRecord.isGrouped && (currentEntryRecord.windows || []).length > 1
            readonly property real menuMaxHeight: Math.max(1, contextMenuWindow.height - 20)

            // Labels the menu must fit. A Column's implicitWidth follows the
            // widest child *width*, and the real rows fill the menu (width bound
            // to the container), so they cannot size it — measure the labels in
            // a hidden column of NoWrap text instead.
            readonly property var menuSamples: {
                const samples = [];
                // Only measure rows that are actually rendered: a single-window
                // entry has no window list (just "Close"), so measuring its title
                // would size the menu for text it never shows.
                if (windowSelectionVisible) {
                    const payloads = currentEntryRecord && currentEntryRecord.payloads ? currentEntryRecord.payloads : [];
                    for (let i = 0; i < payloads.length; i++)
                        samples.push(payloads[i] && payloads[i].title ? payloads[i].title : I18n.tr("(Unnamed)"));
                }
                if (hasDesktopActions) {
                    const actions = desktopEntry && desktopEntry.actions ? desktopEntry.actions : [];
                    for (let j = 0; j < actions.length; j++)
                        samples.push(actions[j] && actions[j].name ? actions[j].name : "");
                }
                if (hasWindows) samples.push(I18n.tr("Close"));
                if (closeAllVisible) samples.push(I18n.tr("Close All"));
                return samples;
            }

            // Extra room for the per-window close button, only when the window
            // list (the rows that have one) is shown.
            readonly property real menuRowChrome: windowSelectionVisible ? (Theme.spacingXS * 2 + 20) : 0

            Column {
                id: menuMeasureColumn
                visible: false
                Repeater {
                    model: contextMenuWindow.menuSamples
                    StyledText {
                        text: modelData
                        font.pixelSize: Theme.fontSizeSmall
                        wrapMode: Text.NoWrap
                    }
                }
            }

            function showAt(x, y, vertical, barEdge, entryRecord, entryKey) {
                screen = root.parentScreen;
                anchorPos = Qt.point(x, y);
                isVertical = vertical ?? false;
                edge = barEdge ?? "bottom";
                currentEntryRecord = entryRecord || null;
                currentEntryKey = entryKey || (entryRecord ? entryRecord.entryKey : "");
                isVisible = true;
                visible = true;
                if (screen) {
                    TrayMenuManager.registerMenu(screen.name, contextMenuWindow);
                }
            }

            function launchDesktopAction(action) {
                // SessionService also validates command, but keep this guard at
                // the menu boundary so malformed desktop actions never execute.
                if (desktopEntry && action && action.command)
                    SessionService.launchDesktopAction(desktopEntry, action);
            }

            function close() {
                isVisible = false;
                visible = false;
                currentEntryRecord = null;
                currentEntryKey = "";
                windowContextMenuLoader.active = false;
                if (screen) {
                    TrayMenuManager.unregisterMenu(screen.name);
                }
            }

            visible: false
            color: "transparent"

            WlrLayershell.layer: WlrLayershell.Overlay
            WlrLayershell.exclusiveZone: -1
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

            anchors {
                top: true
                left: true
                right: true
                bottom: true
            }

            Component.onDestruction: {
                if (screen) {
                    TrayMenuManager.unregisterMenu(screen.name);
                }
            }

            Connections {
                target: PopoutManager
                function onPopoutOpening() {
                    contextMenuWindow.close();
                }
            }

            MouseArea {
                anchors.fill: parent
                onClicked: contextMenuWindow.close()
            }

            Rectangle {
                id: contextMenuContainer
                z: 1
                x: {
                    if (contextMenuWindow.isVertical) {
                        if (contextMenuWindow.edge === "left")
                            return Math.max(10, Math.min(contextMenuWindow.width - width - 10, contextMenuWindow.anchorPos.x));
                        return Math.max(10, Math.min(contextMenuWindow.width - width - 10,
                            contextMenuWindow.anchorPos.x - width));
                    }
                    const want = contextMenuWindow.anchorPos.x - width / 2;
                    return Math.max(10, Math.min(contextMenuWindow.width - width - 10, want));
                }
                y: {
                    if (contextMenuWindow.isVertical) {
                        const want = contextMenuWindow.anchorPos.y - height / 2;
                        return Math.max(10, Math.min(contextMenuWindow.height - height - 10, want));
                    }
                    if (contextMenuWindow.edge === "top")
                        return Math.min(contextMenuWindow.height - height - 10, contextMenuWindow.anchorPos.y);
                    return Math.max(10, contextMenuWindow.anchorPos.y - height);
                }
                width: Math.min(root.menuWidth, Math.max(180, menuMeasureColumn.implicitWidth + Theme.spacingS * 2 + contextMenuWindow.menuRowChrome))
                height: Math.min(
                    Math.max(60, menuFlickable.contentHeight + Theme.spacingS * 2),
                    contextMenuWindow.menuMaxHeight)
                // Menus must remain readable even with a transparent bar theme.
                color: Qt.rgba(Theme.surfaceContainer.r, Theme.surfaceContainer.g, Theme.surfaceContainer.b, 1)
                radius: Theme.cornerRadius
                border.width: 1
                border.color: Qt.rgba(Theme.outline.r, Theme.outline.g, Theme.outline.b, 0.12)

                Flickable {
                    id: menuFlickable
                    anchors.fill: parent
                    anchors.margins: Theme.spacingS
                    clip: true
                    contentWidth: width
                    contentHeight: menuColumn.implicitHeight
                    boundsBehavior: Flickable.StopAtBounds
                    flickableDirection: Flickable.VerticalFlick
                    interactive: contentHeight > height

                    Column {
                        id: menuColumn
                        width: menuFlickable.width
                        spacing: 1

                    Repeater {
                        model: contextMenuWindow.windowSelectionVisible
                            ? contextMenuWindow.currentEntryRecord.payloads : []

                        Rectangle {
                            width: parent.width
                            height: 28
                            radius: Theme.cornerRadius
                            color: windowArea.containsMouse
                                ? Theme.widgetBaseHoverColor : "transparent"

                            StyledText {
                                anchors.left: parent.left
                                anchors.leftMargin: Theme.spacingS
                                anchors.right: windowCloseButton.left
                                anchors.rightMargin: Theme.spacingXS
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData && modelData.title
                                    ? modelData.title : I18n.tr("(Unnamed)")
                                font.pixelSize: Theme.fontSizeSmall
                                color: Theme.widgetTextColor
                                wrapMode: Text.NoWrap
                                elide: Text.ElideRight
                                maximumLineCount: 1
                            }

                            Rectangle {
                                id: windowCloseButton
                                anchors.right: parent.right
                                anchors.rightMargin: Theme.spacingXS
                                anchors.verticalCenter: parent.verticalCenter
                                width: 20
                                height: 20
                                radius: 10
                                color: windowCloseArea.containsMouse
                                    ? Theme.errorPressed : "transparent"

                                DankIcon {
                                    anchors.centerIn: parent
                                    name: "close"
                                    size: 12
                                    color: windowCloseArea.containsMouse
                                        ? Theme.error : Theme.widgetTextColor
                                }

                                MouseArea {
                                    id: windowCloseArea
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (contextMenuWindow.currentEntryRecord && modelData)
                                            contextMenuWindow.currentEntryRecord.closeWindow(modelData.key);
                                        contextMenuWindow.close();
                                    }
                                }
                            }

                            MouseArea {
                                id: windowArea
                                anchors.fill: parent
                                anchors.rightMargin: 24
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (contextMenuWindow.currentEntryRecord && modelData)
                                        contextMenuWindow.currentEntryRecord.activateWindow(modelData.key);
                                    contextMenuWindow.close();
                                }
                            }
                        }
                    }

                    Rectangle {
                        visible: contextMenuWindow.windowSelectionVisible
                        width: parent.width
                        height: 1
                        color: Theme.outline
                    }

                    Repeater {
                        model: contextMenuWindow.hasDesktopActions
                            ? contextMenuWindow.desktopEntry.actions : []

                        Rectangle {
                            width: parent.width
                            height: 28
                            radius: Theme.cornerRadius
                            color: actionArea.containsMouse
                                ? Theme.widgetBaseHoverColor : "transparent"

                            StyledText {
                                anchors.left: parent.left
                                anchors.leftMargin: Theme.spacingS
                                anchors.right: parent.right
                                anchors.rightMargin: Theme.spacingS
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData && modelData.name ? modelData.name : ""
                                font.pixelSize: Theme.fontSizeSmall
                                color: Theme.widgetTextColor
                                wrapMode: Text.NoWrap
                                elide: Text.ElideRight
                                maximumLineCount: 1
                            }

                            MouseArea {
                                id: actionArea
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    contextMenuWindow.launchDesktopAction(modelData);
                                    contextMenuWindow.close();
                                }
                            }
                        }
                    }

                    Rectangle {
                        visible: contextMenuWindow.hasDesktopActions
                        width: parent.width
                        height: 1
                        color: Theme.outline
                    }

                    Rectangle {
                        visible: contextMenuWindow.hasWindows
                        width: parent.width
                        height: 28
                        radius: Theme.cornerRadius
                        color: closeArea.containsMouse
                            ? Theme.widgetBaseHoverColor : "transparent"

                        StyledText {
                            anchors.left: parent.left
                            anchors.leftMargin: Theme.spacingS
                            anchors.right: parent.right
                            anchors.rightMargin: Theme.spacingS
                            anchors.verticalCenter: parent.verticalCenter
                            text: I18n.tr("Close")
                            font.pixelSize: Theme.fontSizeSmall
                            color: Theme.widgetTextColor
                            wrapMode: Text.NoWrap
                            elide: Text.ElideRight
                            maximumLineCount: 1
                        }

                        MouseArea {
                            id: closeArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (contextMenuWindow.currentEntryRecord)
                                    contextMenuWindow.currentEntryRecord.closeRepresentative();
                                contextMenuWindow.close();
                            }
                        }
                    }

                    Rectangle {
                        visible: contextMenuWindow.closeAllVisible
                        width: parent.width
                        height: 28
                        radius: Theme.cornerRadius
                        color: closeAllArea.containsMouse
                            ? Theme.errorHover : "transparent"

                        StyledText {
                            anchors.left: parent.left
                            anchors.leftMargin: Theme.spacingS
                            anchors.right: parent.right
                            anchors.rightMargin: Theme.spacingS
                            anchors.verticalCenter: parent.verticalCenter
                            text: I18n.tr("Close All")
                            font.pixelSize: Theme.fontSizeSmall
                            color: closeAllArea.containsMouse
                                ? Theme.error : Theme.widgetTextColor
                            wrapMode: Text.NoWrap
                            elide: Text.ElideRight
                            maximumLineCount: 1
                        }

                        MouseArea {
                            id: closeAllArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (contextMenuWindow.currentEntryRecord)
                                    contextMenuWindow.currentEntryRecord.closeAllWindows();
                                contextMenuWindow.close();
                            }
                        }
                    }
                }
            }
        }
    }

    }

    // Compute the BasePill padding so we can compensate with negative margins
    readonly property real _pillPadding: (barConfig?.removeWidgetPadding ?? false) ? 0 : Theme.snap((barConfig?.widgetPadding ?? 12) * (widgetThickness / 30), 1)

    horizontalBarPill: Component {
        Item {
            // Report narrower implicit width so BasePill's padding fills to edge
            implicitWidth: Math.max(0, hLayout.implicitWidth - root._pillPadding * 2)
            implicitHeight: root.widgetThickness

            Row {
                id: hLayout
                spacing: root.workspaceSpacing
                anchors.centerIn: parent

                Repeater {
                    model: ScriptModel {
                        values: root.groupedWorkspaces
                        objectProp: "workspaceId"
                    }

                    delegate: Rectangle {
                        id: wsPill

                        property var wsData: modelData
                        property bool isActive: wsData ? wsData.active : false

                        readonly property real pillInset: Math.max(root.iconPadding, Theme.spacingXS)
                        width: innerLayout.implicitWidth + pillInset * 2
                        height: Math.max(root.widgetThickness, innerLayout.implicitHeight + pillInset * 2)
                        radius: root.filledPills ? Theme.cornerRadius : Theme.cornerRadius * 1.5
                        color: root.filledPills ? (isActive ? Theme.primary : Theme.surfaceTextAlpha) : "transparent"
                        border.width: root.filledPills ? 0 : (isActive ? 2 : 1)
                        border.color: root.filledPills ? "transparent" : (isActive ? Theme.primary : Theme.withAlpha(Theme.outline, 0.4))

                        Behavior on color {
                            enabled: root.filledPills
                            ColorAnimation {
                                duration: Theme.mediumDuration
                                easing.type: Theme.emphasizedEasing
                            }
                        }

                        MouseArea {
                            anchors.fill: parent
                            z: -1
                            acceptedButtons: Qt.LeftButton
                            onClicked: root.switchToWorkspace(wsPill.wsData ? wsPill.wsData.workspace : null)
                        }

                        Row {
                            id: innerLayout
                            anchors.centerIn: parent
                            spacing: root.itemSpacing

                            Repeater {
                                model: ScriptModel {
                                    values: wsPill.wsData ? wsPill.wsData.entries : []
                                    objectProp: "entryKey"
                                }

                                delegate: appEntryDelegate
                            }
                        }
                    }
                }
            }
        }
    }

    verticalBarPill: Component {
        Item {
            implicitWidth: root.widgetThickness
            implicitHeight: vLayout.implicitHeight

            Column {
                id: vLayout
                spacing: root.workspaceSpacing
                width: parent.width
                anchors.verticalCenter: parent.verticalCenter

                Repeater {
                    model: ScriptModel {
                        values: root.groupedWorkspaces
                        objectProp: "workspaceId"
                    }

                    delegate: Rectangle {
                        id: wsPillV

                        property var wsData: modelData
                        property bool isActive: wsData ? wsData.active : false

                        anchors.horizontalCenter: parent.horizontalCenter
                        width: root.filledPills ? (root.widgetThickness - Theme.spacingS * 0.9) : root.iconCellSize
                        readonly property real pillInset: Math.max(root.iconPadding, Theme.spacingXS)
                        height: root.filledPills ? Math.max(Math.round((root.iconCellSize + root.widgetThickness) / 2) + pillInset * 2, innerLayoutV.implicitHeight + pillInset * 2) : (innerLayoutV.implicitHeight + pillInset * 2)
                        radius: root.filledPills ? Theme.cornerRadius : Theme.cornerRadius * 1.5
                        color: root.filledPills ? (isActive ? Theme.primary : Theme.surfaceTextAlpha) : "transparent"
                        border.width: root.filledPills ? 0 : (isActive ? 2 : 1)
                        border.color: root.filledPills ? "transparent" : (isActive ? Theme.primary : Theme.withAlpha(Theme.outline, 0.4))

                        Behavior on color {
                            enabled: root.filledPills
                            ColorAnimation {
                                duration: Theme.mediumDuration
                                easing.type: Theme.emphasizedEasing
                            }
                        }

                        MouseArea {
                            anchors.fill: parent
                            z: -1
                            acceptedButtons: Qt.LeftButton
                            onClicked: root.switchToWorkspace(wsPillV.wsData ? wsPillV.wsData.workspace : null)
                        }

                        Column {
                            id: innerLayoutV
                            objectName: "verticalEntries"
                            anchors.centerIn: parent
                            spacing: root.itemSpacing

                            Repeater {
                                model: ScriptModel {
                                    values: wsPillV.wsData ? wsPillV.wsData.entries : []
                                    objectProp: "entryKey"
                                }

                                delegate: appEntryDelegate
                            }
                        }
                    }
                }
            }
        }
    }

    Component {
        id: appEntryDelegate

        Item {
            id: appEntry

            property var entryData: modelData
            property var toplevelData: entryData ? entryData.toplevel : null
            property bool isGrouped: entryData ? (entryData.isGrouped && entryData.windows.length > 1) : false
            property int windowCount: entryData ? entryData.windows.length : 0
            property string appId: entryData ? entryData.appId : ""
            readonly property string effectiveAppId: appId
            property string windowTitle: entryData ? entryData.title : "(Unnamed)"
            property var coreAppData: {
                if (appEntry.appId !== "org.quickshell" || !appEntry.windowTitle)
                    return null;
                const coreApps = AppSearchService.coreApps || [];
                for (let i = 0; i < coreApps.length; i++) {
                    if (coreApps[i].name === appEntry.windowTitle)
                        return coreApps[i];
                }
                return null;
            }
            readonly property bool isCoreApp: coreAppData !== null
            readonly property bool isVerticalEntry: parent && parent.objectName === "verticalEntries"
            property bool isFocused: entryData ? entryData.focused : false
            readonly property real entryIconSize: Theme.barIconSize(root.barThickness, undefined, root.barConfig?.maximizeWidgetIcons, root.barConfig?.iconScale)

            width: root.compactMode ? entryIconSize + root.iconPadding * 2 : entryIconSize + root.iconPadding * 3 + 120
            height: root.compactMode && isVerticalEntry ? entryIconSize + root.iconPadding * 2 : Math.round((root.iconCellSize + root.widgetThickness) / 2)

            Rectangle {
                id: entryBackground
                anchors.fill: parent
                radius: Theme.cornerRadius * 1.5
                color: {
                    if (root.filledPills)
                        return entryMouseArea.containsMouse ? Theme.withAlpha(Theme.surfaceText, 0.15) : "transparent";
                    if (appEntry.isFocused)
                        return entryMouseArea.containsMouse ? Theme.primarySelected : Theme.withAlpha(Theme.primary, 0.5);
                    return entryMouseArea.containsMouse ? Theme.withAlpha(Theme.surfaceText, 0.15) : Theme.withAlpha(Theme.surfaceText, 0.07);
                }

                IconImage {
                    id: appIcon
                    anchors.left: parent.left
                    anchors.leftMargin: root.compactMode ? Math.round((parent.width - appEntry.entryIconSize) / 2) : root.iconPadding
                    anchors.verticalCenter: parent.verticalCenter
                    width: appEntry.entryIconSize
                    height: appEntry.entryIconSize
                    source: {
                        root._desktopEntriesUpdateTrigger;
                        root._appIdSubstitutionsTrigger;
                        if (appEntry.isCoreApp && appEntry.coreAppData && appEntry.coreAppData.icon)
                            return Quickshell.iconPath(appEntry.coreAppData.icon, true) || "";
                        if (!appEntry.effectiveAppId)
                            return "";
                        const desktopEntry = DesktopEntries.heuristicLookup(appEntry.effectiveAppId);
                        return Paths.getAppIcon(appEntry.effectiveAppId, desktopEntry);
                    }
                    smooth: true
                    mipmap: true
                    asynchronous: true
                    visible: status === Image.Ready
                }

                DankIcon {
                    anchors.left: parent.left
                    anchors.leftMargin: root.compactMode ? Math.round((parent.width - appEntry.entryIconSize) / 2) : root.iconPadding
                    anchors.verticalCenter: parent.verticalCenter
                    size: appEntry.entryIconSize
                    name: "sports_esports"
                    color: Theme.widgetTextColor
                    visible: !appIcon.visible && Paths.isSteamApp(appEntry.effectiveAppId)
                }

                Text {
                    anchors.centerIn: parent
                    visible: !appIcon.visible && !Paths.isSteamApp(appEntry.effectiveAppId)
                    text: {
                        root._desktopEntriesUpdateTrigger;
                        if (!appEntry.effectiveAppId)
                            return "?";
                        const desktopEntry = DesktopEntries.heuristicLookup(appEntry.effectiveAppId);
                        const appName = Paths.getAppName(appEntry.effectiveAppId, desktopEntry);
                        return appName.charAt(0).toUpperCase();
                    }
                    font.pixelSize: 10
                    color: Theme.widgetTextColor
                }

                StyledText {
                    anchors.left: appIcon.right
                    anchors.leftMargin: root.iconPadding
                    anchors.right: parent.right
                    anchors.rightMargin: root.iconPadding
                    anchors.verticalCenter: parent.verticalCenter
                    visible: !root.compactMode
                    text: appEntry.windowTitle
                    font.pixelSize: Theme.barTextSize(root.barThickness, root.barConfig?.fontScale, root.barConfig?.maximizeWidgetText)
                    color: Theme.widgetTextColor
                    elide: Text.ElideRight
                    maximumLineCount: 1
                }

                Rectangle {
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.rightMargin: root.compactMode ? -2 : 2
                    anchors.bottomMargin: -2
                    width: 14
                    height: 14
                    radius: 7
                    color: Theme.primary
                    visible: appEntry.isGrouped && appEntry.windowCount > 1
                    z: 10

                    StyledText {
                        anchors.centerIn: parent
                        text: appEntry.windowCount > 9 ? "9+" : appEntry.windowCount
                        font.pixelSize: 9
                        color: Theme.surface
                    }
                }

                DankRipple {
                    id: entryRipple
                    cornerRadius: Theme.cornerRadius * 1.5
                }
            }

            MouseArea {
                id: entryMouseArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
                onPressed: mouse => {
                    const pos = mapToItem(entryBackground, mouse.x, mouse.y);
                    entryRipple.trigger(pos.x, pos.y);
                }
                onClicked: mouse => {
                    if (mouse.button === Qt.LeftButton) {
                        if (appEntry.entryData) appEntry.entryData.activateNext();
                    } else if (mouse.button === Qt.MiddleButton) {
                        if (appEntry.entryData) appEntry.entryData.closeRepresentative();
                    } else if (mouse.button === Qt.RightButton) {
                        const globalPos = appEntry.mapToGlobal(appEntry.width / 2, 0);
                        const screenX = root.parentScreen ? root.parentScreen.x : 0;
                        const screenY = root.parentScreen ? root.parentScreen.y : 0;
                        let menuX, menuY;
                        if (root.isVertical) {
                            const relativeY = globalPos.y - screenY;
                            menuX = root.axis?.edge === "left"
                                ? (root.barThickness + root.barSpacing + Theme.spacingXS)
                                : (root.parentScreen.width - root.barThickness - root.barSpacing - Theme.spacingXS);
                            menuY = relativeY;
                        } else {
                            const relativeX = globalPos.x - screenX;
                            const screenHeight = root.parentScreen ? root.parentScreen.height : 1080;
                            const isBottom = (root.axis?.edge ?? "bottom") === "bottom";
                            menuX = relativeX;
                            // The menu now subtracts its measured height for a
                            // bottom bar; do not retain the old fixed 32px row.
                            menuY = isBottom
                                ? (screenHeight - root.barThickness - root.barSpacing - Theme.spacingXS)
                                : (root.barThickness + root.barSpacing + Theme.spacingXS);
                        }
                        root._pendingContextMenu = {
                            "entryRecord": appEntry.entryData,
                            "entryKey": appEntry.entryData ? appEntry.entryData.entryKey : "",
                            "x": menuX,
                            "y": menuY
                        };
                        windowContextMenuLoader.active = true;
                    }
                }
            }
        }
    }
}
