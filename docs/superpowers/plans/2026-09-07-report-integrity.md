# Revelio correctness and report integrity implementation plan

**Goal:** Implement the supplied correctness, reliability, and report-integrity request with regression evidence.

**Architecture:** Keep the permission-free MV3 popup/content-script design. Extract focused detection and bounded-retention helpers; retain reports only in the current isolated content-script instance. The popup reads authenticated extension messages tied to a document token and scan token. Traverse accessible documents and open roots cooperatively; own every injected node and highlight change by reference.

**Constraints:** Manual and local only; preserve four modes and existing working-tree improvements; no added permissions, backend, remote code, telemetry, push, publish, or deployment. The starting working-tree content.js was preserved in /tmp/revelio-preserved-working-content.js before edits.

- [x] Stage 1: Reproduce old behavior with browser fixtures; add structured detection, color/Unicode and mode unit tests in detection.js and tests/unit.
- [x] Stage 2: Add retention.js and tests for late priority displacement and deduplication. Replace result-count traversal exits with independent node/time/text/root budgets in content.js. Test root identity, skipped frames, owned cleanup, cancellation and repeat scans.
- [x] Stage 3: Move authoritative results, JSON export, progress and locate actions into popup.html/popup.js. Validate bounded report shapes and document/scan tokens in protocol.js; test stale and malformed messages and literal rendering.
- [x] Stage 4: Run real-browser fixtures and actual unpacked-extension messaging smoke; measure a representative large page. Add package/check tooling and CI. Update README/privacy with exact commands, retention and detection/coverage limitations; inspect final diff and package.

Verification: node --test tests/unit/*.test.cjs; Playwright browser tests and unpacked-extension smoke; JavaScript syntax/manifest/package checks; git diff --check and final scope/ownership review. Record actual failures or unavailable environments rather than claiming inferred success.

**Subsequent authorization:** After implementation and verification, the user requested a GitHub push. Commit and push preparation is authorized; no store publication or deployment is included.
