import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workflow = await fs.readFile(
  new URL('../.github/workflows/update-prices.yml', import.meta.url),
  'utf8',
);

test('scheduled price workflow isolates ASINs and retries failures on new runners', () => {
  assert.match(workflow, /scrape-primary:[\s\S]*matrix:[\s\S]*asin:/);
  assert.match(workflow, /scrape-retry:[\s\S]*matrix:[\s\S]*needs\.plan-retry\.outputs\.missing/);
  assert.match(workflow, /SCRAPE_PASS: primary/);
  assert.match(workflow, /SCRAPE_PASS: retry/);
});

test('transactional assembly must pass before history or Pages deployment can run', () => {
  const assembleAt = workflow.indexOf('Assemble and require a publishable result for every ASIN');
  const historyAt = workflow.indexOf('Save rolling 365-day history to GitHub');
  const deployAt = workflow.indexOf('uses: actions/deploy-pages@v4');
  assert.ok(assembleAt > 0);
  assert.ok(historyAt > assembleAt);
  assert.ok(deployAt > historyAt);
});

test('distributed jobs time out setup failures and history publishing rebases on latest main', () => {
  assert.equal((workflow.match(/timeout-minutes: 4/g) || []).length, 2);
  assert.match(workflow, /assemble-and-deploy:[\s\S]*ref: main[\s\S]*fetch-depth: 0/);
  assert.match(workflow, /git fetch origin main[\s\S]*git rebase origin\/main[\s\S]*git push origin HEAD:main/);
});

test('retry matrix still runs after a primary matrix runner fails', () => {
  assert.match(
    workflow,
    /scrape-retry:[\s\S]*if: always\(\)[^\n]*needs\.plan-retry\.result == 'success'[^\n]*missing_count != '0'/,
  );
});
