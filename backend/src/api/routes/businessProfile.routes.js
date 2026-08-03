const express = require('express');
const { setProfile, getProfile } = require('../controllers/businessProfile.controller');

const router = express.Router();
router.get('/business-profile', getProfile);
router.put('/business-profile', setProfile);

module.exports = router;