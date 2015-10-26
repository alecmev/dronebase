import _ from 'lodash';
import winston from 'winston';
import Promise from 'bluebird';

import store from './store';

const db = store('sessions');
let state = {};

export function get(soldier) {
  winston.debug(`sessions.get ${soldier.name}`);
  return state[soldier._id];
}

export function begin(soldier) {
  const prefix = `sessions.begin ${soldier.name}`;
  winston.debug(prefix);
  if (state[soldier._id]) {
    throw new Error(`${prefix}; session already exists`);
  }

  state[soldier._id] = {
    soldierId: soldier._id,
    beganAt: Date.now(),
  };
}

export async function end(soldier) {
  winston.debug(`sessions.end ${soldier.name}`);
  const session = state[soldier._id];
  if (!session) {
    throw new Error(`${prefix}; no active session`);
  }

  delete state[soldier._id];
  return _end(session);
}

export async function endAll() {
  winston.debug(`sessions.endAll`);
  const oldState = state;
  state = {};
  return Promise.all(_.map(oldState, _end));
}

async function _end(session) {
  session['endedAt'] = Date.now();
  return db.insertAsync(session);
}
