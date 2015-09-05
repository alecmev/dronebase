'use strict';

var async = require('async');
var clone = require('clone');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var Socket = require('net').Socket;
var util = require('util');
var validator = require('validator');
var winston = require('winston');

winston.cli();

module.exports = {
  prepare: function(target) {
    if (
      'object' != typeof(target) ||
      !('host' in target && 'port' in target)
    ) {
      throw 'invalid argument target: should be { host, port }';
    }

    return new Drone(target);
  },
};

/**
 * Connects to any RCON query port, and listens for all incoming events.
 *
 * Target is an object containg the IP, the port and the password. See
 * 'example.json' for an example.
 * 
 * Drone inherits from EventEmitter, and supports the following events:
 * - up [connected and logged in]
 * - down [connection lost]
 * - any single rcon event
 * - * [all rcon events]
 *
 * @param  {Object}   target   See above.
 */
function Drone(target) {

EventEmitter.call(this);

var maxsequence = 0x3FFFFFFF;
var nextsequence = 0;
var rcallbacks = {};

this.launch = function launch() {
  winston.info('connecting to ' + target.host + ':' + target.port + '...');
  sock.connect(target.port, target.host);
};

/**
 * Send a command, and process the response with a handler.
 *
 * @param   {Array/String}  words     The command.
 * @param   {Function}      callback  The handler.
 */
this.request = function request(words, callback) {
  if (!connected) {
    winston.warn('can not request, this drone is offline');
    return;
  }

  if (nextsequence > maxsequence) {
    nextsequence = 0;
  }

  rcallbacks[nextsequence] = callback;
  send(true, nextsequence++, words);
};

var emit = this.emit.bind(this);
var launch = this.launch.bind(this);
var request = this.request.bind(this);

var buf = new Buffer(0);
var connected = false;
var retrying = true;
var sock = new Socket();

sock.on('connect', function onconnect() {
  winston.info('connection established');
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
      emit('up');
      request('admin.eventsEnabled true');
    });
  });
});

sock.on('error', function onerror(error) {
  if (!retrying) {
    winston.error('error [' + error + ']');
  }
});

sock.on('close', function onclose(hadError) {
  connected = false;
  if (!retrying) {
    winston.warn(
      'connection lost [' + (hadError ? 'error' : 'shutdown') + ']'
    );
    retrying = true;
    emit('down');
    launch();
    return;
  }

  setTimeout(launch, 1000);
});

sock.on('data', function ondata(data) {
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
    winston.debug(
      '  >] [' + sequence + '] ' + (
        words[0].indexOf('punkBuster.onMessage') >= 0 ?
          'PB' : words.join(' ')
      )
    );
    if (!(rawsequence & 0x40000000)) {
      send(false, sequence, 'OK');
    } else if (rcallbacks[sequence]) {
      rcallbacks[sequence](clone(words));
      delete rcallbacks[sequence];
      continue;
    }

    emit(words[0], words.slice(1));
    emit('*', words);
  }
});

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

  winston.debug('<  ] [' + sequence + '] ' + words.join(' '));
  sock.write(data);
}

}

util.inherits(Drone, EventEmitter);
