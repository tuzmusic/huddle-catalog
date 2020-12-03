import Redis from 'ioredis';
import { HuddleParser } from './HuddleParser';
import HuddleDatabase from './HuddleDatabase';

// eslint-disable-next-line prefer-const
let ALWAYS_FETCH = false;

const redis = new Redis(); // uses defaults unless given configuration object

async function parse() {
  
  // ALWAYS_FETCH = true;
  
  const parser = new HuddleParser(redis, 1000, ALWAYS_FETCH);
  await parser.getRootFolders();
  await parser.populateRootFolders();
}

const db = new HuddleDatabase(redis);
db.getCurrent()
  .then(() => db.createFolderTable())
  .then(() => console.log(db.huddle));

console.log(db.huddle);

// run().then(inspect);
// inspect()

