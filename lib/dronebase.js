import async from 'async';
import clone from 'clone';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import util from 'util';
import validator from 'validator';
import winston from 'winston';

// TODO: refactor into an ES6 class
// TODO: promisify everything, use async / await

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

if (!target || !target.host || !target.port || !target.password) {
  throw new Error(
    'invalid target supplied, expected { host, port, password }, got ' +
    JSON.stringify(target, null, 2)
  );
}

EventEmitter.call(this);

const maxsequence = 0x3FFFFFFF;
let nextsequence = 0;
let callbacks = {};

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

  callbacks[nextsequence] = callback;
  send(true, nextsequence++, words);
};

const emit = this.emit.bind(this);
const launch = this.launch.bind(this);
const request = this.request.bind(this);

let buf = new Buffer(0);
let connected = false;
let retrying = true;
let sock = new Socket();

sock.on('connect', function onconnect() {
  winston.info('connection established');
  retrying = false;
  connected = true;
  request('login.hashed', function(words) {
    let hash = crypto
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
    let size = buf.readUInt32LE(4);
    if (buf.length < size) {
      return;
    }

    let rawsequence = buf.readUInt32LE(0);
    let numwords = buf.readUInt32LE(8);
    let len;
    let offset = 12;
    let words = [];
    for (let i = 0; i < numwords; ++i) {
      len = buf.readUInt32LE(offset);
      words.push(buf.toString('utf8', offset + 4, offset + 4 + len));
      offset += len + 5;
    }

    buf = buf.slice(offset);
    let sequence = rawsequence & maxsequence;
    winston.debug(
      '  >] [' + sequence + '] ' + (
        words[0].indexOf('punkBuster.onMessage') >= 0 ?
          'PB' : words.join(' ')
      )
    );
    if (!(rawsequence & 0x40000000)) {
      send(false, sequence, 'OK');
    } else if (callbacks[sequence]) {
      callbacks[sequence](clone(words));
      delete callbacks[sequence];
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

  let size = 12;
  for (let i = 0; i < words.length; ++i) {
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

  let data = new Buffer(size);
  data.writeInt32LE(sequence | (isrequest ? 0x80000000 : 0x40000000), 0);
  data.writeInt32LE(size, 4);
  data.writeInt32LE(words.length, 8);

  let offset = 12;
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

module.exports = Drone;
