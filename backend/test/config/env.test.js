const { test } = require('node:test');
const assert = require('node:assert/strict');

const ENV = '../../src/config/env';
const BATCH_KEYS = ['BATCH_DELAY_SECONDS', 'BATCH_DAILY_CAP', 'BATCH_MAX_CONSECUTIVE_FAILURES'];

function loadFreshEnv() {
  delete require.cache[require.resolve(ENV)];
  return require(ENV);
}

// Values are set (not deleted) so dotenv can never fill them in from a real .env.
test('BATCH_* settings fall back to 45 / 20 / 3 when empty, zero, negative or not whole numbers', () => {
  const saved = BATCH_KEYS.map((key) => process.env[key]);
  try {
    for (const bad of ['', '0', '-5', 'abc', '2.5']) {
      for (const key of BATCH_KEYS) process.env[key] = bad;
      const env = loadFreshEnv();
      assert.deepEqual(
        [env.batchDelaySeconds, env.batchDailyCap, env.batchMaxConsecutiveFailures],
        [45, 20, 3],
        `value "${bad}"`,
      );
    }
  } finally {
    BATCH_KEYS.forEach((key, i) => {
      process.env[key] = saved[i];
    });
    loadFreshEnv();
  }
});
