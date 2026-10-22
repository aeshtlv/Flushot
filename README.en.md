# Flushot

**A screenshot tool for Windows.** Select a region and Flushot hands you a finished picture: neatly
framed, with a soft shadow and rounded corners, at full resolution. Nothing to configure before the
first run. Windows 10 and 11, x64.

[![CI](https://github.com/aeshtlv/Flushot/actions/workflows/ci.yml/badge.svg)](https://github.com/aeshtlv/Flushot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-4c8bf5)](LICENSE)

<p align="center">
  <img src="logo/logo.png" alt="Flushot" width="120">
</p>

| Region selection | Annotations | The result |
|---|---|---|
| ![Selection](docs/ui-overlay.png) | ![Annotations](docs/ui-annotate.png) | ![Result](docs/hero-framed.png) |

*Screenshots are captured from the real interface build in a headless browser, not from anyone's desktop.*

> This is the short English summary. The full documentation — feature details, measurements,
> design decisions and their reasons — is in Russian, in [README.md](README.md).

## What it does

- **Any region, any size.** The result is your selection plus a frame, so 300×270 and 3840×2160 both
  work. Pixels are copied one-to-one; nothing is stretched.
- **Framed card.** Frame width 0–200 px on all four sides, colour of your choice, rounded corners,
  a soft shadow — or a clean screenshot with no border at all.
- **Annotations.** Arrow, line, rectangle, freehand, text with word wrapping, numbered steps, move,
  blur and pixelate. Draw on the result and copy it, no separate editor.
- **Text recognition.** The "Text" button reads the screenshot or a selected fragment with the
  built-in Windows OCR engine: offline, nothing downloaded, the image never leaves the machine.
  The recognised text is editable in the panel.
- **Copy and save.** `Ctrl+C` straight to the clipboard (even mid-selection), `Ctrl+S` to a file,
  optional auto-save, filenames like `screenshot_2026-10-17_14-30-25.png`, PNG/JPEG/WebP.
- **Multiple monitors and DPI.** The selection crosses monitor boundaries and the result is stitched
  at native resolution. Correct at Windows scaling 100, 125, 150 and 200 %.
- **Tray and hotkeys.** A configurable hotkey for a region and a second one for the whole screen,
  run at login, tray icon that follows the taskbar theme.

## Download

Prebuilt archives are attached to **[Releases](../../releases/latest)**. The `win64.zip` is the most
reliable option: unpack it and run `Flushot.exe` — it does not need a writable `%TEMP%`.

There is also a landing page with screenshots: **https://aeshtlv.github.io/Flushot/**

The binaries are not code-signed, so SmartScreen may warn you: **More info → Run anyway**.

## Build from source

Requires **Windows 10/11 x64** and **Node.js 20.19+ or 22.12+**.

```bash
npm install
npm run dev          # development with hot reload
npm test             # 351 unit tests in 23 files
npm run typecheck    # tsc for main and renderer
npm run dist         # NSIS installer and portable build in release/
```

## Documentation

| Document | Contents |
|---|---|
| [README.md](README.md) | full feature list, hotkeys, settings, limitations (Russian) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | capture pipeline, DPI handling, image quality, OCR, performance, logo |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | commands, self-test, packaging, site and screenshot checks, test inventory |
| [docs/GITHUB.md](docs/GITHUB.md) | publishing to GitHub: repository, release assets, GitHub Pages |
| [CHANGELOG.md](CHANGELOG.md) | what changed in every version and why |

## Limitations

- Capture uses Electron; protected content (DRM video, some exclusive-fullscreen games) may come out
  black. That is an OS restriction, not a bug in the app.
- Text recognition only reads the languages installed in Windows, and it makes mistakes on small
  type and on coloured text over images. Mean character error rate on the measured set: 3.22 %.
- Only Windows is targeted; macOS and Linux builds are not configured.

## License

[MIT](LICENSE).
