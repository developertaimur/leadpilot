const express = require('express');
const { jsonBody, handleBodyErrors } = require('../../src/api/middleware/jsonBody');

// Builds a minimal app mounted like server.js (shared JSON body parser, routers under /api,
// JSON body errors) and listens on a random local port.
async function startApp(...routers) {
  const app = express();
  app.use(jsonBody);
  routers.forEach((router) => app.use('/api', router));
  app.use(handleBodyErrors);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { startApp };
