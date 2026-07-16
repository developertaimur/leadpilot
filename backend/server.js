const express = require('express');
const { port } = require('./src/config/env');
const healthRoutes = require('./src/api/routes/health.routes');

const app = express();
app.use(express.json());
app.use('/api', healthRoutes);

app.listen(port, () => {
  console.log(`LeadPilot backend running on port ${port}`);
});