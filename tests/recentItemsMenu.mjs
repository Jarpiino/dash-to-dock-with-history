// Test menu behavior with actor doubles; live Shell interaction remains a review check.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {URL} from 'node:url';

async function testMenu(gestures) {
    class Actor {
        constructor(params = {}) {
            Object.assign(this, params);
            this.children = [];
            this.signals = new Map();
        }

        add_child(child) {
            this.children.push(child);
        }

        connect(name, callback) {
            this.signals.set(name, callback);
        }

        contains(actor) {
            return actor === this || this.children.some(child => child.contains(actor));
        }
    }
    class Row extends Actor {
        constructor() {
            super();
            if (gestures)
                this._clickGesture = new Actor();
        }
    }
    class Separator extends Actor {
        constructor(label) {
            super({label});
        }
    }
    const pinnedItem = {uri: 'file:///pinned.txt', displayName: 'Pinned'};
    const recentItem = {uri: 'file:///recent.txt', displayName: 'Recent'};
    let pinned = [pinnedItem];
    let recent = [pinnedItem, recentItem];
    const calls = [];
    const data = {
        getPinnedItemsForApp: () => pinned,
        getRecentItemsForApp: () => recent,
        isItemPinnedForApp: (_info, _app, uri) => pinned.some(item => item.uri === uri),
        pinItemForApp: (_info, _app, item) => calls.push(['pin', item.uri]),
        unpinItemForApp: (_info, _app, uri) => calls.push(['unpin', uri]),
        launchRecentItem: (_info, uri) => calls.push(['launch', uri]),
    };
    const context = vm.createContext({global: {stage: {get_event_actor: event => event.actor}}});
    const exportsByModule = {
        './dependencies/gi.js': {
            Clutter: {ActorAlign: {CENTER: 0, END: 1}, EVENT_STOP: 'stop'},
            St: {Label: Actor, Button: Actor, Icon: Actor},
        },
        './dependencies/shell/ui.js': {PopupMenu: {PopupBaseMenuItem: Row, PopupSeparatorMenuItem: Separator}},
        './dependencies/shell/extensions/extension.js': {Extension: {gettext: text => text}},
        './recentItems.js': data,
    };
    const module = new vm.SourceTextModule(await readFile(new URL('../recentItemsMenu.js', import.meta.url), 'utf8'),
        {context});
    await module.link(specifier => {
        const values = exportsByModule[specifier];
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [name, value] of Object.entries(values))
                // SyntheticModule calls this initializer with the module as receiver.
                // eslint-disable-next-line no-invalid-this
                this.setExport(name, value);
        }, {context});
    });
    await module.evaluate();
    const menu = {
        items: [],
        addMenuItem(item) {
            this.items.push(item);
        },
        _appendSeparator() {
            this.items.push(new Separator(''));
        },
        _rebuildMenu() {
            calls.push(['rebuild']);
        },
        emit(name, window) {
            calls.push([name, window]);
        },
    };
    module.namespace.appendRecentItems(menu, {}, {});
    assert.deepEqual(menu.items.filter(item => item instanceof Separator).map(item => item.label),
        ['', 'Pinned Items', '', 'Recent Items']);
    const rows = menu.items.filter(item => item instanceof Row);
    assert.equal(rows.length, 2, 'Pinned URI excluded from recent section');
    for (const [i, row] of rows.entries()) {
        const button = row.children[1];
        assert.equal(button.accessible_name, i ? 'Pin Item' : 'Unpin Item');
        assert.equal(button.child.icon_name, i ? 'view-pin-symbolic' : 'window-close-symbolic');
        if (gestures) {
            const accepts = row._clickGesture.signals.get('should-handle-sequence');
            assert.equal(accepts(null, {actor: button}), false);
            button.add_child(button.child);
            assert.equal(accepts(null, {actor: button.child}), false);
            assert.equal(accepts(null, {actor: row.children[0]}), true);
            assert.equal(accepts(null, {actor: null}), true);
            assert.equal(button.signals.has('button-release-event'), false);
            button.signals.get('clicked')();
        } else {
            assert.equal(button.signals.get('button-press-event')(), 'stop');
            assert.equal(button.signals.get('button-release-event')(), 'stop');
        }
        assert.deepEqual(calls.splice(0), [[i ? 'pin' : 'unpin', i ? recentItem.uri : pinnedItem.uri], ['rebuild']],
            'Pin button rebuilds without launching');
        row.signals.get('activate')();
        assert.deepEqual(calls.splice(0), [['launch', i ? recentItem.uri : pinnedItem.uri], ['activate-window', null]],
            'Row launches and emits activation');
    }
    pinned = [];
    recent = [];
    menu.items = [];
    module.namespace.appendRecentItems(menu, {}, {});
    assert.equal(menu.items.length, 0, 'Empty history adds no sections');
    console.log(`Menu behavior passed (${gestures ? 'GNOME 50 gestures' : 'legacy events'}; actor doubles)`);
}

await testMenu(true);
await testMenu(false);
