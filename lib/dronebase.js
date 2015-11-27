import clone from 'clone';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import util from 'util';
import validator from 'validator';
import winston from 'winston';

import {
  ValueError,
} from './errors';

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
    throw new ValueError(
      `invalid target supplied, expected { host, port, password }, got ${JSON.stringify(target, null, 2)}`
    );
  }

  EventEmitter.call(this);

  const maxsequence = 0x3FFFFFFF;
  const sock = new Socket();

  function send(isrequest, sequence, words) {
    let _words = words;

    if (!validator.isInt(sequence)) {
      throw new TypeError(`Drone.send(): expected \`sequence\` argument to be an integer, got: ${typeof sequence}`);
    }

    if (sequence < 0 || sequence > maxsequence) {
      throw new RangeError(`Drone.send(): expected \`sequence\` argument to be between 0 and ${maxsequence}, got: ${sequence}`);
    }

    if (typeof _words === 'string') {
      _words = _words.trim().split(' ');
    } else if (!Array.isArray(_words)) {
      throw new TypeError(`Drone.send(): expected \`words\` argument to be an array or a string, got: ${typeof _words}`);
    }

    if (!_words.length) {
      throw new ValueError(`Drone.send(): invalid argument words: empty`);
    }

    let size = 12;
    for (let i = 0; i < _words.length; ++i) {
      if (typeof _words[i] !== 'string') {
        try {
          _words[i] = _words[i].toString();
        } catch (e) {
          throw new ValueError(`Drone.send(): bad word #${i + 1}: toString failed`);
        }
      }

      _words[i] = _words[i].trim();
      if (!_words[i].length) {
        throw new ValueError(`Drone.send(): bad word #${i + 1}: zero chars`);
      } else if (!/^[\x01-\x7F]+$/.test(_words[i])) {
        throw new ValueError(`Drone.send(): bad word #${i + 1}: invalid chars`);
      }

      size += _words[i].length + 5;
    }

    const data = new Buffer(size);
    data.writeInt32LE(sequence | (isrequest ? 0x80000000 : 0x40000000), 0);
    data.writeInt32LE(size, 4);
    data.writeInt32LE(_words.length, 8);

    let offset = 12;
    _words.forEach((word) => {
      data.writeInt32LE(word.length, offset);
      data.write(word, offset + 4);
      offset += word.length + 5;
      data[offset - 1] = 0;
    });

    winston.debug('<  ] [' + sequence + '] ' + _words.join(' '));
    sock.write(data);
  }

  this.launch = function launch() {
    winston.info(`connecting to ${target.host}:${target.port}...`);
    sock.connect(target.port, target.host);
  };

  /**
   * Send a command, and process the response with a handler.
   *
   * @param   {Array/String}  words     The command.
   * @param   {Function}      callback  The handler.
   */

  const callbacks = {};
  let nextsequence = 0;
  let connected = false;

  this.request = function request(words, callback) {
    if (typeof callback !== 'function') {
      return new Promise((resolve, reject) => {
        try {
          this.request(words, (responseWords) => {
            resolve(responseWords);
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    if (!connected) {
      winston.warn('can not request, this drone is offline');
      return 1;
    }

    if (nextsequence > maxsequence) {
      nextsequence = 0;
    }

    callbacks[nextsequence] = callback;
    send(true, nextsequence++, words);
  };

  const _emit = this.emit.bind(this);
  const _launch = this.launch.bind(this);
  const _request = this.request.bind(this);
  let retrying = true;

  sock.on('connect', function onconnect() {
    winston.info('connection established');
    retrying = false;
    connected = true;
    _request('login.hashed', (words) => {
      const hash = crypto
        .createHash('md5')
        .update(words[1], 'hex')
        .update(target.password.toString(), 'utf8')
        .digest('hex')
        .toUpperCase();
      _request(['login.hashed', hash], () => {
        _emit('up');
        _request('admin.eventsEnabled true');
      });
    });
  });

  sock.on('error', function onerror(error) {
    if (!retrying) {
      winston.error(`error ['${error}']`);
    }
  });

  sock.on('close', function onclose(hadError) {
    connected = false;
    if (!retrying) {
      winston.warn(
        `connection lost ['${ hadError ? 'error' : 'shutdown' }']`
      );
      retrying = true;
      _emit('down');
      _launch();
      return;
    }

    setTimeout(_launch, 1000);
  });

  let buf = new Buffer(0);

  sock.on('data', function ondata(data) {
    buf = Buffer.concat([buf, data]);
    while (buf.length >= 8) {
      const size = buf.readUInt32LE(4);
      if (buf.length < size) {
        return;
      }

      const numwords = buf.readUInt32LE(8);
      const rawsequence = buf.readUInt32LE(0);
      const words = [];
      let len;
      let offset = 12;
      for (let i = 0; i < numwords; ++i) {
        len = buf.readUInt32LE(offset);
        words.push(buf.toString('utf8', offset + 4, offset + 4 + len));
        offset += len + 5;
      }

      buf = buf.slice(offset);
      const sequence = rawsequence & maxsequence;
      winston.debug(
        `  >] [${sequence}] ${(words[0].includes('punkBuster.onMessage') ? 'PB' : words.join(' '))}`
      );
      if (!(rawsequence & 0x40000000)) {
        send(false, sequence, 'OK');
      } else if (callbacks[sequence]) {
        callbacks[sequence](clone(words));
        delete callbacks[sequence];
        continue;
      }

      _emit(words[0], words.slice(1));
      _emit('*', words);
    }
  });
}

util.inherits(Drone, EventEmitter);

module.exports = Drone;
