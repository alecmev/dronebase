import _ from 'lodash';
import GitHubApi from 'github';
import moment from 'moment';
import winston from 'winston';

import { load as loadConfig } from '../lib/config.js';
import bf4 from '../lib/bf4.json';
import Drone from '../lib/dronebase';

const configName = process.argv[2];
const config = loadConfig(configName);
winston.level = config.log.level;
winston.cli();

const github = new GitHubApi({
  version: '3.0.0',
});
github.authenticate({
  type: 'oauth',
  token: config.github,
}, function(err) {
  if (err) {
    winston.error(err);
    process.exit(1);
  }
});

const drone = new Drone(config.target);

const state = {
  round: null
};

function requestServerInfo(callback) {
  drone.request('serverinfo', function(words) {
    let scores = words.splice(8, words[8]*1 + 2);
    let data = _.zipObject([
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

function startRound(startTime, isLateStart) {
  winston.info('startRound', startTime, isLateStart);
  if (state.round && startTime < state.round.startTime) {
    winston.error('startRound', 'probably race condition');
    return;
  } else if (state.round && !state.round.endTime) {
    winston.info('startRound', 'probably round restart');
  }

  state.round = {
    startTime: startTime,
    isLateStart: isLateStart,
  };
  return state.round;
}

function endRound(endTime, isEarlyEnd) {
  winston.info('endRound', endTime, isEarlyEnd);
  if (!state.round || state.round.endTime || endTime < state.round.startTime) {
    winston.error('endRound', 'probably race condition');
    return;
  }

  state.round.endTime = endTime;
  state.round.isEarlyEnd = isEarlyEnd;
}

drone.on('up', function() {
  winston.info('up');
  let tmpState = startRound(Date.now(), true);
  requestServerInfo(function(data) {
    tmpState.map = data.map;
    tmpState.mode = data.mode;
  });
});

drone.on('down', function() {
  winston.info('down');
  endRound(Date.now(), true);
});

drone.on('server.onLevelLoaded', function(words) {
  let data = _.zipObject([
    'map',
    'mode',
    'roundsPlayed',
    'roundsTotal'
  ], words);
  winston.info('server.onLevelLoaded', data);
  startRound(Date.now(), false);
  state.round.map = data.map;
  state.round.mode = data.mode;
});

drone.on('server.onRoundOver', function(words) {
  let data = _.zipObject([
    'winningTeam',
  ], words);
  winston.info('server.onRoundOver', data);
  state.round.winningTeam = data.winningTeam;
  roundOver();
});

drone.on('server.onRoundOverPlayers', function(words) {
  let fieldCount = words[0] * 1;
  let playerCount = words[11] * 1;
  let keys = words.slice(1, 11);
  let data = [];
  for (let i = 0; i < playerCount; ++i) {
    data.push(_.zipObject(
      keys, words.slice(
        1 + fieldCount + 1 + i*fieldCount,
        1 + fieldCount + 1 + i*fieldCount + fieldCount
      )
    ));
  }

  winston.info('server.onRoundOverPlayers', data);
  state.round.players = data;
  roundOver();
});

drone.on('server.onRoundOverTeamScores', function(words) {
  let scores = words.splice(1, words[0] * 1);
  let data = _.zipObject([
    'numberOfScores',
    'targetScore',
  ], words);
  data.scores = scores;
  winston.info('server.onRoundOverTeamScores', data);
  state.round.scores = data.scores;
  state.round.targetScore = data.targetScore;
  roundOver();
});

function roundOver() {
  if (!state.round.endTime) {
    endRound(Date.now(), false);
  }

  if (
    !state.round.winningTeam ||
    !state.round.players ||
    !state.round.scores // targetScore is implied
  ) {
    return;
  }

  let teams = {};
  for (let i = 1; i <= state.round.scores.length; ++i) {
    teams[i] = {
      score: state.round.scores[i - 1],
      players: [],
    };
  }

  let mvp = null;
  let killingMachine = null;
  let purpleHeart = null;

  state.round.players.forEach(function(player) {
    if (player.teamId === '0') {
      // spectators and people loading
      return;
    }

    player.score = player.score * 1;
    player.kills = player.kills * 1;
    player.deaths = player.deaths * 1;

    if (player.type === '0') {
      teams[player.teamId].players.push(player);
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

  const bold = function(text) {
    return '**' + text + '**';
  };

  const code = function(text) {
    return '`' + text + '`';
  };

  const battlelog = function(player) {
    return (
      '[' + player.name + ']' +
      '(http://battlelog.battlefield.com/bf4/user/' + player.name + '/)'
    );
  };

  const battlelogOrNA = function(player) {
    return player ? battlelog(player) : 'N/A';
  };

  const statOrEmpty = function(player, stat) {
    return player ? ' ' + code(player[stat]) : '';
  };

  const possibly = function(what) {
    return state.round.isLateStart ? ' ' + code('possibly ' + what) : '';
  };

  let report = _.reduce(teams, function(result, team, teamId) {
    let playerId = 1;
    return result + _.reduce(
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
    ) + '\n\n';
  }, (
    'Start time: ' +
      bold(
        moment(state.round.startTime).format('HH:mm:ss')
      ) + possibly('earlier') + '  \n' +
    'End time: ' +
      bold(moment(state.round.endTime).format('HH:mm:ss')) + '  \n' +
    'Duration: ' +
      bold(
        moment.utc(
          state.round.endTime - state.round.startTime
        ).format('HH:mm:ss')
      ) + possibly('longer') + '  \n\n' +

    'Map: ' + bold(bf4.maps[state.round.map].name) + '  \n' +
    'Mode: ' + bold(bf4.modes[state.round.mode]) + '  \n\n' +
    
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
      ) + '\n\n'
  ));

  let req = {
    public: false,
    files: {},
  };
  req.files[configName + '-' + new Date().toISOString() + '.md'] = {
    'content': report,
  };
  github.gists.create(req, function(err, res) {
    if (err) {
      winston.error(err);
      return;
    }

    winston.info('================', res.html_url, '================');
  });
}

drone.launch();
