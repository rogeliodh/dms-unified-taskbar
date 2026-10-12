import QtQuick
import qs.Common
import qs.Modules.Plugins

PluginSettings {
    id: root
    pluginId: "unifiedTaskbar"

    ToggleSetting {
        settingKey: "compactMode"
        label: "Compact Mode"
        description: "Show only app icons without window titles"
        defaultValue: false
    }

    ToggleSetting {
        settingKey: "groupByApp"
        label: "Group by App"
        description: "Collapse multiple windows of the same app into one entry with a count badge"
        defaultValue: false
    }

    StringSetting {
        settingKey: "ungroupAppIds"
        label: "Ungroup Apps"
        description: "App IDs that are never grouped (one entry per window), comma-separated"
        placeholder: "e.g. app_id, other_app"
        defaultValue: ""
    }

    ToggleSetting {
        settingKey: "allMonitors"
        label: "Show All Monitors"
        description: "Show workspaces from all monitors instead of only the current one"
        defaultValue: false
    }

    ToggleSetting {
        settingKey: "currentWorkspaceOnly"
        label: "Current Workspace Only"
        description: "Show only the active workspace pill instead of every workspace with windows"
        defaultValue: false
    }

    StringSetting {
        settingKey: "hiddenAppIds"
        label: "Hidden Apps"
        description: "App IDs to hide from the taskbar, comma-separated (e.g. quake)"
        placeholder: "quake"
        defaultValue: ""
    }

    ToggleSetting {
        settingKey: "reverseMonitorOrder"
        label: "Reverse Monitor Order"
        description: "Reverse the order in which monitors are displayed when showing all monitors"
        defaultValue: false
    }

    ToggleSetting {
        settingKey: "filledPills"
        label: "Filled Pills (Vertical)"
        description: "Use solid filled workspace pills instead of outlined borders"
        defaultValue: false
    }

    SliderSetting {
        settingKey: "iconPadding"
        label: "Icon Padding"
        minimum: 0
        maximum: 10
        defaultValue: 4
    }

    SliderSetting {
        settingKey: "itemSpacing"
        label: "Item Spacing"
        minimum: 0
        maximum: 10
        defaultValue: 2
    }

    SliderSetting {
        settingKey: "workspaceSpacing"
        label: "Workspace Spacing"
        description: "Space between workspace pills"
        minimum: 0
        maximum: 20
        defaultValue: 4
    }

    StringSetting {
        settingKey: "screenOverrides"
        label: "Per-Screen Overrides (JSON)"
        description: "Override any setting for a specific monitor, keyed by output name — e.g. {\"HDMI-A-2\": {\"ungroupAppIds\": \"firefox_firefox\"}}"
        placeholder: "{\"HDMI-A-2\": {\"compactMode\": true}}"
        defaultValue: ""
    }
}
