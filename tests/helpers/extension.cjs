const { chromium, expect } = require('@playwright/test');
const { root } = require('./scanner.cjs');

// Chromium's extension action API supplies the same activeTab grant as the toolbar.
// The production manifest is loaded unchanged: no test host permissions or scripts.
// See https://chromedevtools.github.io/devtools-protocol/tot/Extensions/
async function loadExtension() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const browserSession = await context.browser().newBrowserCDPSession();
  const { id } = await browserSession.send('Extensions.loadUnpacked', { path: root });
  return { context, browserSession, id };
}

async function openPopup(extension, page) {
  await page.bringToFront();
  const { browserSession, id } = extension;
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const tab = targetInfos.find(target => target.url === page.url());
  expect(tab, 'The real page tab must exist before invoking its extension action').toBeTruthy();
  await browserSession.send('Extensions.triggerAction', { id, targetId: tab.targetId });
  let popupTarget;
  await expect.poll(async () => {
    const targets = await browserSession.send('Target.getTargets');
    popupTarget = targets.targetInfos.find(target => target.url === `chrome-extension://${id}/popup.html`);
    return Boolean(popupTarget);
  }).toBe(true);

  // Toolbar popups are page targets without a tab; Playwright does not expose them
  // in context.pages(). Attach CDP directly to their actual extension renderer.
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
  let nextId = 0;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const messageId = ++nextId;
      const timeout = setTimeout(() => { browserSession.off('Target.receivedMessageFromTarget', receive); reject(new Error(`Popup ${method} timed out`)); }, 10000);
      function receive(event) {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message);
        if (response.id !== messageId) return;
        clearTimeout(timeout); browserSession.off('Target.receivedMessageFromTarget', receive);
        response.error ? reject(new Error(response.error.message)) : resolve(response.result);
      }
      browserSession.on('Target.receivedMessageFromTarget', receive);
      browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: messageId, method, params }) }).catch(error => {
        clearTimeout(timeout); browserSession.off('Target.receivedMessageFromTarget', receive); reject(error);
      });
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  await expect.poll(() => evaluate('document.readyState')).toBe('complete');
  return {
    evaluate,
    click: selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),
    text: selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`),
    screenshot: async () => Buffer.from((await send('Page.captureScreenshot')).data, 'base64'),
    close: () => browserSession.send('Target.closeTarget', { targetId: popupTarget.targetId }),
  };
}
module.exports = { loadExtension, openPopup };
