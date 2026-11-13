# Scanning, privacy, and development

Revelio is a manually triggered Chrome extension that identifies potentially hidden or suspicious webpage text. It scans locally, using packaged JavaScript and browser DOM/CSS APIs. Findings are heuristics to investigate, not proof of deception or prompt injection.

## Install and use

1. Clone or download this repository.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this folder. No build is required.
3. Open a webpage, click the Revelio toolbar icon, choose a tolerance, and select **Scan this page**.
4. Read findings and coverage in the extension popup. **Locate on page** scrolls to a finding or a visible containing block. Red outlines mark source elements; blue outlines mark containing blocks when the source has no useful visible box.
5. Use **Cancel scan**, **Copy JSON**, or **Clear report & highlights** as needed. Scan again after relevant content loads or changes.

The extension popup is the authoritative report: page CSS such as `#htd-panel { display:none }` cannot hide it. Scanned snippets are rendered as literal text. Highlights are optional location aids that the page can hide or alter. The extension removes only nodes and classes it owns; existing page elements with matching legacy IDs/classes are preserved.

## Modes

| Mode | Meaning |
| --- | --- |
| **Everything** | All supported detected candidates, without tolerance or accessibility filtering, subject to work and retained-result limits. Includes routine hidden content and Unicode diagnostics. It does not mean exhaustive detection of every possible concealment technique. |
| **Sweep** | Broad inspection: includes ordinary CSS-hidden text and unusual invisible/directional-character diagnostics; suppresses common accessibility/icon noise when stronger evidence is absent. |
| **Default** | Prioritizes stronger concealment signals, such as transparent, effectively same-color, tiny, or extremely displaced text. Routine hidden labels and Unicode formatting alone are generally omitted. |
| **Precise** | Requires stronger combined evidence. Prompt-like wording together with hidden content can also qualify. This is a prioritization heuristic, not a judgment about intent. |

Scoring uses structured rule identifiers and evidence, independently of explanation wording. Common emoji joiners and joiners in recognized language contexts remain low-confidence diagnostics. Language recognition is intentionally conservative and incomplete; invisible characters can have legitimate uses. Text is never stripped or changed on the page.

## Results, work limits, and coverage

Results are deduplicated by root and actual element identity (with separate normal-text and pseudo-element targets). Text-node evidence for the same target is combined. Distinct elements with identical selectors, including in different roots, remain distinct. Snippets are previews, limited to 320 characters per merged target; the export contains the retained report, not the entire webpage.

The scanner keeps at most **800** eligible findings, ranked by score, evidence count, and traversal order. A later stronger finding can displace an earlier weaker one. **Additional results omitted** counts eligible targets outside this retained set; filling the report does not stop traversal.

Independent work limits are **120,000 visited nodes**, **2,000 discovered roots/frame records**, **10 seconds elapsed**, **2,000,000 text characters**, and **20,000 characters in one text segment**. Reaching a work limit produces incomplete coverage with its actual stop reason (`node-budget`, `root-budget`, `time-budget`, `text-budget`, or `text-length-budget`). Cancellation is reported separately. Progress includes visited nodes, elapsed time, root states, and skipped frames. Scanning and highlight application yield periodically to let the browser handle other work.

**No findings in scanned content does not mean the whole page was inspected.** Review the coverage warning even when the result list is empty. The scanner visits the document, nested accessible frame documents, and open shadow roots. It records roots as scanned, inaccessible, unavailable, or interrupted where observable. A null frame document may mean cross-origin, an opaque sandbox, loading, or removal; the browser does not always reveal which. A frame access exception is reported without inventing a more precise cause.

## Detection and coverage limitations

- Closed shadow roots cannot be inspected or reliably enumerated. Their absence from the root list is not evidence that none exist.
- Cross-origin and opaque sandboxed frames are usually inaccessible. Chrome internal pages, the Chrome Web Store, and other restricted pages block injection. Open a regular webpage instead. Local files require enabling **Allow access to file URLs** in the extension's settings.
- Browser-readable text nodes and textual `::before`/`::after` content are examined. Head metadata, scripts, styles, inactive templates, and `noscript` are excluded. Canvas/image text, closed components, unsupported generated content, and text not yet loaded are outside coverage. Pseudo-element geometry is approximated using its originating element.
- Known translucent foregrounds/backgrounds are composed where possible. Modern computed colors use a detached browser canvas normalized to sRGB. Unsupported colors are unknown, never silently black. Images, gradients, filters, blending, shadows, opacity composition, or an unknown canvas backing can prevent a meaningful contrast estimate; no precise ratio is invented for these cases. Wide-gamut colors are approximated in sRGB.
- Vertical off-canvas checks distinguish extreme negative displacement and far-away fixed positioning from ordinary below-the-fold content. Occlusion uses a center-point sample and is only a weak diagnostic. Accessibility patterns, hidden application states, unusual layouts, and language formatting can produce false positives; unsupported techniques can produce false negatives.
- A changing DOM limits snapshot consistency. A cooperative scan is not atomic; rescanning may change findings or coverage. The page controls the DOM and computed styles being inspected. Report isolation does not make page content trustworthy, and shadow DOM is not a complete security boundary.

