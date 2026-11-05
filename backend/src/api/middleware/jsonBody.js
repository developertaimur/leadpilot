const express = require('express');

// JSON body parser shared by server.js and the tests. It keeps the raw bytes on
// req.rawBody, because the OpenWA webhook signature is computed over them.
const jsonBody = express.json({
  limit: '512kb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});

// Answers body-parser failures with JSON instead of Express's default HTML error page.
function handleBodyErrors(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  return next(err);
}

module.exports = { jsonBody, handleBodyErrors };
