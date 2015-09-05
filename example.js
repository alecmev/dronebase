'use strict';

var _ = require('lodash');
var assert = require('assert');
var async = require('async');
var fs = require('fs');
var GitHubApi = require('github');
var merge = require('merge');
var moment = require('moment');
var MongoClient = require('mongodb').MongoClient
var request = require('request');
var url = require('url');
var validator = require('validator');
var winston = require('winston');

var bf4 = require('./bf4');
var dronebase = require('./dronebase');
var droneTarget = require('./' + process.argv[2] + '.json');
var githubToken = require('./github.json').token;

winston.level = 'info';

var admins = [
  'ACX-jevs',
  'AvS-Mr_Falls',
  'daskro',
  'eBash-Hyper',
  'IIRazieLII',
  'Kevinario',
  'Level-A3ther',
  'Level-Paramon',
  'Level-Qoogla',
];

var allowedChat = [
  'gl',
  'goodluck',

  'hf',
  'havefun',

  'glhf',
  'goodluckhavefun',

  'hfgl',
  'havefungoodluck',

  'gr',
  'goodround',

  'gh',
  'goodhalf',

  'close',
  'closeround',
  'closehalf',

  'g',
  'gg',
  'ggg',
  'ggs',
  'goodgame',

  'wp',
  'wellplayed',

  'ggwp',
  'goodgamewellplayed',

  'nice',
  'nicefight',
  'nicefights',
  'goodfight',
  'goodfights',

  'n1',
  'ns',
  'niceshot',
];

var ALLCHAT_WARNINGS = 2;
var ALLCHAT_MEMORY = 1; // days

var weaponBans = {
  'AC130_Gunship': 'AC-130 GUNSHIP',
  'XP1/Gameplay/Gadgets/UCAV/UCAV_Launcher': 'UCAV',
};

var drone = dronebase.prepare(droneTarget);
var roundState = null;
var db = null;

MongoClient.connect('mongodb://mongo/dronebase', function(err, tmpdb) {
  assert.equal(null, err);
  winston.info('mongo ready');
  db = tmpdb;
  drone.launch();
});

function startRound(startTime, isLateStart) {
  winston.info('startRound', startTime, isLateStart);
  if (roundState && startTime < roundState.startTime) {
    winston.error('startRound', 'probably race condition');
    return;
  } else if (roundState && !roundState.endTime) {
    winston.info('startRound', 'probably round restart');
    // endRound(startTime, true);
  }

  roundState = {
    startTime: startTime,
    isLateStart: isLateStart,
  };
  return roundState;
}

function endRound(endTime, isEarlyEnd) {
  winston.info('endRound', endTime, isEarlyEnd);
  if (!roundState || roundState.endTime || endTime < roundState.startTime) {
    winston.error('endRound', 'probably race condition');
    return;
  }

  roundState.endTime = endTime;
  roundState.isEarlyEnd = isEarlyEnd;
}

function requestServerInfo(callback) {
  drone.request('serverinfo', function(words) {
    var scores = words.splice(8, words[8]*1 + 2);
    var data = _.zipObject([
      'status',
      'serverName', // string
      'currentPlayercount', // integer
      'effectiveMaxPlayercount', // integer
      'mode', // string
      'map', // string
      'roundsPlayed', // integer
      'roundsTotal', // string
      'onlineState', // online state
      'ranked', // boolean
      'punkBuster', // boolean
      'hasGamePassword', // boolean
      'serverUpTime', // seconds
      'roundTime', // seconds
      'gameIpAndPort', // IpPortPair
      'punkBusterVersion', //  string
      'joinQueueEnabled', // boolean
      'region', // string
      'closestPingSite', // string
      'country', // string
      // 'matchMakingEnabled', // boolean
      'blazePlayerCount', // integer
      'blazeGameState' // string
    ], words);
    data.scores = scores;
    winston.info('serverinfo', data);
    callback(data);
  });
}

