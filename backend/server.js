const express = require('express');
const { port } = require('./src/config/env');
const healthRoutes = require('./src/api/routes/health.routes');
const leadRoutes = require('./src/api/routes/lead.routes');
const conversationRoutes = require('./src/api/routes/conversation.routes');
const messageRoutes = require('./src/api/routes/message.routes');
const campaignRoutes = require('./src/api/routes/campaign.routes');
const whatsappRoutes = require('./src/api/routes/whatsapp.routes');

const app = express();
app.use(express.json());
app.use('/api', healthRoutes);
app.use('/api', leadRoutes);
app.use('/api', conversationRoutes);
app.use('/api', messageRoutes);
app.use('/api', campaignRoutes);
app.use('/api', whatsappRoutes);

app.listen(port, () => {
  console.log(`LeadPilot backend running on port ${port}`);
});