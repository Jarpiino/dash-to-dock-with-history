// Run through run.sh so fixtures never touch the user's history or pins.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const Items = await import(ARGV[0] || '../recentItems.js');
let checks = 0;
function equal(actual, expected, description) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${description}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    checks++;
}

const recentPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const pinDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'dash-to-dock']);
const pinPath = GLib.build_filenamev([pinDir, 'pinned-recent-items.json']);
const app = {get_id: () => 'editor.desktop'};
const appInfo = {
    get_id: () => 'fallback.desktop',
    get_name: () => 'Editor',
    get_display_name: () => 'Editor',
    get_executable: () => 'editor',
    get_supported_types: () => ['text/plain'],
};
function bookmark(uri, mimeType, title = '', application = '', second = 1) {
    return `<bookmark href="${uri}"><title>${title}</title><info><metadata>
        <mime:mime-type type="${mimeType}"/>
        <application name="${application}" exec="${application} %u"
          modified="2026-01-01T00:00:${String(second).padStart(2, '0')}Z"/>
        </metadata></info></bookmark>`;
}
function writeRecent(contents) {
    GLib.file_set_contents(recentPath, `<xbel>${contents}</xbel>`);
}
function readPins() {
    return JSON.parse(new TextDecoder().decode(Gio.File.new_for_path(pinPath).load_contents(null)[1]));
}

equal(Items.getRecentItemsForApp(appInfo, app), [], 'Missing history');
equal(Items.getPinnedItemsForApp(appInfo, app), [], 'Missing pins');
equal(Items.getRecentItemsForApp(null, app), [], 'Missing app info');
writeRecent([
    bookmark('file:///tmp/older.txt', 'text/plain', 'Older', '', 1),
    bookmark('file:///tmp/newer.txt', 'text/plain', 'A &amp; B &#x1f600; &#65;', '', 5),
    bookmark('file:///tmp/newer.txt', 'text/plain', 'Duplicate', '', 3),
    bookmark('file:///tmp/fallback.bin', 'application/octet-stream', '', 'EDITOR', 4),
    bookmark('file:///tmp/ignored.png', 'image/png', '', 'Other', 6),
].join(''));
let recent = Items.getRecentItemsForApp(appInfo, app);
equal(recent.map(item => item.uri), [
    'file:///tmp/newer.txt', 'file:///tmp/fallback.bin', 'file:///tmp/older.txt',
], 'Timestamp order, deduplication and application matching');
equal(recent[0].displayName, 'A & B 😀 A', 'XML entity decoding');
equal(recent[1].displayName, 'fallback.bin', 'Basename fallback');
equal(Items.getRecentItemsForApp(appInfo, app, 1).length, 1, 'Explicit recent limit');
const imageInfo = {...appInfo, get_supported_types: () => ['image/*']};
equal(Items.getRecentItemsForApp(imageInfo, null).map(item => item.uri), [
    'file:///tmp/ignored.png', 'file:///tmp/fallback.bin',
], 'Wildcard MIME matching and recorded application fallback');
const parentInfo = {...appInfo, get_supported_types: () => ['text/plain']};
writeRecent(bookmark('file:///tmp/script.py', 'text/x-python', 'Script'));
equal(Items.getRecentItemsForApp(parentInfo, app).length, 1, 'Gio content type inheritance');
writeRecent(Array.from({length: 14}, (_, i) =>
    bookmark(`file:///tmp/${i}.txt`, 'text/plain', `File ${i}`, '', i + 1)).join(''));
equal(Items.getRecentItemsForApp(appInfo, app).length, 10, 'Original recent limit');
GLib.file_set_contents(recentPath, 'not XML');
equal(Items.getRecentItemsForApp(appInfo, app), [], 'Unusable history');