## Privacy and result lifetime

Permissions remain **`activeTab`** and **`scripting`** only. Access follows a user action; there are no broad host permissions, automatic scans, observers, backend, AI calls, analytics, remote scripts, or telemetry.

The latest report and finding references stay only in the current document's content-script memory. Closing the popup lets a running scan finish; reopening it on the same document retrieves that report. Clear, a new scan, navigation (including entry to the back/forward cache), or a page reload discards it. Different tabs have separate reports. Extension reload/update invalidates access to existing content-script state; reload the webpage if stale decorative highlights remain or messaging fails. Browser process termination also loses reports. Reports are not written to extension storage. Only the selected tolerance is saved locally; JSON reaches the clipboard only when requested.

See [privacy.html](../privacy.html).

## Development and verification

Requires Node.js **22+**, npm, and Playwright's matching **Chromium** installation. All npm dependencies are development-only; none are shipped as extension runtime dependencies.

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` runs syntax/manifest/package checks, Node unit tests, browser regression fixtures, and a real unpacked-extension smoke test. The smoke test launches **headed Chromium**, uses the actual toolbar action to obtain `activeTab`, and exercises the production popup and injection/messaging path. It uses Chromium's test-only extension-debugging protocol, without altering production permissions. Use a desktop display on macOS/Windows. On headless Linux:

```sh
npx playwright install --with-deps chromium
xvfb-run -a npm test
```

Individual commands:

```sh
npm run check
npm run test:unit
npm run test:browser
```

Browser fixtures use port **4179** with `127.0.0.1` and `localhost` as distinct origins for real same-origin/cross-origin cases. The suite includes default-budget fixtures plus reduced work limits in explicitly instrumented test copies for deterministic boundary tests; no test controls are exposed by the shipped scanner. Traces/screenshots on failure can contain fixture text. CI runs the same checks under Xvfb and uploads failure artifacts.

For an unpacked installation, only `manifest.json`, `icon128.png`, `popup.html`, `popup.js`, `protocol.js`, `content.js`, `detection.js`, `retention.js`, and `privacy.html` are needed. `npm run check` verifies these files, JavaScript syntax, packaged popup scripts, the permission list, and version consistency between the Chrome manifest and both npm metadata files. There is no production build step.

## Implementation and evidence

- `content.js`: cooperative traversal, per-scan root identities/caches, owned highlights, lifecycle, and extension-only messaging.
- `detection.js`: color normalization, CSS/Unicode evidence, structured scoring, and mode eligibility.
- `retention.js`: bounded deterministic ranking and target updates.
- `popup.html`, `popup.js`, `protocol.js`: authoritative report rendering, message validation, tab/document/scan association, and controls.
- `tests/`: focused unit tests, recreated browser fixtures, unpacked-extension smoke, and [baseline reproduction notes](../tests/baseline-notes.md).
- `.github/workflows/test.yml`: verification in CI.

Browser behavior references: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [tab messaging](https://developer.chrome.com/docs/extensions/reference/api/tabs), [iframe contentDocument](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/contentDocument), and [Canvas fillStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillStyle).

## Research

- Greshake and colleagues demonstrated how instructions embedded in retrieved content can redirect AI applications. [Indirect prompt injection research, 2023](https://arxiv.org/abs/2302.12173)
- Unit 42 documented web-based prompt injection incidents involving visually hidden text. [In-the-wild observations](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/)
- OpenAI describes how it tests and hardens a browser agent against prompt injection. [Atlas security research, 2025](https://openai.com/index/hardening-atlas-against-prompt-injection/)

These sources describe observed examples. Revelio checks for suspicious text and visual signals, and the research does not establish the prevalence of those signals across the web.
