import admins from '../config/tower-admins.json';

// Access token for executing server commands
const TOKEN = '';
// Message displayed in chat while live status is being set
const MESSAGE_LIVE = 'LIVE LIVE LIVE';
// Message displayed in chat while live status is being REMOVED
const MESSAGE_NL = 'NOT Live';

export default function setLive(exec, setMeta, commandFeed) {
  commandFeed
    .filter(({ commandObj }) => {
<<<<<<< HEAD
      return admins[commandObj.issuer].includes('official');
=======
      return admins[commandObj.issuer] &&
        admins[commandObj.issuer].includes('official');
>>>>>>> tower-dev
    })
    .subscribe(async ({ meta, commandObj }) => {
      const _exec = exec.bind(null, TOKEN, [ meta.id ]);

      if (commandObj.command === 'live') {
        setMeta([ meta.id ], 'live', true);
        _exec('say', [ MESSAGE_LIVE ]);
      }

      if (commandObj.command === 'nl') {
        setMeta([ meta.id ], 'live', false);
        _exec('say', [ MESSAGE_NL ]);
      }
    });
}
