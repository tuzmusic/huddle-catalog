import Redis from 'ioredis';
import { HuddleParser } from './HuddleParser';

let ALWAYS_FETCH = false;

const redis = new Redis(); // uses defaults unless given configuration object

async function run() {
  
  // ALWAYS_FETCH = true;
  
  const parser = new HuddleParser(redis, 1000, ALWAYS_FETCH);
  await parser.getRootFolders();
  await parser.populateRootFolders();
}

async function inspect() {
  const data = await redis.get('folder:root');
  const root = JSON.parse(data);
  console.log(root);
}

// run().then(inspect);
inspect()