function say(what, target) {
  winston.warn('say', what);
  var command = ['admin.say', what];
  if (target) {
    command = command.concat(['player', target]);
  } else {
    command = command.concat(['all']);
  }

  drone.request(command);
}

function yell(what, target, duration) {
  winston.warn('yell', what);
  var command = ['admin.yell', what, duration ? duration : 5];
  if (target) {
    command = command.concat(['player', target]);
  } else {
    command = command.concat(['all']);
  }

  drone.request(command);
}

function kill(who) {
  winston.warn('kill', who);
  drone.request(['admin.killPlayer', who]);
}

function kick(who, why) {
  winston.warn('kick', who);
  drone.request(['admin.kickPlayer', who, why]);
}

function isAdmin(who) {
  return who === 'Server' || admins.indexOf(who) > -1;
}

drone.on('up', function() {
  winston.info('up');
  var tmpState = startRound(Date.now(), true);
  requestServerInfo(function(data) {
    tmpState.map = data.map;
    tmpState.mode = data.mode;
  });
});

drone.on('down', function() {
  winston.info('down');
  endRound(Date.now(), true);
});

var live = process.argv.indexOf('--live') !== -1;
var tellLiveTimeout = false;

function tellLive() {
  tellLiveCancel();
  var phrase = live ? 'LIVE LIVE LIVE [NO ALL CHAT]' : 'NOT LIVE';
  yell(phrase, false, 15);
  for (var i = 0; i < 10; ++i) {
    say(phrase);
  }

  if (live) {
    checkTags();
  }
}

function tellLiveCancel() {
  if (tellLiveTimeout) {
    clearTimeout(tellLiveTimeout);
    tellLiveTimeout = false;
  }
}

drone.on('server.onLevelLoaded', function(words) {
  var data = _.zipObject([
    'map',
    'mode',
    'roundsPlayed',
    'roundsTotal'
  ], words);
  winston.info('server.onLevelLoaded', data);
  startRound(Date.now(), false);
  roundState.map = data.map;
  roundState.mode = data.mode;
  tellLiveCancel();
  tellLiveTimeout = setTimeout(tellLive, 60000);
});

drone.on('server.onRoundOver', function(words) {
  var data = _.zipObject([
    'winningTeam',
  ], words);
  winston.info('server.onRoundOver', data);
  roundState.winningTeam = data.winningTeam;
  roundOver();
});

drone.on('server.onRoundOverPlayers', function(words) {
  var fieldCount = words[0] * 1;
  var playerCount = words[11] * 1;
  var keys = words.slice(1, 11);
  var data = [];
  for (var i = 0; i < playerCount; ++i) {
    data.push(_.zipObject(
      keys, words.slice(
        1 + fieldCount + 1 + i*fieldCount,
        1 + fieldCount + 1 + i*fieldCount + fieldCount
      )
    ));
  }

  winston.info('server.onRoundOverPlayers', data);
  roundState.players = data;
  roundOver();
});

drone.on('server.onRoundOverTeamScores', function(words) {
  var scores = words.splice(1, words[0] * 1);
  var data = _.zipObject([
    'numberOfScores',
    'targetScore',
  ], words);
  data.scores = scores;
  winston.info('server.onRoundOverTeamScores', data);
  roundState.scores = data.scores;
  roundState.targetScore = data.targetScore;
  roundOver();
});

function getTag(player, callback) {
  request.get({
    url: url.format({
      protocol: 'http',
      host: 'battlelog.battlefield.com',
      pathname: 'bf4/user/' + player,
    }),
    headers: {
      'X-AjaxNavigation': 1,
    },
  }, function(error, response, data) {
    if (error) {
      winston.error(error);
      callback(null);
      return;
    }

    try {
      var tag = _.filter(
        JSON.parse(data).context.soldiersBox,
        {'game': 2048}
      )[0].persona.clanTag;
    }
    catch (error) {
      winston.error(error);
      callback(null);
      return;
    }

    callback(tag);
  });
}

