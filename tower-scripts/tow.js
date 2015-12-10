import { Observable } from 'rx';
import winston from 'winston';

import Tower from '../lib/Tower';
import commandMap from '../lib/commandMap';

const tower = new Tower();
const servers = [
  {
    meta: {
      alias: 'lvl',
      id: 'totallyunique',
      matchId: 'matchidhere',
      setup: 'bcl8',
    },
    host: '151.236.46.77',
    password: 'qRQB82fL',
    port: '25512',
  },
  // {
  //   meta: {
  //     alias: 'acx',
  //     id: 'totallyunique2',
  //     matchId: 'matchidhere2',
  //     setup: 'bcl8',
  //   },
  //   host: '91.198.152.35',
  //   password: '041A613B',
  //   port: '25505',
  // }
];

tower.setCommandMap(commandMap);

(async () => {
  await tower.update(servers);

  const pollEvent = await tower.poll('*', 'serverinfo', 30000);
  pollEvent.on('pollData', (dataArr) => {
    dataArr.forEach(({ meta, words }) => {
      console.log(`Server: ${meta.alias}\t Scores: ${words[9]}-${words[10]}`);
    });
  });

  const chat = Observable.fromEvent(tower, 'player.onChat')
    .map(({ meta, words }) => {
      const [ player, text, target, teamId, squadId ] = words;
      return {
        meta,
        chatObj: {
          player,
          target,
          text,
          teamId: teamId || -1,
          squadId: squadId || -1,
        },
      };
    });

  const commands = chat
    .filter(({ chatObj }) => {
    // Recognize all commands starting with an optional '/';
    // !, @ and # should determine who will see output in-game:
    // all, self, or admins respectively

    // !! to convert from null / array to boolean
      return !!chatObj.text
        .match(/^\/?([!@#])/);
    })
    .map(({ meta, chatObj }) => {
      const announceMap = {
        '!': 'all',
        '@': 'self',
        '#': 'admins',
      };

      const args = chatObj.text
        .replace(/^\/?[!@#]/, '')
        .split(' ');

      const hidden = chatObj.text[0] === '/';

      const prefix = chatObj.text
        .replace(/^\//, '')[0];

      return {
        meta,
        hidden,
        issuer: chatObj.player,
        command: args[0],
        args: args.slice(1),
        announce: announceMap[prefix],
        chatTarget: chatObj.target,
      };
    });

  commands.subscribe(async (commandObj) => {
    try {
      await tower.exec(['totallyunique'], commandObj.command, commandObj.args, commandObj.issuer);
    } catch (e) {
      if (e.name === 'UnauthorizedError') {
        await tower.exec(['totallyunique'], 'kick', [ commandObj.issuer, 'Using commands without authorization' ]);
      }
      winston.error(e.name, e.message);
    }
  });
}());
