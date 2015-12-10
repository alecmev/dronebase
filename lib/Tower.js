import Drone from './dronebase';
import { EventEmitter } from 'events';

import admins from '../config/tower-admins.json';

import {
  CommandNotFoundError,
  UnauthorizedError,
  ValueError,
} from './errors';

const droneMap = {};
const intervalMap = new Map();
let commandMap = {};
let serversArr = [];

function findServers(search) {
  // Search - array of ids or `*` to poll all servers
  if (search !== '*' && !Array.isArray(search)) {
    throw new ValueError('findServers(): <search> must be an array of ID\'s or a single `*`');
  }

  if (search !== '*') {
    return Object.keys(droneMap)
      .filter((id) => {
        return search.includes(id);
      });
  }

  return Object.keys(droneMap);
}

async function getData(filteredArr, servers, query) {
  const data = [];
  for (let i = 0; i < filteredArr.length; i += 1) {
    const id = filteredArr[i];
    const server = servers.find((srv) => {
      return srv.meta.id === id;
    });

    data.push({
      meta: server.meta,
      words: await droneMap[id].request(query),
    });
  }

  return data;
}

function interval(func, wait, times) {
  const sym = Symbol('for intervals');
  intervalMap.set(sym, true);

  const interv = (/* IIFE */(w, t) => {
    const _w = w;
    let _t = t;
    return () => {
      if (intervalMap.get(sym) && (typeof _t !== 'number' || _t-- > 0)) {
        setTimeout(interv, _w);
        try {
          func.call(null);
        } catch (e) {
          _t = 0;
          throw e;
        }
      }
    };
  })(wait, times);

  setTimeout(interv, wait);

  return sym;
}

function isAuthorized(serverId, issuer, command) {
  return admins[issuer].includes(commandMap[command].clearance);
}

export default class Tower extends EventEmitter {
  static findCodeName(nameMap, search) {
    const regEx = new RegExp(search, 'i');
    return Object.keys(nameMap)
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
  }

  emit(...args) {
    return super.emit.apply(this, args);
  }

  async exec(issuer, search, command, args) {
    function findCommand(input) {
      return Object.keys(commandMap)
        .map((commandName) => {
          return {
            commandName,
            aliases: commandMap[commandName].aliases,
          };
        }, [])
        // Find alias or an exact match in the list
        .find(({ aliases, commandName }) => {
          return aliases.includes(input) || commandName === input;
        })
        // Return corresponding command
        .commandName;
    }

    let commandName = '';
    try {
      commandName = findCommand(command);
    } catch (e) {
      if (e instanceof TypeError) {
        throw new CommandNotFoundError(`Command ${command} not found`);
      }
    }

    const failedOn = [];
    // Go through found servers
    findServers(search)
      .forEach(async (serverId) => {
        const _server = serversArr.find((srv) => {
          return srv.meta.id === serverId;
        });
        if (!isAuthorized(_server.meta.id, issuer, commandName)) {
          failedOn.push({ id: _server.meta.id, alias: _server.meta.alias });
        } else {
          await commandMap[commandName].action(droneMap[_server.meta.id], args);
        }
      });
    // Collect failures, throw with list of servers where failed.
    if (failedOn.length > 0) {
      const e = new UnauthorizedError(`${issuer} cannot use ${commandName} on ${JSON.stringify(failedOn)}`);
      e.failedOn = failedOn;
      throw e;
    }
  }

  async launch(servers = []) {
    return await this.update(servers);
  }

  async listPlayers(search) {
    const serverIds = findServers(search);
    // Return an array of {meta, words} in the order ID's were given
    const data = await getData(serverIds, serversArr, ['admin.listPlayers', 'all']);

    const playersWords = data.map(({ words }) => words.slice(13));

    return playersWords.map((words) => {
      const players = [];
      while (words.length) {
        const info = words.splice(0, 10);
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
    });
  }

  async poll(search, query, rate, ee) {
    if (typeof rate !== 'number') {
      throw new TypeError(`Tower.poll(): expected \`rate\` argument to be a number (time in ms), got: ${typeof rate}`);
    }

    async function halt(sym) {
      intervalMap.set(sym, false);
    }

    // Update server list every iteration
    // TODO: call for updates externally
    // Emit an array of {meta, words} from new ee every <rate>
    const pollIntervalSym = interval(async () => {
      const serverIds = findServers(search);
      const requestData = await getData(serverIds, serversArr, query);

      requestData.forEach(({ meta, words }) => {
        ee.emit('pollData', { meta, words });
      });
    }, rate);

    ee.halt = halt.bind(ee, pollIntervalSym);

    return ee;
  }

  async request(search, query) {
    const serverIds = findServers(search);
    // Return an array of {meta, words} in the order ID's were given
    return await getData(serverIds, serversArr, query);
  }

  setCommandMap(map) {
    commandMap = map;
  }

  setMeta(search, key, value) {
    const serverIds = findServers(search);
    for (let i = 0; i < serverIds.length; i += 1) {
      const id = serverIds[i];
      const server = serversArr.find((srv) => {
        return srv.meta.id === id;
      });

      server.meta[key] = value;
    }
  }

  async update(servers) {
    const towerInst = this;
    serversArr = servers;

    return servers
      .map((server) => {
        if (!droneMap[server.meta.id]) {
          droneMap[server.meta.id] = new Drone({
            host: server.host,
            password: server.password,
            port: server.port,
          });

          droneMap[server.meta.id].on('*', ([ event, ...words ]) => {
            towerInst.emit(event, {
              words,
              meta: server.meta,
            });

            towerInst.emit('*', {
              event,
              words,
              meta: server.meta,
            });
          });

          droneMap[server.meta.id].launch();

          return server;
        }
      });
  }

}
