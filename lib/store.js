import Datastore from 'nedb';
import Promise from 'bluebird';

export default function store(name) {
  return Promise.promisifyAll(
    new Datastore({
      filename: 'data/' + name + '.db',
      autoload: true,
    })
  );
}
