# dronebase

A bare-bones RCON client library for Battlefield 4 (or any other recent
Battlefield title, if you care to make some minor adjustments). Made for those
wishing to spare themselves all the pain associated with Procon, with no
compromises, other than, well, having to code the rules yourself, instead of
relying on bloated, over-complicated and often bugged third-party plugins.

### Example

```
var drone = require('./dronebase.js').launch({
  "host": "example.com",
  "port": 47200,
  "password": "password"
});

drone.on('player.onChat', function(words) {
  if ('ping' == words[1]) {
    drone.request(['admin.say', 'pong', 'player', words[0]]);
  }
});

drone.on('player.onKill', function(words) {
  drone.request(['admin.say', 'ded :(', 'player', words[1]]);
});
```

See `example.js` for more. It's a real script used in [21st Century
Warfare](https://21cwforums.com/forum.php) for automatic administration of
organized 32v32 battles.

### Usage

See `dronebase.js`, read comments above `Drone`, `on`, `off` and `request`.
Pardon for being so spartan about this.

### Story

This was intended to be a part of something much bigger, but that bigger
*something* failed to go through our quick feasibility study, so it ended up
being abandoned =/ [What it looked like moments before being
archived.](http://i.imgur.com/PBDRH4m.png)

Special thanks to [Alexander Korotkikh](https://github.com/AKorotkikh) AKA
Minor, for his invaluable ideas and input.
