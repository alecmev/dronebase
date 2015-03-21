'use strict';

var async = require('async');
var clone = require('clone');
var crypto = require('crypto');
var net = require('net');
var validator = require('validator');

require(__dirname + '/color.js');

module.exports = {
  launch: function(target, isdebug) {
  if (
    'object' != typeof(target) ||
    !('host' in target && 'port' in target)
    ) {
      throw 'invalid argument target: should be { host, port }';
    }

    return new Drone(target, !!isdebug);
  }
};

/**
 * Connects to any RCON query port, and listens for all incoming events.
 *
 * Target is an object containg the IP, the port and the password. See
 * 'sample.json' for an example.
 *
 * @param  {Object}   target   See above.
 * @param  {Boolean}  isdebug  Whether to print all transferred data or not.
 */
function Drone(target, isdebug) {

var sock = new net.Socket();
var rcallbacks = {};
var ecallbacks = {};
var maxsequence = 0x3FFFFFFF;
var nextsequence = 0;
var buf = new Buffer(0);
var retrying = true;
var connected = false;
var curr;

/**
 * Attach an event handler function.
 *
 * Supported events are:
 * - up [connected and logged in]
 * - down [connection lost]
 * - any single rcon event
 * - * [all rcon events]
 * - roundstart [round log cleared, map might be still loading]
 * - roundend [round ended]
 * - roundcomplete [map started loading]
 * - teams [teams might have changed]
 *
 * @param   {String}    event     The event.
 * @param   {Function}  callback  The handler.
 */
function on(event, callback) {
  if (!ecallbacks[event]) {
    ecallbacks[event] = [];
  }

  if (-1 === ecallbacks[event].indexOf(callback)) {
    ecallbacks[event].push(callback);
  }
}
this.on = on;

/**
 * Remove an event handler.
 *
 * See 'on' for a list of all supported events.
 *
 * @param   {String}    event     The event.
 * @param   {Function}  callback  The handler.
 */
function off(event, callback) {
  if (!ecallbacks[event]) {
    throw 'no callbacks for ' + event;
  }

  var index = ecallbacks[event].indexOf(callback);
  if (index >= 0) {
    ecallbacks[event].splice(index, 1);
    if (!ecallbacks[event].length) {
      delete ecallbacks[event];
    }
  }
}
this.off = off;

/**
 * Send a command, and process the response with a handler.
 *
 * @param   {Array/String}  words     The command.
 * @param   {Function}      callback  The handler.
 */
function request(words, callback) {
  if (!connected) {
    console.warn('can not request, this drone is offline');
    return;
  }

  if (nextsequence > maxsequence) {
    nextsequence = 0;
  }

  rcallbacks[nextsequence] = callback;
  send(true, nextsequence++, words);
}
this.request = request;

function connect() {
  console.info('connecting...');
  sock.connect(target.port, target.host);
}

function send(isrequest, sequence, words) {
  if (
    !validator.isInt(sequence) ||
    sequence < 0 ||
    sequence > maxsequence
  ) {
    throw 'invalid argument sequence';
  }

  if ('string' === typeof words) {
    words = words.trim().split(' ');
  } else if (!Array.isArray(words)) {
    throw 'invalid argument words: not an array or a string';
  }
  
  if (!words.length) {
    throw 'invalid argument words: empty';
  }

  var size = 12;
  for (var i = 0; i < words.length; ++i) {
    if ('string' != typeof words[i]) {
      try {
        words[i] = words[i].toString();
      }
      catch (e) {
        throw 'bad word #' + (i + 1) + ': toString failed';
      }
    }

    words[i] = words[i].trim();
    if (!words[i].length) {
      throw 'bad word #' + (i + 1) + ': zero chars';
    } else if (!/^[\x01-\x7F]+$/.test(words[i])) {
      throw 'bad word #' + (i + 1) + ': invalid chars';
    }

    size += words[i].length + 5;
  }

  var data = new Buffer(size);
  data.writeInt32LE(sequence | (isrequest ? 0x80000000 : 0x40000000), 0);
  data.writeInt32LE(size, 4);
  data.writeInt32LE(words.length, 8);

  var offset = 12;
  words.forEach(function(word) {
    data.writeInt32LE(word.length, offset);
    data.write(word, offset + 4);
    offset += word.length + 5;
    data[offset - 1] = 0;
  });

  if (isdebug) {
    console.log('<  [' + sequence + '] ' + words.join(' '));
  }

  sock.write(data);
}

function ecallback(word, data) {
  if (ecallbacks[word]) {
    async.eachSeries(
      ecallbacks[word], function(fn, callback) {
        fn(clone(data));
        callback();
      }, function(error) {
        if (error) {
          console.error(error);
          return;
        }
      }
    );
  }
}

function onconnect() {
  console.info('connection established');
  retrying = false;
  connected = true;
  request('login.hashed', function(words) {
    var hash = crypto
      .createHash('md5')
      .update(words[1], 'hex')
      .update(target.password, 'utf8')
      .digest('hex')
      .toUpperCase();
    request(['login.hashed', hash], function() {
      ecallback('up');
      request('admin.eventsEnabled true');
    });
  });
}

function onerror(error) {
  if (!retrying) {
    console.error('error [' + error + ']');
  }
}

function onclose(hadError) {
  connected = false;
  if (!retrying) {
    console.warn(
      'connection lost [' + (hadError ? 'error' : 'shutdown') + ']\n' +
      'hang on...'
    );
    retrying = true;
    ecallback('down');
    connect();
    return;
  }

  setTimeout(connect, 1000);
}

function ondata(data) {
  buf = Buffer.concat([buf, data]);
  while (buf.length >= 8) {
    var size = buf.readUInt32LE(4);
    if (buf.length < size) {
      return;
    }

    var rawsequence = buf.readUInt32LE(0);
    var numwords = buf.readUInt32LE(8);
    var len;
    var offset = 12;
    var words = [];
    for (var i = 0; i < numwords; ++i) {
      len = buf.readUInt32LE(offset);
      words.push(buf.toString('utf8', offset + 4, offset + 4 + len));
      offset += len + 5;
    }

    buf = buf.slice(offset);
    var sequence = rawsequence & maxsequence;
    if (isdebug) {
      var message = (
        words[0].indexOf('punkBuster.onMessage') >= 0 ?
          'PB' : words.join(' ')
      );
      console.log(' >>> [' + sequence + '] ' + message);
    }

    if (!(rawsequence & 0x40000000)) {
      send(false, sequence, 'OK');
    } else if (rcallbacks[sequence]) {
      rcallbacks[sequence](clone(words));
      delete rcallbacks[sequence];
      continue;
    }

    ecallback(words[0], words.slice(1));
    ecallback('*', words);
  }
}

function roundcallback(type) {
  ecallback('round' + type, curr);
}

function onup() {
  curr = {
    start: Date.now(),
    normalstart: false,
    log: []
  };
  request('serverinfo', function(words) {
    // this is here to prevent a possible race condition
    if (!('map' in curr)) {
      curr.map = words[5];
      roundcallback('start');
    }
  });
}

function ondown() {
  if (!('end' in curr)) {
    curr.end = Date.now();
  }

  roundcallback('complete');
}

function onall(words) {
  curr.log.push({
    timestamp: Date.now(),
    words: words
  });
}

function onlevelloaded(words) {
  // round callback can take a non-negligible amount of time
  var now = Date.now();
  roundcallback('complete');
  curr = {
    start: now,
    normalstart: true,
    map: words[0],
    log: []
  };
  roundcallback('start');
}

function onroundover(words) {
  curr.end = Date.now();
  curr.winner = words[0];
}

function onroundoverteamscores(words) {
  curr.scores = words;
  roundcallback('end');
}

function moveplayer(player, teamid, squadid) {
  deleteplayer(player);
  curr.players[player] = {
    teamid: teamid,
    squadid: squadid
  };

  if (!(teamid in curr.teams)) {
    curr.teams[teamid] = {'number': 0};
  }

  if (!(squadid in curr.teams[teamid])) {
    curr.teams[teamid][squadid] = [];
  }

  curr.teams[teamid][squadid].push(player);
  curr.teams[teamid].number += 1;
}

function deleteplayer(player) {
  if (!(player in curr.players)) {
    return;
  }

  var info = curr.players[player];
  var squad = curr.teams[info.teamid][info.squadid];
  var id = squad.indexOf(player);
  if (-1 === id) {
    throw 'something is wrong with player monitoring';
  }

  squad.splice(id, 1);
  delete curr.players[player];
  curr.teams[info.teamid].number -= 1;
}

function teamscallback() {
  ecallback('teams', curr);
}

function onroundstart() {
  request('admin.listPlayers all', function(words) {
    curr.teams = {};
    curr.players = {};
    var len = (Math.floor(words.length / 10) - 1) * 10;
    for (var i = 0; i < len; i += 10) {
      var type = words[22 + i];
      // due to protocol limitations, commanders are counted as players
      if ('0' != type && '2' != type) {
        continue;
      }

      moveplayer(words[13 + i], words[15 + i], words[16 + i]);
    }

    teamscallback();
  });
}

function onteamchange(words) {
  moveplayer(words[0], words[1], words[2]);
  teamscallback();
}

function onleave(words) {
  deleteplayer(words[0]);
  teamscallback();
}

sock.on('connect', onconnect);
sock.on('error', onerror);
sock.on('close', onclose);
sock.on('data', ondata);

this.on('up', onup);
this.on('down', ondown);
this.on('*', onall);
this.on('server.onLevelLoaded', onlevelloaded);
this.on('server.onRoundOver', onroundover);
this.on('server.onRoundOverTeamScores', onroundoverteamscores);
this.on('roundstart', onroundstart);
this.on('player.onTeamChange', onteamchange);
this.on('player.onLeave', onleave);

console.info('drone going up [' + target.host + ':' + target.port + ']');
connect();

} // module.exports
