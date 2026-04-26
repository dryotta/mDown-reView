# Flow Catalogue

Each flow is a YAML block under an `## <id>` heading; see `flow-schema.md`.
Catalogue avoids native OS dialogs (file/folder pickers) which block WebView2 and freeze CDP.
Use `kind: emit` with the menu event name to trigger app actions that would otherwise need clicking a native menu.

## about-dialog

```yaml
id: about-dialog
name: Open then close the About dialog
priority: 1
steps:
  - { kind: emit, event: "menu-about" }
  - { kind: wait, ms: 200 }
  - { kind: press, key: "Escape" }
  - { kind: wait, ms: 100 }
success_signal:
  selector: "[data-testid='about-dialog']"
```

## settings-dialog

```yaml
id: settings-dialog
name: Open then close Settings
priority: 1
steps:
  - { kind: emit, event: "menu-open-settings" }
  - { kind: wait, ms: 300 }
  - { kind: press, key: "Escape" }
  - { kind: wait, ms: 100 }
success_signal:
  selector: ".settings-dialog, [role='dialog']"
```

## comments-pane-toggle

```yaml
id: comments-pane-toggle
name: Toggle comments pane on and off
priority: 2
steps:
  - { kind: press, key: "Control+Shift+C" }
  - { kind: wait, ms: 150 }
  - { kind: press, key: "Control+Shift+C" }
  - { kind: wait, ms: 150 }
```

## theme-toggle-flash

```yaml
id: theme-toggle-flash
name: Toggle theme via menu events to surface MDR-THEME-FLASH
priority: 2
steps:
  - { kind: emit, event: "menu-theme-light" }
  - { kind: wait, ms: 100 }
  - { kind: emit, event: "menu-theme-dark" }
  - { kind: wait, ms: 100 }
  - { kind: emit, event: "menu-theme-light" }
  - { kind: wait, ms: 100 }
```

## tab-shortcut-noops

```yaml
id: tab-shortcut-noops
name: Tab navigation shortcuts when no tabs open (should noop)
priority: 3
steps:
  - { kind: press, key: "Control+Tab" }
  - { kind: wait, ms: 50 }
  - { kind: press, key: "Control+Shift+Tab" }
  - { kind: wait, ms: 50 }
  - { kind: press, key: "Control+W" }
  - { kind: wait, ms: 50 }
  - { kind: press, key: "Control+Shift+W" }
  - { kind: wait, ms: 50 }
```

## resize-narrow

```yaml
id: resize-narrow
name: Probe responsive layout at narrow widths
priority: 2
steps:
  - { kind: resize, width: 600, height: 800 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 400, height: 800 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 320, height: 600 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 1280, height: 800 }
  - { kind: wait, ms: 100 }
```

## zoom-cycle

```yaml
id: zoom-cycle
name: Zoom shortcuts
priority: 3
steps:
  - { kind: press, key: "Control+=" }
  - { kind: wait, ms: 80 }
  - { kind: press, key: "Control+=" }
  - { kind: wait, ms: 80 }
  - { kind: press, key: "Control+-" }
  - { kind: wait, ms: 80 }
  - { kind: press, key: "Control+0" }
  - { kind: wait, ms: 80 }
```

## check-updates

```yaml
id: check-updates
name: Trigger updater check via menu event
priority: 3
steps:
  - { kind: emit, event: "menu-check-updates" }
  - { kind: wait, ms: 500 }
```

## close-folder-noop

```yaml
id: close-folder-noop
name: Close-folder when none open (should be safe noop)
priority: 3
steps:
  - { kind: emit, event: "menu-close-folder" }
  - { kind: wait, ms: 100 }
```

## settings-then-about

```yaml
id: settings-then-about
name: Open Settings, then About without closing — exposes layered-modal handling
priority: 2
steps:
  - { kind: emit, event: "menu-open-settings" }
  - { kind: wait, ms: 250 }
  - { kind: emit, event: "menu-about" }
  - { kind: wait, ms: 250 }
  - { kind: press, key: "Escape" }
  - { kind: wait, ms: 100 }
  - { kind: press, key: "Escape" }
  - { kind: wait, ms: 100 }
```

## open-folder-and-files

```yaml
id: open-folder-and-files
name: Forward 10 real markdown files to the running app via single-instance
priority: 1
steps:
  - kind: cli
    args:
      - "D:/work/mdownreview2/docs/architecture.md"
      - "D:/work/mdownreview2/docs/design-patterns.md"
      - "D:/work/mdownreview2/docs/performance.md"
      - "D:/work/mdownreview2/docs/principles.md"
      - "D:/work/mdownreview2/docs/security.md"
      - "D:/work/mdownreview2/docs/test-strategy.md"
      - "D:/work/mdownreview2/docs/best-practices-common/README.md"
      - "D:/work/mdownreview2/docs/best-practices-common/react/composition-patterns.md"
      - "D:/work/mdownreview2/docs/best-practices-common/react/react19-apis.md"
      - "D:/work/mdownreview2/docs/best-practices-common/react/rendering-performance.md"
  - { kind: wait, ms: 1500 }
success_signal:
  selector: ".tab-bar [role='tab'], .tab-bar button"
```

## toolbar-resize-with-tabs

```yaml
id: toolbar-resize-with-tabs
name: Resize the window with 10 tabs open to surface toolbar overflow / wrap / clipping
priority: 1
preconditions:
  - "open-folder-and-files"
steps:
  - { kind: resize, width: 1600, height: 900 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 1280, height: 800 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 1024, height: 700 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 800, height: 600 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 640, height: 600 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 480, height: 600 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 360, height: 600 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 320, height: 480 }
  - { kind: wait, ms: 200 }
  - { kind: resize, width: 1280, height: 800 }
  - { kind: wait, ms: 100 }
```

## tab-cycle-with-tabs

```yaml
id: tab-cycle-with-tabs
name: Cycle through opened tabs using keyboard shortcuts
priority: 2
preconditions:
  - "open-folder-and-files"
steps:
  - { kind: press, key: "Control+Tab" }
  - { kind: wait, ms: 100 }
  - { kind: press, key: "Control+Tab" }
  - { kind: wait, ms: 100 }
  - { kind: press, key: "Control+Tab" }
  - { kind: wait, ms: 100 }
  - { kind: press, key: "Control+Shift+Tab" }
  - { kind: wait, ms: 100 }
  - { kind: press, key: "Control+W" }
  - { kind: wait, ms: 150 }
```
