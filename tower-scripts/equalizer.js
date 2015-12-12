// Allowed difference between the two teams, above which equalizer activates
const DIFF_THRESHOLD = 3;
// Give teams this much time in seconds to kick someone, otherwise equalizer
// terminates the last loaded player on the bigger team
const GRACE_PERIOD = 120;
// Access token for executing server commands
const TOKEN = '';
// Warning displayed in chat at the beginning of GRACE_PERIOD
const WARNING_TEXT = `Uneven teams, ${GRACE_PERIOD} seconds to fix`;
// Kick reason displayed to the unlucky
const REASON = `Auto-kicked for balance as you were the last to join`;

const playerQueue = (() => {
  const queues = {
    // 'serverIdHere': {
    //   '1': [],
    //   '2': [],
    // },
  };

  function getLengths(serverId, countCommanders = false) {
    const _queues = queues[serverId];

    if (!_queues) {
      return [ 0, 0 ];
    }

    const filteredQueues = {};

    ['1', '2'].forEach((q) => {
      filteredQueues[q] = _queues[q].filter( (plr) => countCommanders || plr.type === '0' );
    });

    return [ filteredQueues['1'].length, filteredQueues['2'].length ];
  }

  function getLongerQueue(serverId) {
    const [ q1len, q2len ] = getLengths(serverId);

    if (q1len === q2len) {
      throw new RangeError(`Queues have equal length (${q1len})`);
    }

    return (q1len > q2len) ? '1' : '2';
  }

  async function move(serverId, player, team) {
    const oldTeam = (team === '1') ? '2' : '1';

    if (!queues[serverId]) {
      queues[serverId] = {};
    }

    const _queues = queues[serverId];

    const oldData = _queues[oldTeam].find( (plr) => plr.name === player );

    if (!oldData) {
      _queues[team].push({
        name: player,
        timestamp: Date.now(),
      });
    } else {
      _queues[team].push(oldData);
      _queues[oldTeam] = _queues[oldTeam].filter( (plr) => plr.name !== player );
    }

    return 0;
  }

  function pop(serverId, team) {
    const _queues = queues[serverId];

    // Find player with the latest timestamp
    const lastPlayer = _queues[team]
      // Don't pop commanders and spectators
      .filter((plr) => plr.type === '0')
      .reduce((latest, plr) => {
        return (plr.timestamp > latest.timestamp) ? plr : latest;
      });
    // Remove data object from queue
    _queues[team] = _queues[team].filter( (plr) => plr.name !== lastPlayer.name );
    // Return {name: <string>, timestamp: <int>}
    return lastPlayer;
  }

  function remove(serverId, player) {
    const _queues = queues[serverId];

    try {
      _queues['1'] = _queues['1'].filter( (plr) => plr.name !== player );
      _queues['2'] = _queues['2'].filter( (plr) => plr.name !== player );
    } catch (e) {
      if (e.name !== 'TypeError') {
        throw e;
      }
    }
  }

  function update(serverId, players) {
    // Iterate over queues of that server and add player type to data obj
    if (!queues[serverId]) {
      queues[serverId] = {};

      // Players will have the same timestamp
      const timestamp = Date.now();

      ['1', '2'].forEach((q) => {
        queues[serverId][q] = players
          .filter((plr) => plr.teamId === q)
          .map((plr) => {
            const { name, type } = plr;
            return {
              name,
              timestamp,
              type,
            };
          });
      });

      return 0;
    }

    const _queues = queues[serverId];

    ['1', '2'].forEach((q) => {
      _queues[q] = _queues[q].map((playerData) => {
        const _data = playerData;

        if (!_data.type) {
          const type = players
            .find((plr) => plr.name === _data.name)
            .type;

          _data.type = type;
        }

        return _data;
      });
    });
  }

  return {
    getLengths,
    getLongerQueue,
    move,
    pop,
    remove,
    update,
  };
})();

export default function hardKick(listPlayers, exec, teamSetupFeed, joinLeaveFeed, statusFeed) {
  const teamChangeFeed = teamSetupFeed
    .filter(({ event }) => event === 'player.onTeamChange');
  const squadChangeFeed = teamSetupFeed
    .filter(({ event }) => event === 'player.onSquadChange');

  // Update queues on team switches
  teamChangeFeed
    .subscribe(async ({ meta, teamSetupObj }) => {
      const { player, team } = teamSetupObj;
      await playerQueue.move(meta.id, player, team);
    });

  // Remove players that left the server
  joinLeaveFeed
    .filter(({ joinLeaveObj }) => joinLeaveObj.left)
    .subscribe(({ meta, joinLeaveObj }) => {
      playerQueue.remove(meta.id, joinLeaveObj.player);
    });

  // If someone switched to squad 0, update queues to make sure
  // that commanders are saved
  squadChangeFeed
    .filter(({ teamSetupObj }) => teamSetupObj.squad === '0')
    // Don't check too often
    .debounce(7000)
    .subscribe(async ({ meta }) => {
      const players = await listPlayers([ meta.id ]);
      playerQueue.update(meta.id, players);
    });


  // Business logic

  // Prevent equalizer from activating on every status update
  const state = {
    active: false,
  };

  statusFeed
    .subscribe(async ({ meta, statusObj }) => {
      function pause(timeout) {
        return new Promise((resolve) => {
          const to = setTimeout(() => {
            resolve();
            clearTimeout(to);
          }, timeout);
        });
      }

      const _exec = exec.bind(null, TOKEN, [ meta.id ]);

      // Get team sizes and calculate difference
      let [t1size, t2size] = playerQueue.getLengths(meta.id);
      let diff = Math.abs(t1size - t2size);

      // Make sure player queues are up to date - compare lengths to serverinfo
      if (parseInt(statusObj.currentPlayercount, 10) !== t1size + t2size) {
        // Get list of all players on the server
        const players = await listPlayers([ meta.id ]);
        // Update queues with new data
        playerQueue.update(meta.id, players[0]);
      }

      (async () => {
        while (meta.live && diff > DIFF_THRESHOLD && !state.active) {
          state.active = true;

          // Warn teams
          _exec('say', [ WARNING_TEXT ]);

          // Wait out the grace period
          await pause(GRACE_PERIOD * 1000);

          // Check the diff again
          [ t1size, t2size ] = playerQueue.getLengths(meta.id);
          diff = Math.abs(t1size - t2size);

          // Proceed with termination if no improvement and we are still live
          if (meta.live && diff > DIFF_THRESHOLD) {
            const biggerTeam = playerQueue.getLongerQueue(meta.id);
            const { name } = playerQueue.pop(meta.id, biggerTeam);

            _exec('say', [ `Kicking ${name} to balance teams` ]);
            _exec('kick', [ name, REASON ]);
          }

          // Update diff... again
          [t1size, t2size] = playerQueue.getLengths(meta.id);
          diff = Math.abs(t1size - t2size);

          // Reset state
          state.active = false;
        }
      })();
    });
  // End of business logic
}
