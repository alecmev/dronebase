import _ from 'lodash';
import winston from 'winston';

import store from './store';

const db = store('chat');

export async function save(soldier, text, scope, bad) {
  return db.insertAsync({
    soldierId: soldier._id,
    text,
    scope,
    bad,
    createdAt: Date.now(),
  });
}

export async function getBad(soldier, since) {
  return db.findAsync({
    soldierId: soldier._id,
    bad: true,
    createdAt: {$gt: since},
  });
}

export async function getBadCount(soldier, since) {
  const docs = await getBad(soldier, since);
  return docs.length;
}
