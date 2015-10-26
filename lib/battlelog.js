import _ from 'lodash';
import ExtendableError from 'es6-error';
import fetch from 'isomorphic-fetch';
import Promise from 'bluebird';
import winston from 'winston';
import formurlencoded from 'form-urlencoded';

// TODO: add resource / form / response to these
export class BattlelogFetchError extends ExtendableError {}

async function _fetch(resource, form, retry) {
  const prefix = `battlelog.fetch ${resource} ${JSON.stringify(form)}`;
  if (retry === undefined) {
    winston.debug(prefix);
    retry = 0; // default amount of retries
  }

  const options = {headers: {'X-AjaxNavigation': 1}};
  if (form) {
    const body = formurlencoded.encode(form);
    _.merge(options, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
      },
      method: 'post',
      body,
    });
  }

  const response = await fetch(
    `http://battlelog.battlefield.com/bf4${resource}`,
    options
  );
  const returned = `${prefix}; returned ${response.status}`;
  if (response.status >= 200 && response.status < 300) {
    winston.debug(returned);
    return response.json();
  }
  if (response.status === 404) {
    throw new BattlelogFetchError(returned);
  }
  if (retry > 0) {
    winston.warn(`${returned}, retrying`);
    // this shouldn't happen too often, so 1s delay is fine
    await Promise.delay(1000);
    return await _fetch(resource, form, retry - 1);
  }

  throw new BattlelogFetchError(returned);
}

export async function getUser(name) {
  winston.debug(`battlelog.getUser ${name}`);
  const data = await _fetch(`/user/${name}`);
  if (data.template && data.template !== 'profile.warsawoverview') {
    throw new BattlelogFetchError(`user ${name} not found`);
  }

  return data;
}

export async function getPersona(personaId) {
  winston.debug(`battlelog.getPersona ${personaId}`);
  // TODO: peasantry
  const data = await _fetch(`/soldier/-/stats/${personaId}/pc`);
  if (data.template && data.template !== 'profile.warsawstats') {
    throw new BattlelogFetchError(`persona ${personaId} not found`);
  }

  return {
    persona: data.context.statsPersona,
    user: data.context.user,
  };
}

export async function findPersona(name) {
  winston.debug(`battlelog.findPersona ${name}`);
  const data = await _fetch(`/search/query`, {query: name});
  if (data.type && data.type !== 'success') {
    throw new BattlelogFetchError('unknown error');
  }
  if (data.data && data.data.length === 0) {
    throw new BattlelogFetchError(`persona ${name} not found`);
  }

  const personas = _.filter(data.data, {
    personaName: name,
    namespace: 'cem_ea_id', // TODO: peasantry
  });
  if (personas.length === 0) {
    throw new BattlelogFetchError(`persona ${name} not found`);
  }
  if (personas.length > 1) {
    winston.warn(`multiple matching personas found:`, personas);
    // TODO: apply some heuristics to find the right persona
  }

  // sole reason for doing a second fetch is that the search results are missing
  // the clan tags, otherwise it isn't needed
  return getPersona(personas[0].personaId);
}