// Existing JSON has desktop IDs as keys and arrays of these four fields.
GLib.mkdir_with_parents(pinDir, 0o700);
const legacy = {uri: 'file:///tmp/legacy.txt', displayName: 'Legacy', mimeType: 'text/plain', timestamp: 123};
const other = [{uri: 'file:///tmp/other.txt', displayName: 'Other', mimeType: '', timestamp: 456}];
GLib.file_set_contents(pinPath, JSON.stringify({
    'editor.desktop': [legacy, legacy, null, {}],
    'other.desktop': other,
}));
equal(Items.getPinnedItemsForApp(appInfo, app), [legacy], 'Existing JSON, duplicates and invalid entries');
equal(Items.isItemPinnedForApp(appInfo, app, legacy.uri), true, 'Existing pin lookup');
const added = {uri: 'file:///tmp/added.txt', displayName: 'Added', mimeType: 'text/plain', timestamp: 789};
equal(Items.pinItemForApp(appInfo, app, added), true, 'Pin saves successfully');
equal(Items.getPinnedItemsForApp(appInfo, app), [added, legacy], 'New pins first');
equal(readPins()['other.desktop'], other, 'Other app pins preserved');
equal(readPins()['editor.desktop'][0], added, 'Original JSON fields preserved');
equal(Items.pinItemForApp(appInfo, app, legacy), true, 'Repin succeeds');
equal(Items.getPinnedItemsForApp(appInfo, app), [legacy, added], 'Repin moves existing pin to front');
equal(Items.unpinItemForApp(appInfo, app, legacy.uri), true, 'Unpin succeeds');
equal(Items.isItemPinnedForApp(appInfo, app, legacy.uri), false, 'Unpin removes URI');
Items.unpinItemForApp(appInfo, app, added.uri);
equal(Items.getPinnedItemsForApp(appInfo, app), [], 'No valid pins remain');
const emptyApp = {get_id: () => 'empty.desktop'};
Items.pinItemForApp(appInfo, emptyApp, added);
Items.unpinItemForApp(appInfo, emptyApp, added.uri);
equal('empty.desktop' in readPins(), false, 'Empty application key removed');
equal(readPins()['other.desktop'], other, 'Other app survives unpin');
equal(Items.pinItemForApp(null, app, added), false, 'No app info does not write');
equal(Items.pinItemForApp(appInfo, app, {}), false, 'No URI does not write');
for (let i = 0; i < 24; i++)
    Items.pinItemForApp(appInfo, app, {...added, uri: `file:///tmp/pin-${i}.txt`});
equal(Items.getPinnedItemsForApp(appInfo, app).length, 20, 'Original pinned menu limit');
equal(readPins()['editor.desktop'].filter(item => item?.uri).length, 24, 'Menu limit does not truncate storage');
for (const contents of ['invalid JSON', '[]', 'null']) {
    GLib.file_set_contents(pinPath, contents);
    equal(Items.getPinnedItemsForApp(appInfo, app), [], `Invalid store: ${contents}`);
}
Items.pinItemForApp(appInfo, null, {uri: 'file:///tmp/no-title.txt'});
equal(readPins()['fallback.desktop'][0].displayName, 'no-title.txt', 'App ID and name fallbacks');

// Exercise launch and fallback without starting an application.
const context = new Gio.AppLaunchContext();
globalThis.global = {create_app_launch_context: () => context};
let launched;
Items.launchRecentItem({
    launch_uris: (uris, ctx) => {
        launched = [uris, ctx === context];
    },
}, added.uri);
equal(launched, [[added.uri], true], 'Application URI launch');
const originalLaunch = Gio.AppInfo.launch_default_for_uri;
try {
    Gio.AppInfo.launch_default_for_uri = (uri, ctx) => {
        launched = [uri, ctx === context];
    };
    Items.launchRecentItem({
        launch_uris: () => {
            throw new Error('Expected failure');
        },
    }, added.uri);
    equal(launched, [added.uri, true], 'Default URI launch fallback');
} finally {
    Gio.AppInfo.launch_default_for_uri = originalLaunch;
}
print(`Recent/pinned data: ${checks} checks passed (real Gio/GLib, isolated XDG directories)`);
