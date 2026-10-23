const express = require('express');

// Builds a minimal app mounted like server.js (JSON body, routers under /api)
// and listens on a random local port.
async function startApp(...routers) {
  const app = express();
  app.use(express.json());
  routers.forEach((router) => app.use('/api', router));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { startApp };
