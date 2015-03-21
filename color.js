'use strict';

var clc = require('cli-color');

var map = {
  info: clc.cyanBright,
  warn: clc.yellowBright,
  error: clc.redBright
};

Object.keys(map).forEach(function(fn) {
  var old = console[fn];
  console[fn] = function() {
    var tmp = {};
    for (var arg in arguments) {
      tmp[arg] = map[fn](arguments[arg]);
    }

    old.apply(console, arguments);
  };
});
