<div align="center">

<img src="assets/icon.png" width="96" alt="WhatsApp Privacy Blur Desktop Logo">

# WhatsApp Privacy Blur Desktop

A standalone Windows desktop app that adds configurable privacy blur controls to WhatsApp Web.

Blur messages, names, previews, avatars, media, and input text. Reveal only when you need it.

<br>

![Platform](https://img.shields.io/badge/platform-Windows-0078D6?style=for-the-badge)
![Built With](https://img.shields.io/badge/built%20with-Electron-47848F?style=for-the-badge)
![Privacy](https://img.shields.io/badge/privacy-local%20first-00A884?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=for-the-badge)

</div>

---

## Overview

Browser extensions already provide privacy blur for WhatsApp Web.

This project brings that idea into a **desktop-first Windows app**.

It wraps WhatsApp Web in a standalone Electron desktop shell and adds privacy controls, shortcuts, tray behavior, diagnostics, and workflow tools designed for daily desktop use.

Useful when working in:

- Offices
- Public spaces
- Screen-sharing sessions
- Classrooms
- Customer-facing counters
- Shared workstations

---

## Screenshots

| Chat Blur | Hover Reveal |
|---|---|
| <img src="screenshots/chat-blur.png" alt="Chat Blur"> | <img src="screenshots/hover-reveal.png" alt="Hover Reveal"> |

| Settings | Diagnostics |
|---|---|
| <img src="screenshots/settings.png" alt="Settings"> | <img src="screenshots/diagnostics.png" alt="Diagnostics"> |

---

## Key Features

### Privacy Blur

Configure blur for:

| Surface | Supported |
|---|---|
| Chat messages | Yes |
| Last message previews | Yes |
| Media previews | Yes |
| Gallery thumbnails | Yes |
| Text input | Yes |
| Profile pictures | Yes |
| Group and user names | Yes |

Reveal content temporarily when needed.

---

## Desktop Features

- Standalone Windows desktop app
- Persistent WhatsApp Web session
- System tray support
- Close-to-tray mode
- Unread count in tray/taskbar when detectable
- Always-on-top mode
- First-run privacy setup wizard
- Local diagnostics window
- Safe JSON diagnostics export
- Dynamic Chromium user agent for better media compatibility
- Optional hardware acceleration fallback for video/GPU issues

---

## Chat Workflow Tools

- Jump to top of current chat
- Jump to latest message
- Continue through WhatsApp's "Click to load old messages" prompt
- Cancel old-message loading
- Restore unread-list position
- Copy current chat title
- Open current chat media/info panel when available
- Quick reply templates that insert text but never auto-send

---

## Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + X` | Toggle privacy blur |
| `Ctrl + ,` | Open settings |
| `Ctrl + R` | Reload WhatsApp Web |
| `Ctrl + Alt + R` | Reveal temporarily |
| `Ctrl + Alt + Home` | Go to top of current chat |
| `Ctrl + Alt + End` | Go to latest message |
| `Ctrl + Alt + Esc` | Stop loading older messages |
| `Ctrl + Alt + T` | Toggle always-on-top |
| `Ctrl + Alt + U` | Return to unread-list position |
| `Ctrl + Alt + F` | Toggle focus mode |
| `Ctrl + Alt + Q` | Open quick reply templates |

---

## Privacy First

This app does not collect, upload, or export WhatsApp messages.

It does not include:

- WhatsApp messages
- Cookies
- Session files
- DOM content
- Media files
- Chat history

Diagnostics are local and redacted.

The app loads:

```text
https://web.whatsapp.com/

```

The persistent session partition is:

```text
persist:whatsapp-privacy-blur
```

---

## Download

Recommended installer:

```text
release/WhatsApp Privacy Blur Setup 1.0.0.exe
```

Portable executable:

```text
release/WhatsApp Privacy Blur.exe
```

The installer is recommended for reliable Start Menu and taskbar pinning.

---

## Release Checksums

Portable executable SHA-256:

```text
ADA082D791CCAA120E41401EBB3280B30E7086025EDF8840993E5F5D0CD0BAD1
```

Installer SHA-256:

```text
4740256FE84B2C5E102434E6A437EB5BB7CF0D0CE2C3A6D02D37AF09D52B1522
```

---

## Development

Install dependencies:

```powershell
cd app
npm.cmd install
```

Run in development:

```powershell
cd app
npm.cmd start
```

Run tests:

```powershell
cd app
npm.cmd test
```

Build Windows portable exe and installer:

```powershell
cd app
npm.cmd run build
```

Build outputs:

```text
app/dist/WhatsApp Privacy Blur-1.0.0-portable.exe
app/dist/WhatsApp Privacy Blur Setup 1.0.0.exe
```

---

## Tech Stack

| Area | Technology |
|---|---|
| Desktop shell | Electron |
| Runtime | Chromium WebContents |
| Language | JavaScript |
| Security boundary | Context-isolated preload scripts |
| App communication | Electron IPC |
| Packaging | electron-builder |
| Testing | Node built-in test runner |
| Platform | Windows |

---

## Architecture

```text
WhatsApp Privacy Blur Desktop
│
├── Main Process
│   ├── Windows
│   ├── Menus
│   ├── Tray
│   ├── Shortcuts
│   ├── Settings persistence
│   ├── Diagnostics
│   └── Packaging behavior
│
├── WhatsApp Preload
│   ├── Privacy blur detection
│   ├── DOM marking
│   ├── Hover reveal
│   ├── Chat navigation overlay
│   ├── Quick replies
│   └── Media diagnostics
│
└── Local App Windows
    ├── Settings
    ├── First-run wizard
    └── Diagnostics
```

---

## Project Structure

```text
WhatsappApplicationBlur/
  README.md
  release/
    WhatsApp Privacy Blur.exe
    WhatsApp Privacy Blur Updated.exe
    WhatsApp Privacy Blur Setup 1.0.0.exe
  app/
    package.json
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

---

## Diagnostics

The diagnostics export includes:

- App/runtime versions
- Redacted settings
- Process memory summaries
- Recent memory samples
- Last optimize result
- Executable path
- Actual WhatsApp user agent
- GPU feature status
- Recent app events
- Icon paths and metadata

It does not include WhatsApp messages, cookies, session files, DOM content, or media.

Runtime logs are written to Electron's app data directory:

```text
<userData>/logs/app.log
```

---

## Taskbar Pinning

Portable Electron apps can be pinned from Windows Explorer, but taskbar behavior can be inconsistent because portable apps may extract and run from temporary locations.

For best results:

1. Use the installer.
2. Launch from the Start Menu.
3. Pin the installed app to the taskbar.
4. Unpin any old portable shortcuts.

---

## Notes

WhatsApp Web changes frequently. If WhatsApp changes its internal layout, some blur selectors or workflow helpers may need updates.

This app is an independent desktop wrapper around WhatsApp Web.

It does not patch the official WhatsApp Desktop app and does not implement the WhatsApp protocol.

---

## Disclaimer

WhatsApp is a trademark of WhatsApp LLC.

This project is independent and is not affiliated with, endorsed by, or sponsored by WhatsApp, Meta, or WhatsApp LLC.

---

## License

MIT License
