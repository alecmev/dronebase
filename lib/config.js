import _ from 'lodash';
import fs from 'fs';
import yaml from 'js-yaml';

export function load(filename, defaults={
  log: {
    level: 'info',
  },
}) {
  let common;
  try {
    common = fs.readFileSync('./config/common.yml');
  } catch (e) {
    common = '';
  }

  return _.merge(
    defaults,
    yaml.safeLoad(common),
    yaml.safeLoad(fs.readFileSync('./config/' + filename + '.yml'))
  );
}
