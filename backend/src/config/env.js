require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
};