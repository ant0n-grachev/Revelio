# Verification

## Automated checks

The November 12, 2026 run used Node.js 22.22.0 and Playwright 1.62.1 with Chromium 151.0.7922.34 on macOS 27.0.1 (Apple silicon).

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `npm run check` | 11 packaged files, manifest permissions, syntax, and version agreement | 0 | 0 |
| `npm run test:unit` | 39 | 0 | 0 |
| `npm run test:browser` | 30, including 3 installed-extension checks | 0 | 0 |

The [September 7 baseline](https://github.com/ant0n-grachev/Revelio/commit/ee0f52b3f28b4d0d5e53c3bff4393c8dec1abb6e) passed 38 unit and 28 Chromium tests locally. [The baseline also passed on GitHub Actions under Linux/Xvfb](https://github.com/ant0n-grachev/Revelio/actions/runs/34169152214). See the [testing commands and setup](scanning.md#development-and-verification).

## What the browser tests exercise

- **Installed extension.** Chromium loads the unpacked manifest, triggers the toolbar action for an `activeTab` grant, and exercises the actual popup, injection, and messages. Checks cover literal rendering, expandable evidence, highlights, tab isolation, restricted pages, report retention across popup closure, cleanup, and temporary unload/reload. A local page verifies that an empty report can have inaccessible frames, that open and closed shadow roots have different coverage, and that text added after a scan requires a fresh scan.
- **Browser fixtures.** Other tests run the scanner in Chromium with a simulated extension transport. They check cooperative traversal, cancellation, work and result limits, CSS and Unicode evidence, root changes, stale scan rejection, and how the same scan modes treat routine hidden UI and visually concealed sample text in different languages. Selected boundary tests reduce limits in a test copy only. The detection fixtures measure behavior on known examples and do not measure real-world detection accuracy.

## Fixture measurements

| Fixture | November 12, 2026 observation |
| --- | --- |
| 10,000 visible spans | 20,006 nodes visited in 1,072 ms, 491 timer callbacks during work, complete coverage, zero findings |
| More than 120,000 empty elements | 120,000 nodes visited in 5,564 ms, explicit `node-budget` stop and incomplete coverage |

The September 7 cooperative runs took 967 ms and 5,338 ms respectively. The older [synchronous reproduction](../tests/baseline-notes.md) took 159 ms on the visible-span fixture. Cooperative traversal allows other page work while scanning. These timings are observations from local fixtures and vary by page, browser, and machine.

## Coverage limits

The November 12 run covers desktop Chromium on macOS. The suite exercises a synthetic persisted `pagehide` event without establishing browser-specific back/forward-cache eligibility. Extension reload can leave decorative highlights on the page until the page is reloaded. Read the [scanner’s coverage limits](scanning.md#detection-and-coverage-limitations) when interpreting an empty or partial report.
