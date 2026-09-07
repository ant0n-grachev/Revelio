const { test, expect } = require('@playwright/test');
const { loadExtension, openPopup } = require('../helpers/extension.cjs');
const { root } = require('../helpers/scanner.cjs');
const fs = require('node:fs');

test('installed extension: real action, injection, messaging, isolated report, roots and retained lifecycle', async ({}, testInfo) => {
  const extension = await loadExtension();
  try {
    const page = await extension.context.newPage();
    await page.goto('http://127.0.0.1:4179/?case=smoke');
    await page.evaluate(() => window.fixtureReady);
    let popup = await openPopup(extension, page);
    await expect.poll(() => popup.evaluate('document.querySelector("#scan").disabled')).toBe(false);
    await popup.click('#scan');
    await expect.poll(() => popup.text('#status')).toMatch(/findings in scanned content/i);
    expect(await popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(4);
    expect(await popup.text('#results')).toContain('<img src=x onerror="window.__executed=true"> Actual extension secret');
    expect(await popup.evaluate('document.querySelectorAll("#results img, #results script").length')).toBe(0);
    expect(await popup.evaluate('window.__executed')).toBeUndefined();
    expect(await page.evaluate(() => window.__executed)).toBeUndefined();
    expect(await popup.evaluate('getComputedStyle(document.querySelector("#results")).display')).not.toBe('none');
    expect(await page.locator('#htd-panel').textContent()).toBe('Page-owned content');
    expect(await page.locator('#smoke').evaluate(el => getComputedStyle(el).outlineColor)).toBe('rgb(255, 59, 48)');
    expect(await popup.text('#roots')).toContain('scanned');
    const screenshotPath = testInfo.outputPath('extension-report.png');
    fs.writeFileSync(screenshotPath, await popup.screenshot());
    await testInfo.attach('extension-owned-report', { path: screenshotPath, contentType: 'image/png' });
    const first = await popup.evaluate('(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:"GET_REPORT"},{frameId:0})})()');
    await popup.close();

    popup = await openPopup(extension, page);
    await expect.poll(() => popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(4);
    const reopened = await popup.evaluate('(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:"GET_REPORT"},{frameId:0})})()');
    expect(reopened.scanId).toBe(first.scanId);
    await popup.close();

    const secondPage = await extension.context.newPage();
    await secondPage.goto('http://127.0.0.1:4179/?case=ordinary');
    popup = await openPopup(extension, secondPage);
    await expect.poll(() => popup.text('#status')).toMatch(/ready|not scanned|no scan/i);
    expect(await popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(0);
    await popup.close();
    await secondPage.close();

    popup = await openPopup(extension, page);
    await expect.poll(() => popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(4);
    await popup.click('#clear');
    await expect.poll(() => popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(0);
    expect(await page.locator('#htd-panel').textContent()).toBe('Page-owned content');
    expect(await page.locator('#smoke').evaluate(el => [...el.classList].some(value => value.startsWith('revelio-')))).toBe(false);
    await popup.close();

    await page.goto('chrome://version');
    popup = await openPopup(extension, page);
    await expect.poll(() => popup.text('#status')).toMatch(/restricted|cannot.*scan|cannot.*inspect|normal webpage/i);
    await popup.close();
  } finally { await extension.context.close(); }
});

test('installed extension: closing during scan preserves work and extension reload discards retained text', async () => {
  const extension = await loadExtension();
  try {
    const page = await extension.context.newPage();
    await page.goto('http://127.0.0.1:4179/?case=large&count=10000');
    await page.evaluate(() => {
      const secret = document.createElement('p');
      secret.textContent = 'Retained while popup closed'; secret.style.color = 'transparent';
      document.querySelector('#fixture').append(secret);
    });
    let popup = await openPopup(extension, page);
    await expect.poll(() => popup.text('#status')).toContain('Ready.');
    await popup.click('#scan');
    await expect.poll(() => popup.text('#status')).toContain('Scanning');
    const pending = await popup.evaluate('(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:"GET_REPORT"},{frameId:0})})()');
    expect(pending.report.status).toBe('running');
    await popup.close();
    popup = await openPopup(extension, page);
    await expect.poll(() => popup.text('#status')).toContain('findings in scanned content');
    expect(await popup.text('#results')).toContain('Retained while popup closed');
    const completed = await popup.evaluate('(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:"GET_REPORT"},{frameId:0})})()');
    expect(completed.scanId).toBe(pending.scanId);
    await popup.close();
    await extension.browserSession.send('Extensions.uninstall', { id: extension.id });
    const reloaded = await extension.browserSession.send('Extensions.loadUnpacked', { path: root });
    extension.id = reloaded.id;
    popup = await openPopup(extension, page);
    await expect.poll(() => popup.text('#status')).toContain('Ready.');
    expect(await popup.evaluate('document.querySelectorAll("#results > li").length')).toBe(0);
    await popup.close();
  } finally { await extension.context.close(); }
});
