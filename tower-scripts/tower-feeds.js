import { Observable } from 'rx';
import { EventEmitter } from 'events';

import Tower from '../lib/Tower';
import commandMap from '../lib/commandMap';
import servers from '../config/tower-servers.json';

const tower = new Tower();

tower.setCommandMap(commandMap);

function eventFilter(feed, ...events) {
  return feed
    .filter(({ event }) => {
      return events.includes(event);
    });
}

export default async function getFeeds() {
  await tower.update(servers);

  const ee = new EventEmitter();
  const statusEvent = await tower.poll('*', 'serverinfo', 10000, ee);

  const allEvents = Observable.fromEvent(tower, '*');

  const chat = eventFilter(allEvents, 'player.onChat')
    .map(({ event, meta, words }) => {
      const [ player, text, target, teamId, squadId ] = words;
      return {
        event,
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
        commandObj: {
          issuer: chatObj.player,
          command: args[0],
          args: args.slice(1),
          announce: announceMap[prefix],
          chatTarget: chatObj.target,
        },
      };
    });

  const kills = eventFilter(allEvents, 'player.onKill')
    .map(({ event, meta, words }) => {
      const [ player, killed, weapon, headshot ] = words;
      return {
        event,
        meta,
        killObj: {
          player,
          killed,
          weapon,
          headshot,
        },
      };
    });

  const joinLeave = eventFilter(allEvents, 'player.onJoin', 'player.onLeave')
    .map(({ event, meta, words }) => {
      const [ player, guid ] = words;
      return {
        event,
        meta,
        joinLeaveObj: {
          player,
          guid,
          joined: event.includes('Join'),
          left: event.includes('Leave'),
        },
      };
    });

  const status = Observable.fromEvent(statusEvent, 'pollData')
    .map(({ meta, words }) => {
      return {
        meta,
        statusObj: {
          serverName: words[1],
          currentPlayercount: words[2],
          effectiveMaxPlayercount: words[3],
          gamemode: words[4],
          map: words[5],
          roundsPlayed: words[6],
          roundsTotal: words[7],
          scores: [ words[9], words[10] ],
          onlineState: words[12],
          ranked: words[13],
          punkBuster: words[14],
          hasGamePassword: words[15],
          serverUpTime: words[16],
          roundTime: words[17],
          gameIpAndPort: words[18],
          punkBusterVersion: words[19],
          joinQueueEnabled: words[20],
          region: words[21],
          closestPingSite: words[22],
          country: words[23],
          matchMakingEnabled: words[24],
          blazeGameState: words[25],
        },
      };
    });

  const teamSetup = eventFilter(allEvents, 'player.onTeamChange', 'player.onSquadChange')
    .map(({ event, meta, words }) => {
      const [ player, team, squad ] = words;
      return {
        event,
        meta,
        teamSetupObj: {
          player,
          team,
          squad,
        },
      };
    });

  const roundOverPlayers = eventFilter(allEvents, 'server.onRoundOverPlayers')
    .map(({ event, meta, words }) => {
      return {
        event,
        meta,
        roundOverObj: {
          players: Tower.playerListFromWords(words),
        },
      };
    });

  return {
    tower,
    feeds: {
      chat,
      commands,
      joinLeave,
      kills,
      roundOverPlayers,
      status,
      teamSetup,
      all: allEvents,
    },
  };
}
