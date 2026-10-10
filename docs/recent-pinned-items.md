# Recent Items and Pinned Items port

Based on official Dash to Dock v110 (`2dfae34`), on the existing
`feature/recent-pinned-items` branch. The original repository was read only.

## Source comparison and scope

Compared `dash-to-dock-with-history/appIcons.js` with that repository's HEAD,
`248d42bb64c5e4d21203562f2ef68baf8c9ff083`. Formatting both copies **outside**
the original repository with the same Prettier version reduced the diff to
exactly three additions: the recent/pinned data helpers, the menu row helper,
and the menu section insertion. No unrelated customization was ported.
Original customized file SHA-256:
`ae7c756ad03addf8fa8cabdbfdf3772e6dc08d4200368d6d9a064ffbda3eddd0`.

- `recentItems.js`: original XBEL parsing, MIME/application matching, ordering,
  URI deduplication, JSON storage and launch fallback. Imports Gio/GLib directly
  so the data helpers can be tested outside Shell. Only exports and formatting
  changed; two array reads use destructuring to satisfy repository lint.
- `recentItemsMenu.js`: original section ordering, labels, rows and pin controls.
  Menu operations receive the existing menu object. GNOME 50 rows use
  `Clutter.ClickGesture`; `should-handle-sequence` excludes the pin button and
  its descendants, while `St.Button::clicked` handles pointer, touch and keyboard
  activation. Older rows retain the original button-event path.
- `appIcons.js`: one import and one helper call, immediately after desktop actions
  inside the existing non-window-backed application block. Upstream v110 logic
  otherwise remains intact.
- `Makefile` packages both helpers; `po/POTFILES.in` includes the new menu strings.

## Data compatibility

Reads `$XDG_DATA_HOME/recently-used.xbel` (normally
`~/.local/share/recently-used.xbel`). Pins use
`$XDG_CONFIG_HOME/dash-to-dock/pinned-recent-items.json` (normally
`~/.config/dash-to-dock/pinned-recent-items.json`). No migration is required.

The existing format remains an object keyed by application ID, whose values
are arrays of `{uri, displayName, mimeType, timestamp}`. App key fallback,
newest-pin-first ordering, repinning, per-app unpinning, and preservation of
other applications' data remain unchanged. Original limits are 10 recent
entries (before removing displayed pins) and 20 displayed pins; storage is
not truncated. Timestamp parsing and application matching deliberately retain
the original algorithms.

## Automated validation

Requirements: GJS with Gio/GLib, Node.js with VM modules, and the normal project
build/lint tools. Run from the repository root:

```sh
make test
make check ESLINT=/path/to/eslint
make _build
```

`make test` creates temporary XDG config/data directories and removes them on
exit. It never reads or writes the user's history or pin store and launches no
applications. The 34 data checks cover XBEL parsing, XML entities, ordering,
deduplication, MIME inheritance/wildcards, application fallback, menu limits,
legacy JSON, invalid stores, pin/repin/unpin, application isolation, and both
launch paths. The same data suite passed against the extracted original
helpers. To repeat that comparison, supply a file URI to a temporary module
containing the original helpers with exports and Gio/GLib imports:

```sh
./tests/run.sh file:///absolute/path/to/original-data.js
```

Menu tests load the actual helper with actor doubles and verify headings,
pinned/recent deduplication, accessible labels, icons, button/descendant gesture
exclusion, pin/unpin rebuilding without launch, row activation, empty menus,
and the older event path. These tests do not run a live Shell menu.

Validation performed on GNOME Shell 50.5 with GJS 1.88.1. Installed Shell's
`PopupBaseMenuItem` source confirms the `_clickGesture` integration. Native GI
checks confirm `St.Button::clicked`, `Clutter.Gesture::should-handle-sequence`,
`Clutter.Stage.get_event_actor`, and `Clutter.Actor.contains` are available.
Repository lint and the complete staging build pass, and staging contains
byte-identical copies of both helpers. No install or extension enable command
was run.

## Review before installation

Review the changes and reusable patch series first. Live GNOME Shell 50.5 menu
validation remains pending and should be done in a disposable test session
before installing in the everyday session:

1. Open a dock application's menu with representative existing XBEL and pin
   data; verify Pinned Items precedes Recent Items and pins are not duplicated.
2. Click a recent row: the correct application opens the file and the menu closes.
3. Click pin/unpin controls (also test the icon itself): the menu rebuilds and
   no file opens. Repeat with touch and keyboard Space/Enter.
4. Reopen the menu and restart the disposable session: pins persist using the
   existing JSON format. Check another app's pins are unchanged.
5. Check empty/missing history, apps without matching recent files, window-backed
   apps, window previews, desktop actions, dock favorites and quicklists.
6. Check Shell logs for errors, including enable/disable cycles.

## Reusing patches

The exported series applies to the clean v110 base `2dfae34`. In a separate
checkout based on v110, review the patches, then apply them in numbered order:

```sh
git am /absolute/path/to/dash-to-dock-custom-patches/*.patch
make test
make check ESLINT=/path/to/eslint
make _build
```

Applying or building the patches does not install the extension.
