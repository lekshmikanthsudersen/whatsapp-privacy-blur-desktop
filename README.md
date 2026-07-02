# WhatsApp Privacy Blur

Standalone Windows desktop wrapper for WhatsApp Web with privacy blur controls.

This repository is intentionally kept small and clean. It contains the stable Electron source code, app icon assets, package metadata, and Windows release executables.

## Final Executable

The latest refreshed portable executable is here:

```text
release/WhatsApp Privacy Blur Updated.exe
```

For reliable Windows taskbar pinning, use the installer build when available:

```text
release/WhatsApp Privacy Blur Setup 1.0.0.exe
```

Latest portable SHA-256:

```text
ADA082D791CCAA120E41401EBB3280B30E7086025EDF8840993E5F5D0CD0BAD1
```

Canonical portable SHA-256:

```text
ADA082D791CCAA120E41401EBB3280B30E7086025EDF8840993E5F5D0CD0BAD1
```

Installer SHA-256:

```text
4740256FE84B2C5E102434E6A437EB5BB7CF0D0CE2C3A6D02D37AF09D52B1522
```

If `release/WhatsApp Privacy Blur.exe` is running, Windows locks that file. Quit the app fully from the tray before replacing it with `release/WhatsApp Privacy Blur Updated.exe`.

## Project Layout

```text
WhatsappApplicationBlur/
  README.md
  .gitignore
  release/
    WhatsApp Privacy Blur.exe
    WhatsApp Privacy Blur Updated.exe
    WhatsApp Privacy Blur Setup 1.0.0.exe
  app/
    package.json
    package-lock.json
    assets/
      icon.ico
      icon.png
    src/
      main.js
      preload-whatsapp.js
      preload-settings.js
      workflow-helpers.js
      first-run.html
      first-run.js
      diagnostics.html
      diagnostics.js
      settings.html
      settings.css
      settings.js
    test/
      settings-page.test.js
      workflow-helpers.test.js
```

Important files:

- `app/src/main.js`: Electron main process, WhatsApp window, menu, settings persistence, shortcuts.
- `app/src/preload-whatsapp.js`: Privacy blur injection for WhatsApp Web.
- `app/src/preload-settings.js`: Safe IPC bridge for the settings window.
- `app/src/workflow-helpers.js`: Shared pure helpers for settings validation, quiet hours, unread count, memory summaries, and tray attention state.
- `app/src/first-run.html`: First-run privacy preset wizard.
- `app/src/diagnostics.html`: Local diagnostics and export window.
- `app/src/settings.html`: Settings UI markup.
- `app/src/settings.css`: Settings UI styling.
- `app/src/settings.js`: Settings UI behavior.
- `app/test/settings-page.test.js`: Unit tests for settings-page fallback behavior.
- `app/test/workflow-helpers.test.js`: Unit tests for shared desktop workflow logic.
- `app/assets/icon.ico`: Windows executable icon.
- `release/WhatsApp Privacy Blur Updated.exe`: Latest portable executable.
- `release/WhatsApp Privacy Blur.exe`: Canonical portable executable. If it is running, Windows prevents overwriting it.
- `release/WhatsApp Privacy Blur Setup 1.0.0.exe`: Installer build recommended for taskbar pinning.

## Features

- Wraps `https://web.whatsapp.com/` in a standalone Electron window.
- Uses a persistent Electron session partition named `persist:whatsapp-privacy-blur`, so WhatsApp login state is retained.
- Provides privacy blur controls for:
  - Chat messages
  - Chat list previews
  - Media
  - Gallery thumbnails
  - Text input
  - Profile pictures
  - Group/user names
- Supports app-hover reveal behavior when enabled.
- Provides a settings window and menu controls.
- Keeps external links outside WhatsApp opening in the default browser.
- Uses single-instance desktop behavior so pinned shortcuts focus the existing window.
- Hides to the system tray when the close button is pressed.
- Shows unread count in the tray/taskbar when WhatsApp exposes it in the page title.
- Includes visible current-chat navigation buttons plus keyboard shortcuts.
- The `Top` action can continue through WhatsApp's "Click to load old messages" prompt and shows a loader while older batches are being loaded.
- The old-message loader can be cancelled from the loader or with a shortcut.
- Supports temporary reveal with automatic re-blur.
- Includes quick chat zoom presets.
- Includes a first-run privacy preset wizard.
- Includes a local diagnostics window and safe JSON export.
- Includes an always-on-top window toggle.
- Uses a PNG-derived tray icon to avoid Windows showing the generic shell icon in the notification area.
- Preserves and restores unread-list scroll position for users who work from WhatsApp's unread filter.
- Supports focus mode, quiet hours, priority unread hints, and high-memory warnings without reading message content.
- Provides local quick reply templates that insert text into the WhatsApp input but never auto-send.
- Provides desktop helper actions for copying the current chat title and opening the current chat media/info panel when WhatsApp exposes it.
- Provides a manual `Optimize Now` action that records before/after memory metrics and runs only conservative cleanup.
- Uses a dynamic Chromium user agent based on the Electron runtime to reduce WhatsApp media/status playback compatibility issues.
- Logs preload, renderer, navigation, and console failures to the app data diagnostics log.
- Keeps the settings page visible in fallback mode if the preload bridge or settings IPC fails.
- Includes optional hardware acceleration disablement for GPU/video troubleshooting. This requires an app restart and is off by default.

## Shortcuts

