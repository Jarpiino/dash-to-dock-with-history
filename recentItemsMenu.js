// Recent and pinned item menu integration.
import {Clutter, St} from './dependencies/gi.js';
import {PopupMenu} from './dependencies/shell/ui.js';
import {Extension} from './dependencies/shell/extensions/extension.js';
import {
    getRecentItemsForApp,
    getPinnedItemsForApp,
    isItemPinnedForApp,
    pinItemForApp,
    unpinItemForApp,
    launchRecentItem,
} from './recentItems.js';

const {gettext: __} = Extension;

function appendItem(menu, recentItem, appInfo, app, pinned) {
    const item = new PopupMenu.PopupBaseMenuItem();

    const label = new St.Label({
        text: recentItem.displayName,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    item.add_child(label);

    const pinButton = new St.Button({
        style_class: 'button',
        can_focus: true,
        reactive: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: false,
        child: new St.Icon({
            icon_name: pinned ? 'window-close-symbolic' : 'view-pin-symbolic',
            style_class: 'popup-menu-icon',
        }),
    });
    pinButton.accessible_name = pinned ? __('Unpin Item') : __('Pin Item');

    const togglePin = () => {
        if (pinned)
            unpinItemForApp(appInfo, app, recentItem.uri);
        else
            pinItemForApp(appInfo, app, recentItem);

        menu._rebuildMenu();
    };

    // GNOME 50 menu rows use gestures rather than legacy actor button events.
    // Let the button handle its own pointer, touch and keyboard activation.
    if (item._clickGesture) {
        item._clickGesture.connect('should-handle-sequence', (_gesture, event) => {
            const actor = global.stage.get_event_actor(event);
            return !actor || !pinButton.contains(actor);
        });
        pinButton.connect('clicked', togglePin);
    } else {
        // Preserve the original event handling on older supported Shell versions.
        pinButton.connect('button-press-event', () => Clutter.EVENT_STOP);
        pinButton.connect('button-release-event', () => {
            togglePin();
            return Clutter.EVENT_STOP;
        });
    }

    item.add_child(pinButton);
    menu.addMenuItem(item);

    item.connect('activate', () => {
        launchRecentItem(appInfo, recentItem.uri);
        menu.emit('activate-window', null);
    });

    return item;
}

export function appendRecentItems(menu, appInfo, app) {
    const pinnedItems = getPinnedItemsForApp(appInfo, app);
    const recentItems = getRecentItemsForApp(appInfo, app).filter(
        recentItem => !isItemPinnedForApp(appInfo, app, recentItem.uri)
    );
    if (pinnedItems.length > 0) {
        menu._appendSeparator();
        menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem(__('Pinned Items'))
        );

        pinnedItems.forEach(pinnedItem => {
            appendItem(menu, pinnedItem, appInfo, app, true);
        });
    }

    if (recentItems.length > 0) {
        menu._appendSeparator();
        menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem(__('Recent Items'))
        );

        recentItems.forEach(recentItem => {
            appendItem(menu, recentItem, appInfo, app, false);
        });
    }
}
