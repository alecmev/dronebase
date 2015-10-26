import _ from 'lodash';
import winston from 'winston';
import { EventEmitter } from 'events';

import store from './store';

const db = store('live');
let state = null;

class Live extends EventEmitter {
  isLive() {
    winston.debug(`live.isLive`);
    return !!state;
  }

  begin() {
    const prefix = `live.begin`;
    winston.debug(prefix);
    if (state) {
      throw new Error(`${prefix}; already live`);
    }

    state = {beganAt: Date.now()};
    this.emit('begin');
  }

  end() {
    const prefix = `live.end`;
    winston.debug(prefix);
    if (!state) {
      winston.warn(`${prefix}; already not live`);
      return;
    }

    state['endedAt'] = Date.now();
    db.insert(state);
    state = null;
    this.emit('end');
  }
}

export default new Live();
