import _ from 'lodash';
import winston from 'winston';

import * as battlelog from './battlelog';
import store from './store';

const db = store('soldiers');

// guid is for past record matching
// name is for new soldiers
export async function get(guid, name) {
  const prefix = `soldiers.get ${guid} ${name}`;
  winston.debug(prefix);
  let soldier = await db.findOneAsync({_id: guid});
  if (soldier) {
    winston.debug(`${prefix}; returning`);
    await update(soldier);
    if (name !== soldier.name) {
      // TODO: I don't even
      winston.error(`wat ${name} !== ${soldier.name}`);
      throw new Error('wat');
    }
  } else {
    winston.debug(`${prefix}; new`);
    // TODO: catch 404
    const { persona, user } = await battlelog.findPersona(name);
    soldier = await db.insertAsync({
      _id: guid,
      personaId: persona.personaId,
      userId: user.userId,
      name: persona.personaName,
      tag: persona.clanTag,
      gravatar: user.gravatarMd5,
      pastNames: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return soldier;
}

export async function update(soldier, force) {
  winston.debug(`soldiers.update ${soldier._id} ${!!force}`);
  const { persona, user } = await battlelog.getPersona(soldier.personaId);
  if (soldier.name !== persona.personaName) {
    winston.debug('soldier.name');
    soldier.pastNames.push({
      name: soldier.name,
      changedAt: Date.now(),
    });
    soldier.name = persona.personaName;
  }
  if (soldier.tag !== persona.clanTag) {
    winston.debug('soldier.tag');
    soldier.tag = persona.clanTag;
  }
  if (soldier.gravatar !== user.gravatarMd5) {
    winston.debug('soldier.gravatar');
    soldier.gravatar = user.gravatarMd5;
  }

  soldier.updatedAt = Date.now();
  db.update({_id: soldier._id}, soldier); // no await intentionally
}