// drone.on('player.onAuthenticated');
// drone.on('player.onChat');
// drone.on('player.onDisconnect');
// drone.on('player.onJoin');
// drone.on('player.onKill');
// drone.on('player.onLeave');
// drone.on('player.onSpawn');

var teamTree = {};
var teamTreeReverse = {};

function teamTreeRemove(player) {
  var reverse = teamTreeReverse[player];
  _.pull(teamTree[reverse.team][reverse.squad], player);

  if (!teamTree[reverse.team][reverse.squad].length) {
    delete teamTree[reverse.team][reverse.squad];
  }

  if (!_.keys(teamTree[reverse.team]).length) {
    delete teamTree[reverse.team];
  }
}

function teamTreeAdd(player) {
  var reverse = teamTreeReverse[player];
  if (!_.has(teamTree, reverse.team)) {
    teamTree[reverse.team] = {};
  }

  if (!_.has(teamTree[reverse.team], reverse.squad)) {
    teamTree[reverse.team][reverse.squad] = [];
  }

  teamTree[reverse.team][reverse.squad].push(player);
}

function teamSquadChange(words) {
  var data = _.zipObject([
    'player',
    'team',
    'squad',
  ], words);

  if (data.team === '0') {
    // spectators and people loading
    return;
  }

  if (_.has(teamTreeReverse, data.player)) {
    teamTreeRemove(data.player);
  }

  var reverse = {
    team: data.team,
    squad: data.squad,
  };
  teamTreeReverse[data.player] = reverse;
  teamTreeAdd(data.player);
}

drone.on('player.onTeamChange', teamSquadChange);
drone.on('player.onSquadChange', teamSquadChange);

drone.on('player.onDisconnect', function(words) {
  var data = _.zipObject([
    'player',
    'reason',
  ], words);

  if (_.has(teamTreeReverse, data.player)) {
    teamTreeRemove(data.player);
    delete teamTreeReverse[data.player];
  }
});

function checkTags() {
  _.forOwn(teamTree, function(team) {
    async.map(
      _.reduce(team, function(result, squad) {
        return result.concat(squad);
      }, []), function(player, callback) {
        getTag(player, function(tag) {
          callback(null, {
            player: player,
            tag: tag,
          });
        });
      }, function(err, playersTags) {
        if (playersTags.length < 16) {
          winston.error('not enough players for the tags to matter');
          return;
        }

        var dominantTag = _.reduce(
          _.countBy(playersTags, function(playerTag) {
            return playerTag.tag;
          }), function(result, count, tag) {
            if (count > result.count) {
              return {
                name: tag,
                count: count,
              };
            }

            return result;
          }, {
            count: 0,
          }
        );

        if (dominantTag.count < playersTags.length / 2) {
          winston.error('no dominant tag found, closest one is', dominantTag);
          return;
        }

        winston.warn('dominant tag found:', dominantTag);

        playersTags.forEach(function(playerTag) {
          if (playerTag.tag === dominantTag.name) {
            return;
          }

          kick(playerTag.player, 'WRONG TAGS');
          say(playerTag.player + ' KICKED FOR WEARING WRONG TAGS');
        });
      }
    );
  });
}

