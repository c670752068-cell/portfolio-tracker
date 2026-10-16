async (page) => {
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  await page.reload();
  await page.getByRole('button', { name: '板块轮动', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.rotation-freshness')?.textContent.includes('11/11'), { timeout: 60000 });
  assert(await page.locator('.rotation-ranking tbody tr').count() === 11, 'All 11 sectors have a ranking row');
  assert(await page.locator('.rotation-point').count() === 11, 'All 11 sectors have weekly trajectories');
  const coordinate = await page.locator('.rotation-point.is-selected').getAttribute('aria-label');
  const periods = [];
  for (const label of ['1月', '3月', '6月', '1年']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const text = await page.locator('.rotation-selection').innerText();
    assert(!text.includes('同期交易日不完整') && !text.includes('不足 '), `${label} has a complete comparable period`);
    assert(await page.locator('.rotation-point.is-selected').getAttribute('aria-label') === coordinate, `${label} does not change the independent weekly model`);
    periods.push({ label, metrics: await page.locator('.rotation-selection .rotation-metrics').innerText() });
  }
  await page.getByRole('button', { name: '3月', exact: true }).click();
  await page.getByRole('combobox', { name: '选择板块' }).selectOption('XLC');
  await page.waitForFunction(() => document.querySelector('.rotation-watch')?.textContent.includes('META'));
  assert((await page.locator('.rotation-selection h3').innerText()).includes('XLC'), 'Dropdown updates selected sector');
  assert((await page.locator('.rotation-watch').innerText()).includes('GOOG'), 'Communication stocks are classified separately from technology');
  const tech = page.locator('.rotation-point').filter({ hasText: '科技 XLK' });
  await tech.focus(); await page.keyboard.press('Enter');
  assert((await page.locator('.rotation-selection h3').innerText()).includes('XLK'), 'Keyboard activation updates the SVG, details and stocks');
  await page.getByRole('button', { name: '较标普 ↓', exact: true }).click();
  assert(await page.locator('th[aria-sort="ascending"]').count() === 1, 'Ranking order can be reversed');
  await page.getByRole('button', { name: '较标普 ↑', exact: true }).click();
  const viewports = [];
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
    const dims = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(dims.scroll <= width, `Rotation page has no outer overflow at ${width}px`);
    viewports.push(dims);
    if ([1440, 390].includes(width)) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `output/playwright/rotation-${width}.png`, fullPage: true }); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '查看 NVDA 个股决策', exact: true }).click();
  await page.waitForSelector('.decision-row.is-selected[data-symbol="NVDA"]');
  assert((await page.locator('.decision-detail h3').innerText()).includes('NVDA'), 'Stock link selects the same decision detail');
  assert(await page.locator('.decision-row').count() === 6, 'Main table initially shows six rows with expand still available');
  assert((await page.locator('.decision-table-head').innerText()).indexOf('观察信号') < (await page.locator('.decision-table-head').innerText()).indexOf('回撤深度'), 'Observation signal appears before metrics');
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Decision page has no outer overflow at ${width}px`);
    if ([1440, 390].includes(width)) { await page.locator('.decision-layout').scrollIntoViewIfNeeded(); await page.screenshot({ path: `output/playwright/decision-${width}.png` }); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const theme = page.getByRole('combobox', { name: '主题', exact: true });
  await theme.selectOption('dark');
  await page.getByRole('button', { name: '板块轮动', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.rotation-freshness')?.textContent.includes('11/11'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/rotation-dark.png' });
  await theme.selectOption('light');
  return { checks, periods, viewports };
}
