import Redis from 'ioredis';
import { HuddleParser } from './HuddleParser';

const redis = new Redis(); // uses defaults unless given configuration object
async function run() {
  const parser = new HuddleParser(process.env.HUDDLE_ROOT, redis);
  await parser.getRootFolders();
  await parser.populateRootFolders();
}

// run();

redis.get('folder:root').then(d => {
  const root = JSON.parse(d);
  console.log(root);
});