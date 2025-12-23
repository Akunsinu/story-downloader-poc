# Story Downloader POC

A Chrome extension that downloads Instagram stories without marking them as viewed.

## Features

- Downloads all stories for a user with one click
- Captures story data via XHR/fetch interception
- Shows thumbnail grid of all captured stories
- Downloads videos and images in highest quality
- Filenames include username, date, time, and story ID

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select this folder
5. Navigate to any Instagram story page

## Usage

1. Go to an Instagram story page (e.g., `instagram.com/stories/username`)
2. Wait for the extension to capture story data (badge shows count)
3. Click the gradient download button in the bottom right
4. View all captured stories in a grid
5. Click "Download All" or click individual stories to download

## How It Works

The extension intercepts Instagram's API responses to capture story media URLs before they're displayed. This allows downloading without triggering the "viewed" status.

**Technical approach:**
- Content script runs in MAIN world to intercept XHR/fetch
- Bridge script in ISOLATED world handles Chrome API communication
- Background script manages downloads via Chrome's download API
- CSP headers are modified to allow cross-origin media fetching

## File Structure

- `manifest.json` - Extension configuration
- `content-script.js` - Main logic (API interception, UI, story extraction)
- `bridge.js` - Communication bridge between MAIN and ISOLATED worlds
- `background.js` - Service worker for CSP bypass and downloads
- `styles.css` - Button hover styles

## Filename Format

Downloads are saved as:
```
{username}_story_{YYYYMMDD}_{HHMMSS}_{shortcode}_raw.{ext}
```

## Disclaimer

This extension is for educational purposes. Use responsibly and respect content creators' rights.
