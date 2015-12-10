import bf4 from './bf4.json';
import {
  BadResponseError,
  CodeNameNotFoundError,
  MapNotFoundError,
  ModeNotFoundError,
  PlayerNotFoundError,
} from './errors';

export function findCodeName(nameMap, search) {
  console.log(`looking for ${search}`);
  if (typeof search !== 'string') {
    throw new TypeError(`findCodeName(): expected search to be a string, got: ${search}`);
  }

  const regEx = new RegExp(search, 'i');
  const name = Object.keys(nameMap)
    .map((codeName) => {
      return {
        codeName,
        humanReadable: nameMap[codeName],
      };
    }, [])
    .find(({ codeName, humanReadable }) => {
      return !!humanReadable
        .match(regEx) || codeName === search;
    })
    .codeName;

  if (!name) {
    throw new CodeNameNotFoundError(`commandMap.findCodeName(): code name for ${search} not found`);
  }

  return name;
}

export function handleResponse(funcName, req, res) {
  console.log(`req: ${req}, res: ${res}`);
  if (res !== 'OK') {
    throw new BadResponseError(`${funcName}(): ${req} returned ${res}`);
  }
}

export async function getListOfPlayers(droneInst, withGuid = false) {
  // [ 'OK',
  // '10',
  // 'name',
  // 'guid',
  // 'teamId',
  // 'squadId',
  // 'kills',
  // 'deaths',
  // 'score',
  // 'rank',
  // 'ping',
  // 'type',
  // '2',
  // 'ACX-Minor',
  // '',
  // '2',
  // '1',
  // '0',
  // '0',
  // '0',
  // '136',
  // '71',
  // '0',
  // 'ACX-jevs',
  // '',
  // '0',
  // '0',
  // '0',
  // '0',
  // '0',
  // '136',
  // '46',
  // '0' ]

  let query = 'listPlayers';
  if (withGuid) {
    query = 'admin.listPlayers';
  }

  const queryData = await droneInst.request([query, 'all']);
  const playersWords = queryData.slice(13);
  const res = queryData[0];

  if (res !== 'OK') {
    throw new BadResponseError(`getListOfPlayers(): ${query} returned ${res}`);
  }
  console.log(`playersWords: ${playersWords}`);
  // ACX-jevs,,2,1,0,1,0,-1,47,0,ACX-Minor,,2,1,0,0,0,-1,60,0

  const players = [];
  while (playersWords.length) {
    const info = playersWords.splice(0, 10);
    players.push({
      'name': info[0],
      'guid': info[1],
      'teamId': info[2],
      'squadId': info[3],
      'kills': info[4],
      'deaths': info[5],
      'score': info[6],
      'rank': info[7],
      'ping': info[8],
      'type': info[9],
    });
  }

  return players;
}


export default {
  'say': {
    async action(droneInst, [ text, target ]) {
      const _target = target || 'all';
      const res = await droneInst.request(['admin.say', text, _target]);
      //handleResponse('commandMap.say', 'admin.say', res);
    },
    aliases: ['s', 'sy'],
    clearance: 'spam',
  },
  'kick': {
    async action(droneInst, [ player, reason ]) {
      const res = await droneInst.request(['admin.kickPlayer', player, reason]);
      //handleResponse('commandMap.kick', 'admin.kickPlayer', res);
    },
    aliases: ['cick', 'kck'],
    clearance: 'kick',
  },
  'double': {
    async action(droneInst) {
      const res = await droneInst.request(['mapList.restartRound']);
      droneInst.once('server.onLevelLoaded', () => {
        const to = setTimeout(async () => {
          await droneInst.request(['mapList.restartRound']);
          clearTimeout(to);
        }, 20000);
      });

      //handleResponse('commandMap.double', 'mapList.restartRound', res);
    },
    aliases: ['doublerestart', 'dbl'],
    clearance: 'mapList',
  },
  'restart': {
    async action(droneInst) {
      const res = await droneInst.request(['mapList.restartRound']);
      //handleResponse('commandMap.restart', 'mapList.restartRound', res);
    },
    aliases: ['restarr', 'rst'],
    clearance: 'mapList',
  },
  'nextround': {
    async action(droneInst) {
      const res = await droneInst.request(['mapList.runNextRound']);
      //handleResponse('commandMap.nextround', 'mapList.runNextRound', res);
    },
    aliases: ['next', 'runnext', 'runnextround'],
    clearance: 'mapList',
  },
  'map': {
    async action(droneInst, [ mapSearch, modeSearch ]) {
      console.log(`map action called`);
      // If no modeSearch - keep current game mode, if findCodeName throws -
      // throw own error
      const _modeSearch = modeSearch || await droneInst.request(['serverinfo'])[4];

      let modeName;
      try {
        modeName = findCodeName(bf4.modes, _modeSearch);
      } catch (e) {
        if (e.name === 'codeNameNotFoundError') {
          throw new ModeNotFoundError(`commandMap.map(): mode \'${modeSearch}\' not found`);
        } else {
          throw e;
        }
      }

      let mapName;
      try {
        mapName = findCodeName(bf4.mapNames, mapSearch);
      } catch (e) {
        if (e.name === 'codeNameNotFoundError') {
          throw new MapNotFoundError(`commandMap.map(): map \'${mapSearch}\' not found`);
        } else {
          throw e;
        }
      }
      console.log(`map: ${mapName}, mode: ${modeName}`);
      // Clear map list
      const clearRes = await droneInst.request(['mapList.clear']);
      //handleResponse('commandMap.map', 'mapList.clear', clearRes);

      // Add found map
      const addRes = await droneInst.request(['mapList.add', mapName, modeName, 99, 0]);
      //handleResponse('commandMap.map', 'mapList.add', addRes);

        // Go to next round
      const nextRes = await droneInst.request(['mapList.runNextRound']);
      //handleResponse('commandMap.map', 'mapList.runNextRound', nextRes);
    },
    aliases: ['mp'],
    clearance: 'mapList',
  },
  'swap': {
    async action(droneInst, [ player ]) {
      const playerRegEx = new RegExp(player, 'i');

      console.log(`player regex: ${playerRegEx}`);
      const players = await getListOfPlayers(droneInst, false);

      console.log(`swap players: ${JSON.stringify(players)}`);

      const playerToMove = players
        .find((plr) => {
          console.log(plr);
          return !!plr.name.match(playerRegEx);
        });
      console.log(`swap - player: ${JSON.stringify(playerToMove)}`);
      if (!playerToMove) {
        throw new PlayerNotFoundError(`commandMap.swap(): player ${player} not found`);
      }

      const team = (playerToMove.teamId === '1') ? 2 : 1;

      const res = await droneInst.request(['admin.movePlayer', playerToMove.name, team, 0, 1]);

      //handleResponse('commandMap.swap', 'admin.movePlayer', res);
    },
    aliases: ['fmove'],
    clearance: 'mapList',
  },
};
