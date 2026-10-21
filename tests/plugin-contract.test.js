const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => readFileSync(path.join(__dirname, "..", name), "utf8");
const qml = read("UnifiedTaskbar.qml");
const supportedCompositors = ["niri", "hyprland", "sway"];

// Source contracts only: these checks do not render the DMS UI.
function uniqueAnchor(source, anchor, label) {
    const index = source.indexOf(anchor);
    assert.notEqual(index, -1, `${label} anchor is missing`);
    assert.equal(source.indexOf(anchor, index + anchor.length), -1,
        `${label} anchor must occur exactly once`);
    return index;
}

function extractBalanced(source, openingIndex, label) {
    assert.equal(source[openingIndex], "{", `${label} must start at an opening brace`);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = openingIndex; index < source.length; index++) {
        const character = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (character === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === "*" && next === "/") {
                blockComment = false;
                index++;
            }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === "/" && next === "/") {
            lineComment = true;
            index++;
        } else if (character === "/" && next === "*") {
            blockComment = true;
            index++;
        } else if (character === "'" || character === '"' || character === "`") {
            quote = character;
        } else if (character === "{") {
            depth++;
        } else if (character === "}") {
            depth--;
            if (depth === 0) return source.slice(openingIndex, index + 1);
            assert.ok(depth > 0, `${label} closed before its opening brace`);
        }
    }
    assert.fail(`${label} has no balanced closing brace`);
}

function objectAtAnchor(source, anchor, label) {
    const index = uniqueAnchor(source, anchor, label);
    const headers = [...source.slice(0, index).matchAll(/^\s*(\w+)\s*\{/gm)];
    assert.ok(headers.length, `${label} must have an enclosing object`);
    const header = headers.at(-1);
    const opening = header.index + header[0].lastIndexOf("{");
    const body = extractBalanced(source, opening, label);
    assert.ok(opening + body.length > index + anchor.length,
        `${label} anchor must be inside the selected object`);
    return { type: header[1], body };
}

function section(source, heading) {
    const anchor = `## ${heading}\n`;
    const start = uniqueAnchor(source, anchor, heading) + anchor.length;
    const end = source.indexOf("\n## ", start);
    return source.slice(start, end === -1 ? source.length : end);
}

test("manifest_advertises_supported_compositors", () => {
    assert.deepEqual(JSON.parse(read("plugin.json")).compositors, supportedCompositors);
});

test("readme_matches_advertised_compositors", () => {
    const readme = read("README.md");
    const features = section(readme, "Features");
    const supportLine = features.split("\n").filter(line => /compositor/i.test(line));
    assert.equal(supportLine.length, 1, "Features must have one compositor support statement");
    assert.equal(supportLine[0], "- Supported compositors: Niri, Hyprland, Sway");
    assert.doesNotMatch(features, /\b(?:DWL|Mango|Scroll|Miracle)\b/);
    const requirements = section(readme, "Requirements");
    assert.match(requirements, /^- Niri, Hyprland, or Sway$/m);
    assert.match(requirements, /Mango and other compositors are not supported\./);
    assert.match(requirements, /Legacy DWL code remains.*not part of current supported compatibility\./);
});

test("fallback_letter_uses_themed_styled_text", () => {
    const fallback = objectAtAnchor(qml,
        "visible: !appIcon.visible && !Paths.isSteamApp(appEntry.effectiveAppId)", "fallback letter");
    assert.equal(fallback.type, "StyledText");
    assert.match(fallback.body, /^\s*visible: !appIcon\.visible && !Paths\.isSteamApp\(appEntry\.effectiveAppId\)\s*$/m);
    assert.match(fallback.body, /^\s*font\.pixelSize: Theme\.fontSizeSmall\s*$/m);
    assert.match(fallback.body, /anchors\.centerIn: parent/);
    assert.match(fallback.body, /color: Theme\.widgetTextColor/);
    assert.match(fallback.body, /root\._desktopEntriesUpdateTrigger;/);
    assert.match(fallback.body, /if \(!appEntry\.effectiveAppId\)\s*return "\?";/);
    assert.match(fallback.body, /const desktopEntry = DesktopEntries\.heuristicLookup\(appEntry\.effectiveAppId\);/);
    assert.match(fallback.body, /const appName = Paths\.getAppName\(appEntry\.effectiveAppId, desktopEntry\);/);
    assert.match(fallback.body, /return appName\.charAt\(0\)\.toUpperCase\(\);/);
});

test("count_badge_uses_themed_text_and_content_sizing", () => {
    const badge = objectAtAnchor(qml,
        "visible: appEntry.isGrouped && appEntry.windowCount > 1", "count badge");
    assert.equal(badge.type, "Rectangle");
    assert.match(badge.body, /^\s*visible: appEntry\.isGrouped && appEntry\.windowCount > 1\s*$/m);
    const label = objectAtAnchor(badge.body, "id: countBadgeLabel", "count badge label");
    assert.equal(label.type, "StyledText");
    assert.match(label.body, /^\s*font\.pixelSize: Theme\.fontSizeSmall \* 0\.8\s*$/m);
    assert.match(label.body, /^\s*text: appEntry\.windowCount > 9 \? "9\+" : appEntry\.windowCount\s*$/m);
    assert.match(label.body, /anchors\.centerIn: parent/);
    assert.match(label.body, /color: Theme\.surface/);
    assert.match(badge.body, /^\s*width: Math\.max\(14, countBadgeLabel\.implicitWidth \+ 4\)\s*$/m);
    assert.match(badge.body, /^\s*height: Math\.max\(14, countBadgeLabel\.implicitHeight \+ 4\)\s*$/m);
    assert.match(badge.body, /^\s*radius: height \/ 2\s*$/m);
    assert.match(badge.body, /anchors\.right: parent\.right/);
    assert.match(badge.body, /anchors\.bottom: parent\.bottom/);
    assert.match(badge.body, /anchors\.rightMargin: root\.compactMode \? -2 : 2/);
    assert.match(badge.body, /anchors\.bottomMargin: -2/);
    assert.match(badge.body, /color: Theme\.primary/);
    assert.match(badge.body, /^\s*z: 10\s*$/m);
});
