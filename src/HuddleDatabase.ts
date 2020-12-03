import { Folder, HuddleInstance, SerializableFolder } from './types';
import Redis from 'ioredis';

export default class HuddleDatabase {
  public huddle: HuddleInstance;
  private foldersByName: Record<string, string> = {};
  
  constructor(private redis: Redis.Redis) {}
  
  async getCurrent() {
    const data = await this.redis.get('folder-object:root');
    this.huddle = { rootFolder: JSON.parse(data) as Folder };
  }
  
  async execForEachFolder(fn: (folder: SerializableFolder) => Promise<void>) {
    const allFolderKeys = await this.redis.keys('folder-info*');
    for (const key of allFolderKeys) {
      // const id = key.split(':').pop();
      const info = await this.redis.hgetall(key) as unknown;
      await fn(info as SerializableFolder);
    }
  }
  
  async createFolderTable() {
    await this.execForEachFolder(async folder => {
      this.foldersByName[folder.id] = folder.name;
    });
  }
  
  async createTSV() {
    const { redis } = this;
    const baseUrl = process.env.HUDDLE_ROOT;
    
    const header = ['Name', 'Root Folder'].join('\t');
    const allData: string[] = [header];
    
    const allFolderKeys = await redis.keys('folder-info*');
    // create rows for each folder
    for (const key of allFolderKeys) {
      const id = key.split(':').pop();
      const _info = await redis.hgetall(id) as unknown;
      const info = _info as SerializableFolder;
      const url = baseUrl + info.url;
      const row = [
        `<a href="${ url }">${ info.name }`
      ];
    }
  }
  
  async storeIndivObjects(folder: Folder, evenIfExists = false) {
    const { rootFolderId, name, id, subfolders, files, url } = folder;
    
    // store basic info for the folder
    const serializedFolder = { name, id, rootFolderId, url };
    const folderKey = `folder-info:${ id }`;
    const folderExists = await this.redis.exists(folderKey);
    
    if (!folderExists || evenIfExists) {
      await this.redis.hmset(folderKey, serializedFolder);
      console.log('stored', folderKey);
    }
    
    // store info for each file in the folder
    for (const file of files) {
      const id = file.url.split('#/').pop();
      if (!Number(id))
        throw new Error('Error getting number id from url: ' + file.url);
      
      const fileKey = `file:${ id }`;
      const fileExists = await this.redis.exists(fileKey);
      
      if (!fileExists || evenIfExists) {
        await this.redis.hmset(fileKey, file);
        console.log('stored', fileKey);
      }
    }
    
    for (const subfolder of subfolders) {
      await this.storeIndivObjects(subfolder);
    }
  }
}