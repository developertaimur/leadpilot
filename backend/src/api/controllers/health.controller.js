function getHealth(req, res) {
    res.json({ status: 'ok', message: 'LeadPilot backend is running' });
}

module.exports = { getHealth };