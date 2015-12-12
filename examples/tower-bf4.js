// Bootstrap all scripts here

import getFeeds from '../tower-scripts/tower-feeds.js';

import commanderKick from '../tower-scripts/commander-kick.js';
import equalizer from '../tower-scripts/equalizer.js';
import logger from '../tower-scripts/logger.js';
import setLive from '../tower-scripts/set-live.js';

(async () => {
  const { feeds, tower } = await getFeeds();

  equalizer(tower.listPlayers, tower.exec,
    feeds.teamSetup, feeds.joinLeave, feeds.status);

  setLive(tower.exec, tower.setMeta, feeds.commands);

  logger(feeds.status, feeds.kills, feeds.chat, feeds.joinLeave);

  commanderKick(tower.exec, feeds.roundOverPlayers);
})();
