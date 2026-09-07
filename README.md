# Revelio

I built Revelio to help fight prompt injection on the web. Attackers can bury instructions in webpages that an AI assistant may read even when they're invisible to you. Those instructions can try to hijack its task or manipulate its answers.

**Revelio helps you see what a webpage is hiding.** It is a small Chrome extension that flags suspicious text: tiny fonts, transparent or same-color text, off-screen positioning, and unusual invisible characters. You start a scan, read the findings, and jump to their location on the page.

The goal is simple: make hidden instructions easier to spot and investigate. Findings need human judgment; Revelio does not block prompt injections or certify that a page is safe.

## Research behind the idea

- [Greshake et al. (2023)](https://arxiv.org/abs/2302.12173) demonstrated how instructions planted in retrieved content can redirect AI applications.
- [Unit 42: prompt injection observed in the wild](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/) documents malicious payloads on live websites, including instructions hidden with CSS.
- [OpenAI's browser-agent research (2025)](https://openai.com/index/hardening-atlas-against-prompt-injection/) describes ongoing testing and defenses against these attacks.

These sources establish a real, active problem. They do not establish a reliable overall growth rate.

## Try it

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, and **Load unpacked** from this folder.
3. Open a webpage, click Revelio, then **Scan this page**.
4. Review the popup report. Use **Locate on page**, **Copy JSON**, or **Clear report & highlights**.

Start with **Default**. **Precise** requires stronger evidence; **Sweep** includes more routine hidden content; **Everything** shows all supported detected candidates without tolerance filtering, within scan limits.

## Built with

Vanilla JavaScript, HTML/CSS, Chrome Manifest V3, and native DOM/CSS APIs. Tests use Node.js and Playwright, including the actual unpacked extension. No framework or build step is needed to load it.

Scans run locally when you request them. No backend, AI calls, or telemetry. Reports stay in the current document's memory until cleared, replaced, or navigation ends that document's session.

**No findings does not mean full coverage.** Check coverage warnings: some frames and browser pages are inaccessible, and closed shadow roots cannot be inspected. Hidden text can also be legitimate.

## Development

Requires Node.js 22+ and a desktop display for the extension tests.

```sh
npm ci
npx playwright install chromium
npm test
```

[Scanning, privacy, limitations, and Linux test setup](docs/scanning.md) · [Verification results](docs/verification.md) · [MIT license](LICENSE)
