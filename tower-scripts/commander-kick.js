// Access token for executing server commands
const TOKEN = '';
// Warning displayed in chat at the beginning of GRACE_PERIOD
const REASON = `Auto-kicked commanders at the end of round`;
// Message displayed in chat while performing the kick
const ALERT_TEXT = `Kicking commanders...`;

export default function commanderKick(exec, roundOverPlayersFeed) {
  roundOverPlayersFeed
    .filter(({ meta }) => meta.live)
    .subscribe(({ meta, roundOverObj }) => {
      const _exec = exec.bind(null, TOKEN, [ meta.id ]);

      const commanders = roundOverObj.players
        .filter((plr) => plr.type === '2');

      if (commanders.length > 0) {
        _exec('say', [ ALERT_TEXT ]);
      }

      commanders
        .forEach(({ name }) => {
          _exec('kick', [ name, REASON ]);
        });
    });
}
