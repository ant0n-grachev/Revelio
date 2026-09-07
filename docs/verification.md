# Verification — 2026-09-07

Final local verification used Node.js 22.22.0 and Playwright 1.62.1 / Chromium 151.0.7922.34 on macOS.

| Command | Actual final result |
| --- | --- |
| `npm test` | Exit 0: syntax/manifest/packaging check passed for 9 extension files; 38 Node unit tests passed; 28 browser tests passed in 21.9 seconds. |
| `npm run check` | Passed independently and as part of `npm test`; original `activeTab`/`scripting` permissions unchanged. |
| `npm run test:unit` | 38 passed independently and as part of `npm test`. |
| `git diff --check` | Passed. |
| `graphify update .` | Local code graph refreshed per workspace instructions; generated output is ignored. |

The browser suite includes two real unpacked-extension tests with the unchanged manifest: actual toolbar action and activeTab grant, production injection and messaging, literal extension-popup rendering, nested roots, correct tab/scan retention, popup closure during work, clear, restricted-page errors, and temporary extension unload/reload. Other real-browser fixtures use a mocked extension transport to inspect scanner responses; reduced work-limit tests modify private constants only in explicit test copies. The shipped scanner has no test controls.

Final measured fixtures:

- 10,000 ordinary visible spans: 20,006 visited nodes, 967 ms elapsed, 491 timer callbacks during work, complete coverage, zero findings.
- More than 120,000 empty elements: 120,000 visited nodes, 5,338 ms elapsed, explicit `node-budget` stop and incomplete coverage.

The [baseline observations](../tests/baseline-notes.md) measured the old synchronous 10,000-span scan at 159 ms. Cooperative work took longer elapsed time in these local runs and allowed other page tasks to run. These measurements are not a speedup claim or a guarantee for other pages/machines.

The reproduction targets were confirmed on the starting working tree, with one qualification: root labels and highlighting had already improved since the cited review. Identical host/frame IDs and snippets still reproduced incorrect merging; the fixtures now verify element/root identity rather than selector uniqueness. The final review additionally caught and fixed document-title noise, direct shadow-root text, relative/ancestor vertical displacement, and pseudo-element host opacity.

Remaining limits: closed roots cannot be inspected or reliably enumerated; inaccessible frames and restricted pages remain inaccessible; generated-content geometry, complex background composition, language context, and changing DOMs remain heuristic. Reports are document-local and transient. Extension unload/reload can orphan decorative nodes; automatic cleanup across invalidated extension contexts is not verified or claimed, and reloading the webpage clears them. The pagehide cache-discard handler is browser-tested with a persisted pagehide event; browser-specific back/forward-cache eligibility is not assumed. GitHub Actions/Linux/Windows execution has not been verified in this local run.

Final diff review checked owned-reference cleanup, scan-scoped state, listener lifecycle, literal rendering, message identities, and unchanged permissions. At the end of implementation verification, no push, publish, deployment, or production data operation had been performed. The user subsequently authorized committing and pushing the changes to GitHub; store publication and deployment remain outside that authorization.
