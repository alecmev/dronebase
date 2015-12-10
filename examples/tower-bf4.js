// Bootstrap all scripts here

import getFeeds from '../tower-scripts/tower-feeds.js';

import hardKick from '../tower-scripts/hard-kick.js';
import setLive from '../tower-scripts/set-live.js';
import logger from '../tower-scripts/logger.js';

(async () => {
  const { feeds, tower } = await getFeeds();

  hardKick(tower.listPlayers, tower.exec,
    feeds.teamSetup, feeds.joinLeave, feeds.status);

  setLive(tower.exec, tower.setMeta, feeds.commands);

  logger(feeds.status, feeds.kills, feeds.chat, feeds.joinLeave);
})();
