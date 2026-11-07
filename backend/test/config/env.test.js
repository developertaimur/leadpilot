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

// Same rule as above: values are set, never deleted. A missing value is covered by the `?? ''` in env.js.
test('AI_AUTO_REPLY_ENABLED is on only for "true" after trimming, in any case; anything else is off', () => {
  const saved = process.env.AI_AUTO_REPLY_ENABLED;
  try {
    for (const on of ['true', 'TRUE', ' True ', '\tTrue  ']) {
      process.env.AI_AUTO_REPLY_ENABLED = on;
      assert.equal(loadFreshEnv().aiAutoReplyEnabled, true, `value ${JSON.stringify(on)}`);
    }
    for (const off of ['', ' ', 'false', '1', 'yes', 'on', 'true1', '"true"']) {
      process.env.AI_AUTO_REPLY_ENABLED = off;
      assert.equal(loadFreshEnv().aiAutoReplyEnabled, false, `value ${JSON.stringify(off)}`);
    }
  } finally {
    process.env.AI_AUTO_REPLY_ENABLED = saved;
    loadFreshEnv();
  }
});
