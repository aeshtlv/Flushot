# Flushot

A screenshot tool for Windows. Select a region and get a finished picture in a neat frame with a soft
shadow and rounded corners, at full resolution. Windows 10 and 11, x64.

[![CI](https://github.com/aeshtlv/Flushot/actions/workflows/ci.yml/badge.svg)](https://github.com/aeshtlv/Flushot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-4c8bf5)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.2.8-4c8bf5)](CHANGELOG.md)

<p align="center">
  <img src="logo/logo.png" alt="Flushot" width="112">
</p>

| Region selection | Annotations | Result |
|---|---|---|
| ![Region selection](docs/ui-overlay.png) | ![Annotations](docs/ui-annotate.png) | ![Framed card](docs/hero-framed.png) |

## Features

- **Any region.** The result is your selection plus a frame, so any size works: 300×270 or 3840×2160.
  Pixels are copied one to one; nothing is stretched.
- **Framing.** Frame width 0–200 px on all four sides, colour of your choice, rounded corners, a soft
  shadow with adjustable intensity and radius — or a clean screenshot with no border.
- **Annotations.** Arrow, line, rectangle, freehand, text with word wrapping, numbered steps, blur and
  pixelate. Finished annotations can be moved.
- **Text recognition.** The "Text" button reads the screenshot or a selected fragment with the built-in
  Windows OCR engine: offline, nothing downloaded, the image never leaves the machine. The recognised
  text is editable in the panel.
- **Copy and save.** `Ctrl+C` straight to the clipboard, even mid-selection. `Ctrl+S` to a file.
  Optional auto-save, filenames like `screenshot_2026-10-17_14-30-25.png`, PNG, JPEG and WebP.
- **Monitors and DPI.** The selection crosses monitor boundaries and the result is stitched at native
  resolution. Correct at Windows scaling 100, 125, 150 and 200 %.
- **Tray and hotkeys.** Separate hotkeys for a region and for the whole screen, run at login, tray icon
  that follows the taskbar theme.

## Download

Prebuilt archives are attached to **[Releases](../../releases/latest)**. The program is the same in
all three; only the installation method differs.

| File | Description |
|---|---|
| **[Flushot-2.2.8-win64.zip](../../releases/latest/download/Flushot-2.2.8-win64.zip)** | 161 MB. Unpack anywhere and run `Flushot.exe`. Does not need a writable `%TEMP%` — recommended |
| [Flushot-2.2.8-installer.zip](../../releases/latest/download/Flushot-2.2.8-installer.zip) | 113 MB. NSIS installer: Start menu shortcuts, install location, uninstaller |
| [Flushot-2.2.8-portable.zip](../../releases/latest/download/Flushot-2.2.8-portable.zip) | 113 MB. Portable single file, no installation |

The binaries are not code-signed, so SmartScreen warns on first launch: **More info → Run anyway**.
That is standard behaviour for an unsigned executable.

Landing page: **https://flushot.ink**

## Build from source

Requires **Windows 10/11 x64** and **Node.js 20.19+ or 22.12+**.

```bash
git clone https://github.com/aeshtlv/Flushot.git
cd Flushot
npm install
npm run dev
```

```bash
npm run typecheck    # tsc for main and renderer
npm test             # 351 tests in 23 files
npm run build        # production build in out/
npm run dist         # installer and portable build in release/
npm run self-test    # end-to-end check on a live system
```

## Hotkeys

| Keys | Action |
|---|---|
| `Ctrl+Shift+S` | start selecting a region |
| `Ctrl+Shift+3` | capture the whole screen |
| `Enter` | confirm the selection |
| `Ctrl+C` | copy to the clipboard without a preview |
| `Ctrl+S` | save the result |
| `Ctrl+Z` | undo the last annotation |
| `Esc` | reset the selection or close the overlay |
| `Shift` while drawing a line | snap to 0°, 45° or 90° |

Both capture hotkeys are configurable, including a single key without modifiers.

## Limitations

- Capture uses Electron, so protected content (DRM video, some exclusive-fullscreen games) may come out
  black. That is an OS restriction.
- The screenshot is taken at the moment the hotkey is pressed: the overlay shows a frozen frame.
- Only Windows is targeted; macOS and Linux builds are not configured.
- Text recognition reads only the languages installed in Windows, and it makes mistakes on small type
  and on coloured text over images. Mean character error rate on the measured set: 3.22 %.
- `Win+Shift+S` cannot be assigned while the Snipping Tool is installed: the OS keeps that combination.

## Documentation

| Document | Contents |
|---|---|
| [README.md](README.md) | full documentation in Russian: features, settings, structure |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | capture pipeline, DPI handling, image quality, OCR, performance |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | commands, self-test, packaging, site and screenshot checks |
| [docs/GITHUB.md](docs/GITHUB.md) | publishing releases and the site |
| [docs/HOSTING.md](docs/HOSTING.md) | server, domain, HTTPS, deploying the site |
| [CHANGELOG.md](CHANGELOG.md) | version history |
| [docs/ROADMAP.md](docs/ROADMAP.md) | planned directions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to build and what to check before a pull request |

## License

[MIT](LICENSE).
