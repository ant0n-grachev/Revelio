# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the extension uses [Semantic Versioning](https://semver.org/).

## Unreleased

The source prepares `v1.0.4`.

### Added

- Added Chromium checks for benign hidden UI text, multilingual text with visual concealment signals, and the installed extension’s coverage warning and rescan behavior.
- Check that the Chrome manifest and npm metadata agree on the application version.

### Changed

- Simplified punctuation in scan evidence, coverage details, and documentation.
- Simplified the popup with one primary scan action and expandable finding evidence.
- Simplified the icon and added dedicated toolbar sizes for better visibility.
- Updated the screenshots with real scans of local demo pages.
- Moved the privacy policy to the repository and redirected the previous policy URL.
- Clarified installation, permissions, coverage limits, and verification in the README and linked documentation.

### Fixed

- Use singular and plural count labels in the popup so findings and coverage warnings read clearly.

## Distribution baseline

The [Chrome Web Store listing](https://chromewebstore.google.com/detail/revelio/hdcjpjjfangdnigmhdnnmhndanhejeem) identifies its published build as `v1.0.0` and gives February 18, 2026 as its last update. This listing does not identify a corresponding Git tag or GitHub release.