function roundOver() {
  if (!roundState.endTime) {
    endRound(Date.now(), false);
  }

  if (
    !roundState.winningTeam ||
    !roundState.players ||
    !roundState.scores // targetScore is implied
  ) {
    return;
  }

  // winston.info('roundOver', roundState);
  db.collection('rounds').insert(roundState, function(err) {
    if (err) winston.error('roundOver', err);
  });

  var teams = {};
  for (var i = 1; i <= roundState.scores.length; ++i) {
    teams[i] = {
      score: roundState.scores[i - 1],
      players: [],
      commander: null,
    };
  }

  var mvp = null;
  var killingMachine = null;
  var purpleHeart = null;
  var shotCaller = null;

  roundState.players.forEach(function(player) {
    if (player.teamId === '0') {
      // spectators and people loading
      return;
    }

    player.score = player.score * 1;
    player.kills = player.kills * 1;
    player.deaths = player.deaths * 1;

    if (player.type === '0') {
      teams[player.teamId].players.push(player);
    } else if (player.type === '2') {
      if (live) {
        kick(player.name, 'ROUND OVER, REJOIN');
      }

      teams[player.teamId].commander = player;
      if (!shotCaller || player.score > shotCaller.score) {
        shotCaller = player;
      }
    }

    if (!mvp || player.score > mvp.score) {
      mvp = player;
    }

    if (!killingMachine || player.kills > killingMachine.kills) {
      killingMachine = player;
    }

    if (!purpleHeart || player.deaths > purpleHeart.deaths) {
      purpleHeart = player;
    }
  });

  var bold = function(text) {
    return '**' + text + '**';
  };

  var code = function(text) {
    return '`' + text + '`';
  };

  var battlelog = function(player) {
    return (
      '[' + player.name + ']' +
      '(http://battlelog.battlefield.com/bf4/user/' + player.name + '/)'
    );
  };

  var battlelogOrNA = function(player) {
    return player ? battlelog(player) : 'N/A';
  };

  var statOrEmpty = function(player, stat) {
    return player ? ' ' + code(player[stat]) : '';
  };

  var possibly = function(what) {
    return roundState.isLateStart ? ' ' + code('possibly ' + what) : '';
  };

  var report = _.reduce(teams, function(result, team, teamId) {
    var playerId = 1;
    result += _.reduce(
      _.sortByOrder(
        teams[teamId].players,
        ['score', 'name'],
        ['desc', 'asc']
      ), function(result, player) {
        return (
          result + '\n' +
          (playerId++) + ' | ' +
          battlelog(player) + ' | ' +
          player.kills + ' | ' +
          player.deaths + ' | ' +
          player.score
        );
      }, (
        '# Team ' + teamId + '\n\n' +
        'Tickets: ' + code(Math.floor(team.score)) + '\n\n' +
        ' | Name | K | D | Score \n' +
        ' ---:|:--- |:---:|:---:| ---:'
      )
    ) + '\n';
    if (team.commander) {
      result += (
        bold('Commander') + ' | ' +
        bold(battlelog(team.commander)) + ' | ' +
        bold(team.commander.kills) + ' | ' +
        bold(team.commander.deaths) + ' | ' +
        bold(team.commander.score) + '\n'
      );
    }

    return result + '\n';
  }, (
    'Start time: ' +
      bold(
        moment(roundState.startTime).format('HH:mm:ss')
      ) + possibly('earlier') + '  \n' +
    'End time: ' +
      bold(moment(roundState.endTime).format('HH:mm:ss')) + '  \n' +
    'Duration: ' +
      bold(
        moment.utc(
          roundState.endTime - roundState.startTime
        ).format('HH:mm:ss')
      ) + possibly('longer') + '  \n\n' +

    'Map: ' + bold(bf4.maps[roundState.map].name) + '  \n' +
    'Mode: ' + bold(bf4.modes[roundState.mode]) + '  \n\n' +
    
    'MVP: ' + 
      bold(
        battlelogOrNA(mvp) + 
        statOrEmpty(mvp, 'score')
      ) + '  \n' +
    'Killing Machine: ' + 
      bold(
        battlelogOrNA(killingMachine) + 
        statOrEmpty(killingMachine, 'kills')
      ) + '  \n' +
    'Purple Heart: ' + 
      bold(
        battlelogOrNA(purpleHeart) + 
        statOrEmpty(purpleHeart, 'deaths')
      ) + '  \n' +
    'Shotcaller: ' + 
      bold(
        battlelogOrNA(shotCaller) + 
        statOrEmpty(shotCaller, 'score')
      ) + '\n\n'
  ));

  var github = new GitHubApi({
    version: '3.0.0',
  });

  github.authenticate({
    type: 'oauth',
    token: githubToken,
  }, function(err) {
    if (err) {
      winston.error(err);
    }
  });

  var req = {
    public: false,
    files: {}
  };

  req.files['levelbf-' + new Date().toISOString() + '.md'] = {
    'content': report
  };

  github.gists.create(req, function(err, res) {
    if (err) {
      winston.error(err);
      return;
    }

    winston.info('========', res.html_url, '========');
  });
}

