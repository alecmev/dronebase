import _ from 'lodash';
import winston from 'winston';

import { load as loadConfig } from '../lib/config.js';
import Drone from '../lib/dronebase';
import live from '../lib/live';
import * as sessions from '../lib/sessions';
import * as soldiers from '../lib/soldiers';

const configName = process.argv[2];
const config = loadConfig(configName);
winston.level = config.log.level;
winston.cli();

async function cleanUp() {
  winston.debug(`cleaning up...`);
  await sessions.endAll();
  await live.end();
  winston.debug(`cleanup done`);
}

process.on('beforeExit', async () => {
  winston.debug('beforeExit');
  await cleanUp();
  process.exit();
});

process.on('SIGHUP', async () => {
  winston.debug(`SIGHUP`);
  await cleanUp();
  process.exit(129);
});

process.on('SIGINT', async () => {
  winston.debug(`SIGINT`);
  await cleanUp();
  process.exit(130);
});

process.on('uncaughtException', async err => {
  winston.error('uncaughtException');
  winston.error(err);
  await cleanUp();
  process.exit(99);
});

live.on('begin', () => {
  winston.info('begin');
});

live.on('end', () => {
  winston.info('end');
  // TODO: this isn't called upon script termination, because the process gets
  // destroyed before the eventemitter is able to emit the event; not sure if
  // that's a serious problem, don't solve unless needed
});

const drone = new Drone(config.target);

// TODO: see the old example.js in the git history for some ideas

// async () => {
//   try {
//     const soldier = await soldiers.get(
//       'EA_SOMEID', 'ACX-jevs'
//     );
//     await sessions.begin(soldier);
//   } catch (err) {
//     winston.error(err);
//     return;
//   }
// }();

drone.launch();

// TODO: implement loadout checker

// TODO: use isaaccambron.com/twix.js/docs.html#overlaps for round %
// calculations and stuff like that
