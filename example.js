'use strict';

var validator = require('validator');
var merge = require('merge');
var dronebase = require('./dronebase.js');

var drone = dronebase.launch(require('./example.json'), true);

var admins = [
  'Server', // the server gonna keep trying to kick itself without this
  'some-admin',
  'some-other-admin'
];

var others = [
  'some-guy-with-privileges',
  'ACX-jevs' // me :P
];

var privileged = admins.concat(others);

var common = {
  'AC130_Gunship': 'AC-130 GUNSHIP',
  'XP1/Gameplay/Gadgets/UCAV/UCAV_Launcher': 'UCAV'
};

var handgrenades = {
  'U_Flashbang': 'M84 FLASHBANG',
  'U_Grenade_RGO': 'RGO IMPACT',
  'U_M34': 'M34 INCENDIARY',
  'U_M67': 'M67 FRAG',
  'U_V40': 'V40 MINI'
};

var grenadelaunchers = {
  'U_M26Mass_Frag': 'M26 FRAG',
  'U_M320_3GL': 'M320 3GL',
  'U_M320_HE': 'M320 HE',
  'U_M320_LVG': 'M320 LVG',
  'U_XM25': 'AIRBURST'
};

var rocketlaunchers = {
  'U_FGM148': 'JAVELIN',
  'U_NLAW': 'MBT LAW',
  'U_RPG7': 'RPG',
  'U_SMAW': 'SMAW',
  'U_SRAW': 'SRAW'
};

var variousexplosives = {
  'M224': 'MORTAR',
  'U_C4': 'C4',
  'U_C4_Support': 'C4',
  'U_Claymore': 'CLAYMORE',
  'U_Claymore_Recon': 'CLAYMORE'
};

var explosives = merge(
  true,
  common,
  handgrenades,
  grenadelaunchers,
  rocketlaunchers,
  variousexplosives
);

var mapbans = {
  'MP_Prison': explosives, // Operation Locker
  'XP0_Metro': explosives // Operation Metro 2014
};

function say(what, target) {
  var command = ['admin.say', what];
  if (target) {
    command = command.concat(['player', target]);
  } else {
    command = command.concat(['all']);
  }

  drone.request(command);
}

function yell(what, target, duration) {
  var command = ['admin.yell', what, duration ? duration : 5];
  if (target) {
    command = command.concat(['player', target]);
  } else {
    command = command.concat(['all']);
  }

  drone.request(command);
}

function kill(who) {
  drone.request([
    'admin.killPlayer',
    who
  ]);
}

function kick(who, why) {
  drone.request([
    'admin.kickPlayer',
    who,
    why
  ]);
}

function isAdmin(who) {
  return -1 != admins.indexOf(who);
}

function isPrivileged(who) {
  return -1 != privileged.indexOf(who);
}

var toBeKicked = {};
var live = false;
var tellLiveTimeout = false;
var weaponBans = common;

function tellLive() {
  tellLiveCancel();
  var phrase = live ? 'LIVE LIVE LIVE' : 'NOT LIVE';
  say(phrase);
  yell(phrase);
}

function tellLiveCancel() {
  if (tellLiveTimeout) {
    clearTimeout(tellLiveTimeout);
    tellLiveTimeout = false;
  }
}

drone.on('roundstart', function(curr) {
  weaponBans = (curr.map in mapbans) ? mapbans[curr.map] : common;
  tellLiveCancel();
  tellLiveTimeout = setTimeout(tellLive, 60000);
});

// in-game command parser
drone.on('player.onChat', function(words) {
  var player = words[0];
  var command = words[1].trim().toLowerCase();
  if ('/' === command[0]) {
    command = command.slice(1).trim();
  }

  if ('!' != command[0]) {
    checkChat(words);
    return;
  }

  command = command.slice(1).trim();
  switch (command) { // available to everybody
    case 'l?':
    case 'il':
    case 'il?':
    case 'islive':
    case 'islive?': {
      say(live ? 'THIS IS LIVE' : 'THIS IS NOT LIVE', player);
      return;
    }
  }

  // this is for non-privileged
  if (!isPrivileged(player)) {
    checkChat(words);
    return;
  }

  switch (command) { // available to privileged only
    case 'n':
    case 'numbers': {
      checkBalanceCancel();
      checkBalance(player);
      return;
    }
    case 'l':
    case 'live':
    case 'golive': {
      live = true;
      tellLive();
      return;
    }
    case 'nl':
    case 'notlive': {
      live = false;
      tellLive();
      return;
    }
  }

  // this is for others
  if (!isAdmin(player)) {
    checkChat(words);
  }
});

// all chat kicker
function checkChat(words) {
  if (!live) {
    return;
  }

  var player = words[0];
  if ('all' != words[2] || isAdmin(player)) {
    return;
  }

  var now = Date.now();
  var playerup = player.toUpperCase();
  if (
    player in toBeKicked &&
    now - toBeKicked[player] < 28800000 // 8 hours
  ) {
    kick(player, 'NO ALL CHAT');
    say(playerup + ' KICKED FOR ALL CHATTING');
  } else {
    kill(player);
    yell('NO ALL CHAT; NEXT OFFENCE = KICK', player);
    say(playerup + ' WAS JUST KILLED FOR ALL CHATTING');
  }

  toBeKicked[player] = now;
}

// round end commander kicker
drone.on('drone.onRoundOverPlayers', function(words) {
  if (!live) {
    return;
  }

  var len = validator.toFloat(words[11]);
  for (var i = 0; i < len; ++i) {
    if ('2' === words[21 + i*10]) {
      kick(words[12 + i*10], 'ROUND OVER');
    }
  }

  say('COMMANDERS KICKED');
});

// banned weapon user kicker
drone.on('player.onKill', function(words) {
  if (!live) {
    return;
  }

  var weapon = weaponBans[words[2]];
  if (!weapon) {
    return;
  }

  var now = Date.now();
  var player = words[0];
  var playerup = player.toUpperCase();
  if (
    player in toBeKicked &&
    now - toBeKicked[player] < 28800000 // 8 hours
  ) {
    kick(player, weapon + ' IS NOT ALLOWED');
    say(playerup + ' KICKED FOR USING ' + weapon);
  } else {
    kill(player);
    yell(weapon + ' IS NOT ALLOWED; NEXT OFFENCE = KICK', player);
    say(playerup + ' KILLED FOR USING ' + weapon);
  }

  toBeKicked[player] = now;
});

var teams = false;
var numbers = false;
var checkBalanceTimeout = false;

// balance checker, duh; force here is for the in-game command
function checkBalance(player) {
  if (
    !(live || player) ||
    !teams ||
    !('1' in teams && '2' in teams) ||
    (
      !player &&
      numbers &&
      teams['1'].number === numbers['1'] &&
      teams['2'].number === numbers['2']
    )
  ) {
    return;
  }

  numbers = {
    '1': teams['1'].number,
    '2': teams['2'].number
  };

  say('NUMBERS: ' + numbers['1'] + ' vs. ' + numbers['2'], player);
  if (Math.abs(numbers['1'] - numbers['2']) > 3) {
    say('TEAMS ARE UNBALANCED', player);
  }
}

function checkBalanceCancel() {
  if (checkBalanceTimeout) {
    clearTimeout(checkBalanceTimeout);
    checkBalanceTimeout = false;
  }
}

drone.on('teams', function(curr) {
  if (!live) {
    return;
  }

  teams = curr.teams;
  checkBalanceCancel();
  checkBalanceTimeout = setTimeout(function() {
    checkBalanceTimeout = false;
    checkBalance();
  }, 1000);
});
