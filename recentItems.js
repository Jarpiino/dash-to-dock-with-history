// Recent and pinned item data helpers, ported from the original customization.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const RECENT_ITEMS_MENU_LIMIT = 10;
const PINNED_ITEMS_MENU_LIMIT = 20;
const RECENT_ITEMS_FILE = 'recently-used.xbel';
const PINNED_ITEMS_DIR = 'dash-to-dock';
const PINNED_ITEMS_FILE = 'pinned-recent-items.json';

function _decodeXmlEntities(text) {
    if (!text)
        return '';

    return text.replace(
        /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
        (match, entity) => {
            switch (entity) {
            case 'amp':
                return '&';
            case 'lt':
                return '<';
            case 'gt':
                return '>';
            case 'quot':
                return '"';
            case 'apos':
                return "'";
            default:
                if (entity.startsWith('#x')) {
                    const codepoint = Number.parseInt(entity.slice(2), 16);
                    return Number.isNaN(codepoint)
                        ? match
                        : String.fromCodePoint(codepoint);
                }

                if (entity.startsWith('#')) {
                    const codepoint = Number.parseInt(entity.slice(1), 10);
                    return Number.isNaN(codepoint)
                        ? match
                        : String.fromCodePoint(codepoint);
                }

                return match;
            }
        }
    );
}

function _getXmlAttribute(text, attribute) {
    const regex = new RegExp(`${attribute}=["']([^"']*)["']`, 'i');
    return _decodeXmlEntities(text.match(regex)?.[1] ?? '');
}