- `Alt+X`: Toggle privacy blur on or off.
- `Ctrl+,`: Open settings.
- `Ctrl+R`: Reload WhatsApp Web.
- `Ctrl+Alt+R`: Reveal blurred content temporarily.
- `Ctrl+Alt+Home`: Go to the top of the current chat and load older message batches when WhatsApp asks.
- `Ctrl+Alt+End`: Go to the latest message in the current chat.
- `Ctrl+Alt+Esc`: Stop loading older messages.
- `Ctrl+Alt+T`: Toggle always-on-top mode.
- `Ctrl+Alt+U`: Return to the saved unread-list position.
- `Ctrl+Alt+F`: Toggle focus mode.
- `Ctrl+Alt+Q`: Open quick reply templates.

When a chat is open, the WhatsApp window also shows small `Top` and `Latest` buttons near the top-right of the chat area. `Top` scrolls upward and clicks WhatsApp's old-message loader prompt when it appears. The loader includes a `Cancel` button. These controls are hidden on the login screen and other non-chat views.

## Requirements For Development

Install these first:

- Windows 10 or Windows 11
- Node.js and npm

The app uses Electron and electron-builder from `app/package.json`.

## Install Dependencies

From the project root:

```powershell
cd app
npm.cmd install
```

This recreates `app/node_modules/`, which is intentionally not stored in the cleaned project folder.

## Run In Development

```powershell
cd app
npm.cmd start
```

This starts Electron directly from the source files in `app/src`.

## Test

```powershell
cd app
npm.cmd test
```

`npm test` runs JavaScript syntax checks plus Node's built-in test runner for shared workflow logic, settings-page fallback behavior, dynamic user-agent generation, and diagnostics redaction.

## Build The EXE And Installer

```powershell
cd app
npm.cmd run build
```

The generated build outputs are written to:

```text
app/dist/WhatsApp Privacy Blur-1.0.0-portable.exe
app/dist/WhatsApp Privacy Blur Setup 1.0.0.exe
```

`app/dist/` is ignored by git because it is generated output. Release-ready files are kept separately in `release/`.

## Taskbar Pinning

Portable Electron apps can be pinned from Windows Explorer, but taskbar launch behavior can be inconsistent because the portable app extracts and runs from a temporary location.

For reliable pinning:

1. Unpin any old portable shortcut from the taskbar.
2. Build or use the NSIS installer.
3. Install the app.
4. Launch it from the Start Menu.
5. Pin that installed app to the taskbar.

The app sets a stable Windows AppUserModelID:

```text
local.whatsappprivacyblur.app
```

The app also uses single-instance behavior, so clicking the pinned app should focus the existing WhatsApp Privacy Blur window instead of opening a duplicate process.

The installer, uninstaller, installed app, and window all use `app/assets/icon.ico`. The system tray uses `app/assets/icon.png` resized through Electron's native image API, because the tray surface can otherwise fall back to a generic Windows shell icon.

If Windows still shows an old or generic icon:

1. Quit the app fully from the tray menu.
2. Unpin old taskbar shortcuts.
3. Reinstall or relaunch the latest executable from `release/`.
4. Launch the installed app from the Start Menu.
5. Pin that newly launched app.

Windows caches shortcut icons aggressively, so old pins may keep showing the previous icon even after the executable has been fixed.

## How The App Works

1. `main.js` creates one Electron `BrowserWindow` for WhatsApp Web.
2. The WhatsApp window loads `preload-whatsapp.js`.
3. The preload script scans WhatsApp Web DOM elements and marks privacy-sensitive elements with `data-wapb-kind`.
4. CSS injected by the preload script applies blur to marked elements based on the saved settings.
5. Settings are stored in Electron's `userData` directory as `settings.json`.
6. The menu and settings window update the active WhatsApp window through IPC.
7. Chat navigation commands are sent from the Electron menu or the in-chat navigation buttons to the WhatsApp preload script.
8. The preload script finds the active chat scroll container and scrolls it to the top or latest message.
9. The preload script owns local workflow helpers such as unread-list scroll restore, quick reply insertion, current chat title copy, and the media/info helper.
10. The main process owns tray behavior, unread title parsing, diagnostics, first-run setup, zoom presets, memory sampling, quiet/focus state, and manual optimization.

## Settings Storage

Settings are saved outside the project folder in Electron's app data directory.

The session/login partition is:

```text
persist:whatsapp-privacy-blur
```

That partition is intentionally stable so WhatsApp login persists between launches.

## Diagnostics Export

The diagnostics export is a local JSON file. It includes app/runtime versions, redacted settings, process memory summaries, recent memory samples, last optimize result, executable path, actual WhatsApp user agent, GPU feature status, recent app events, icon paths, ICO entry sizes, and icon/session metadata.

It does not include WhatsApp messages, cookies, session files, DOM content, or media.

Runtime logs are written to Electron's app data directory:

```text
<userData>/logs/app.log
```

## Clean Project Policy

The repository keeps only source and deliverable files. These are intentionally excluded:

- `node_modules/`
- `app/node_modules/`
- `app/dist/`
- logs
- memory diagnostic JSON files
- temporary rollback/extraction folders

If dependencies or build output are needed, regenerate them with `npm.cmd install` and `npm.cmd run build`.

## Notes

- This is an independent Electron wrapper around WhatsApp Web.
- It does not patch Meta's official WhatsApp Desktop app.
- It does not implement the WhatsApp protocol directly.
- If WhatsApp Web changes its internal DOM structure, blur selectors in `app/src/preload-whatsapp.js` may need adjustment.
