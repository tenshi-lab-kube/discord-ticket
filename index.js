require('dotenv').config();
const { startBot } = require('./src/bot');
const { startWeb } = require('./src/web');

(async () => {
  await startBot();
  startWeb();
})();