function _getXmlTagText(text, tagName) {
    const regex = new RegExp(
        `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
        'i'
    );
    return _decodeXmlEntities(text.match(regex)?.[1]?.trim() ?? '');
}

function _getRecentItemsPath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), RECENT_ITEMS_FILE]);
}

function _getRecentItemsFileContents() {
    const file = Gio.File.new_for_path(_getRecentItemsPath());

    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return '';

        return new TextDecoder().decode(contents);
    } catch (e) {
        return '';
    }
}

function _getRecentItemDisplayName(uri, title) {
    if (title)
        return title;

    try {
        const file = Gio.File.new_for_uri(uri);
        return file.get_basename() ?? uri;
    } catch (e) {
        return uri;
    }
}

function _getRecentItemTimestamp(bookmarkText) {
    let latest = 0;
    const timestampRegex = /\b(?:visited|modified|added)=["']([^"']+)["']/gi;
    let match;

    while ((match = timestampRegex.exec(bookmarkText))) {
        const date = GLib.DateTime.new_from_iso8601(
            _decodeXmlEntities(match[1]),
            null
        );
        if (!date)
            continue;

        latest = Math.max(latest, date.to_unix());
    }

    return latest;
}

function _getRecentItemApplications(bookmarkText) {
    const applications = [];
    const appRegex = /<application\b([^>]*)\/?>(?:<\/application>)?/gi;
    let match;

    while ((match = appRegex.exec(bookmarkText))) {
        const [, attrs] = match;
        applications.push({
            name: _getXmlAttribute(attrs, 'name'),
            exec: _getXmlAttribute(attrs, 'exec'),
        });
    }

    return applications;
}

function _parseRecentItems() {
    const contents = _getRecentItemsFileContents();
    if (!contents)
        return [];

    const items = [];
    const bookmarkRegex = /<bookmark\b([^>]*)>([\s\S]*?)<\/bookmark>/gi;
    let match;

    while ((match = bookmarkRegex.exec(contents))) {
        const [, attrs, body] = match;
        const uri = _getXmlAttribute(attrs, 'href');
        if (!uri)
            continue;

        const mimeTypeMatch = body.match(
            /<mime:mime-type\b([^>]*)\/?>(?:<\/mime:mime-type>)?/i
        );
        const mimeType = mimeTypeMatch
            ? _getXmlAttribute(mimeTypeMatch[1], 'type')
            : '';
        const title = _getXmlTagText(body, 'title');

        items.push({
            uri,
            mimeType,
            displayName: _getRecentItemDisplayName(uri, title),
            timestamp: _getRecentItemTimestamp(body),
            applications: _getRecentItemApplications(body),
        });
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
}

function _supportedTypeMatchesMimeType(supportedType, mimeType) {
    if (!supportedType || !mimeType)
        return false;

    if (supportedType === mimeType)
        return true;

    if (supportedType.endsWith('/*'))
        return mimeType.startsWith(supportedType.slice(0, -1));

    try {
        return Gio.content_type_is_a(mimeType, supportedType);
    } catch (e) {
        return false;
    }
}

function _appInfoMatchesRecentApplication(appInfo, app, recentApplication) {
    const candidates = [
        app?.get_id?.(),
        appInfo?.get_id?.(),
        appInfo?.get_name?.(),
        appInfo?.get_display_name?.(),
        appInfo?.get_executable?.(),
    ]
        .filter(candidate => !!candidate)
        .map(candidate => candidate.toLowerCase());

    const recentName = recentApplication.name?.toLowerCase();
    const recentExec = recentApplication.exec?.toLowerCase();

    return candidates.some(candidate => {
        const normalized = candidate.endsWith('.desktop')
            ? candidate.slice(0, -'.desktop'.length)
            : candidate;

        return (
            recentName === candidate ||
            recentName === normalized ||
            recentExec?.includes(candidate) ||
            recentExec?.includes(normalized)
        );
    });
}

function _recentItemMatchesApp(item, appInfo, app) {
    const supportedTypes = appInfo?.get_supported_types?.() ?? [];
    if (
        supportedTypes.some(type =>
            _supportedTypeMatchesMimeType(type, item.mimeType)
        )
    )
        return true;

    return item.applications.some(application =>
        _appInfoMatchesRecentApplication(appInfo, app, application)
    );
}

export function getRecentItemsForApp(
    appInfo,
    app,
    limit = RECENT_ITEMS_MENU_LIMIT
) {
    if (!appInfo)
        return [];

    const seenUris = new Set();
    const items = [];

    for (const item of _parseRecentItems()) {
        if (seenUris.has(item.uri))
            continue;

        if (!_recentItemMatchesApp(item, appInfo, app))
            continue;

        seenUris.add(item.uri);
        items.push(item);

        if (items.length >= limit)
            break;
    }

    return items;
}

function _getPinnedItemsPath() {
    return GLib.build_filenamev([
        GLib.get_user_config_dir(),
        PINNED_ITEMS_DIR,
        PINNED_ITEMS_FILE,
    ]);
}

function _getAppPinStoreId(appInfo, app) {
    return (
        app?.get_id?.() ??
        appInfo?.get_id?.() ??
        appInfo?.get_name?.() ??
        'unknown-app'
    );
}

function _loadPinnedItemsStore() {
    const file = Gio.File.new_for_path(_getPinnedItemsPath());

    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return {};

        const parsed = JSON.parse(new TextDecoder().decode(contents));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
    } catch (e) {}

    return {};
}

function _savePinnedItemsStore(store) {
    const dir = GLib.build_filenamev([
        GLib.get_user_config_dir(),
        PINNED_ITEMS_DIR,
    ]);
    const path = _getPinnedItemsPath();

    try {
        GLib.mkdir_with_parents(dir, 0o700);
        GLib.file_set_contents(path, JSON.stringify(store, null, 2));
        return true;
    } catch (e) {
        logError(e, 'Failed to save Dash to Dock pinned recent items');
        return false;
    }
}

function _normalizePinnedItem(item) {
    if (!item?.uri)
        return null;

    return {
        uri: item.uri,
        displayName:
            item.displayName || _getRecentItemDisplayName(item.uri, ''),
        mimeType: item.mimeType || '',
        timestamp: item.timestamp || Math.floor(Date.now() / 1000),
    };
}

export function getPinnedItemsForApp(
    appInfo,
    app,
    limit = PINNED_ITEMS_MENU_LIMIT
) {
    if (!appInfo)
        return [];

    const store = _loadPinnedItemsStore();
    const appId = _getAppPinStoreId(appInfo, app);
    const items = Array.isArray(store[appId]) ? store[appId] : [];
    const seenUris = new Set();
    const pinnedItems = [];

    for (const item of items) {
        const normalized = _normalizePinnedItem(item);
        if (!normalized || seenUris.has(normalized.uri))
            continue;

        seenUris.add(normalized.uri);
        pinnedItems.push(normalized);

        if (pinnedItems.length >= limit)
            break;
    }

    return pinnedItems;
}

export function isItemPinnedForApp(appInfo, app, uri) {
    return getPinnedItemsForApp(appInfo, app, PINNED_ITEMS_MENU_LIMIT).some(
        item => item.uri === uri
    );
}

export function pinItemForApp(appInfo, app, item) {
    if (!appInfo || !item?.uri)
        return false;

    const store = _loadPinnedItemsStore();
    const appId = _getAppPinStoreId(appInfo, app);
    const normalized = _normalizePinnedItem(item);
    if (!normalized)
        return false;

    const items = Array.isArray(store[appId]) ? store[appId] : [];
    store[appId] = [
        normalized,
        ...items.filter(existingItem => existingItem?.uri !== normalized.uri),
    ];

    return _savePinnedItemsStore(store);
}

export function unpinItemForApp(appInfo, app, uri) {
    if (!appInfo || !uri)
        return false;

    const store = _loadPinnedItemsStore();
    const appId = _getAppPinStoreId(appInfo, app);
    const items = Array.isArray(store[appId]) ? store[appId] : [];
    store[appId] = items.filter(item => item?.uri !== uri);

    if (store[appId].length === 0)
        delete store[appId];

    return _savePinnedItemsStore(store);
}

export function launchRecentItem(appInfo, uri) {
    const context = global.create_app_launch_context(0, -1);

    try {
        appInfo.launch_uris([uri], context);
    } catch (e) {
        Gio.AppInfo.launch_default_for_uri(uri, context);
    }
}
