import winston from 'winston';

// Log status to console every _ recieved poll events
// Lower values - higher verbosity
// Must be an integer above 0
const STATUS_LOG_RATE = 3;

export default function logger(...feeds) {
  return feeds.map((feed) => {
    let _info;
    let _error;

    let statusLogCounter = 0;

    return feed.subscribe(
      (data) => {
        _info = winston.info.bind(winston, `(${data.meta.alias})`);
        _error = winston.error.bind(winston, `(${data.meta.alias})`);

        if (data.statusObj) {
          const { currentPlayercount, scores } = data.statusObj;

          statusLogCounter += 1;
          if (statusLogCounter % STATUS_LOG_RATE === 0) {
            _info(`Players: ${currentPlayercount}, scores: ${scores[0]}-${scores[1]}`);
          }
        }

        if (data.killObj) {
          const { player, killed, weapon } = data.killObj;
          if (!player) {
            _info(`${killed} killed themselves with ${weapon}`);
          } else {
            _info(`${player} killed ${killed} with ${weapon}`);
          }
        }

        if (data.chatObj) {
          const { player, text, teamId, squadId} = data.chatObj;
          let to = '[ALL]';
          if (teamId > -1) {
            if (squadId > -1) {
              to = `[TEAM ${teamId} SQ ${squadId}]`;
            } else {
              to = `[TEAM ${teamId}]`;
            }
          }

          _info(to, `${player}: ${text}`);
        }

        if (data.joinLeaveObj) {
          const { joined, player } = data.joinLeaveObj;
          const action = (joined) ? 'joined' : 'left';
          _info(`${player} ${action}`);
        }
      },
      (err) => {
        _error(err);
      }
    );
  });
}