// in-game command parser
drone.on('player.onChat', function(words) {
  var data = _.zipObject([
    'player',
    'text',
    'scope',
  ], words);

  var command = data.text.trim().toLowerCase();
  if (command[0] === '/') {
    command = command.slice(1).trim();
  }

  if (command[0] !== '!') {
    checkChat(data);
    return;
  }

  command = command.slice(1).trim();
  switch (command) { // available to everybody
    case 'l?':
    case 'il':
    case 'il?':
    case 'islive':
    case 'islive?': {
      say(live ? 'THIS IS LIVE' : 'THIS IS NOT LIVE', data.player);
      return;
    }
  }

  if (!isAdmin(data.player)) {
    checkChat(data);
    return;
  }

  switch (command) {
    case 'l':
    case 'live':
    case 'golive': {
      winston.warn('live');
      live = true;
      tellLive();
      return;
    }
    case 'nl':
    case 'notlive': {
      winston.warn('not live');
      live = false;
      tellLive();
      return;
    }
  }
});

// all chat kicker
function checkChat(data) {
  if (!live) {
    return;
  }

  if (data.scope !== 'all' || isAdmin(data.player)) {
    return;
  }

  var textTrimmed = data.text.trim().toLowerCase().replace(/\W/g, '');
  var isAllowed = allowedChat.indexOf(textTrimmed) !== -1;
  if (isAllowed) {
    winston.info('allchat', data.text, data.player);
  } else {
    winston.error('allchat', data.text, data.player);
  }

  db.collection('allchat').insert({
    player: data.player,
    text: data.text,
    timestamp: Date.now(),
    isAllowed: isAllowed,
  }, function(err) {
    if (err) {
      winston.error('checkChat', err);
      return;
    }

    if (isAllowed) {
      return;
    }

    db.collection('allchat').find({
      player: data.player,
      timestamp: {$gt: moment().subtract(ALLCHAT_MEMORY, 'days').valueOf()},
      isAllowed: false,
    }).count(function(err, count) {
      if (count > ALLCHAT_WARNINGS) {
        winston.error('kick', data.player);
        kick(data.player, 'NO ALL CHAT');
        say(data.player + ' KICKED FOR ALL CHATTING');
      } else {
        winston.warn('warning', count, '/', ALLCHAT_WARNINGS, data.player);
        yell(
          'NO ALL CHAT, WARNING ' + count + ' OUT OF ' + ALLCHAT_WARNINGS,
          data.player
        );
        say(data.player + ' WARNED FOR ALL CHATTING');
      }
    });
  });
}

// banned weapon user kicker
drone.on('player.onKill', function(words) {
  if (!live) {
    return;
  }

  var data = _.zipObject([
    'player',
    'victim',
    'weapon',
  ], words);

  var weaponName = weaponBans[data.weapon];
  if (!weaponName) {
    return;
  }

  kick(data.player, weaponName + ' IS NOT ALLOWED');
  say(data.player + ' KICKED FOR USING ' + weaponName);
});

// TODO: implement loadout checker
// TODO: check and cache tags / loadout on join (with a timeout)
// TODO: invalidate tag cache on every team switch
// TODO: invalidate loadout cache on every spawn, but not more frequently than
//       once a minute, unless there was a violation
// TODO: use the accumulated data in the end for report generation
// TODO: track the amount of time people play in live rounds total
// TODO: track how much has a person played as % of the round
