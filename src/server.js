const app = require('./web/app');
const { config } = require('./db');
const { createClient } = require('./mqtt');

createClient();

app.listen(config.web.port, config.web.host, () => {
  console.log(`🌐 Web server at http://${config.web.host}:${config.web.port}`);
});
