import cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import Redis from 'ioredis';

const delay = (time: number) => new Promise(resolve => setTimeout(resolve, time));
const urlForFolder = (folderNumber: string) => `${ process.env.HUDDLE_ROOT }#/folder/${ folderNumber }/list`;

type File = {
  name: string;
  url: string;
  rootFolderId: string;
}

type Folder = {
  name: string;
  url: string;
  id: string;
  subfolders: Folder[];
  files: File[];
  rootFolderId: string;
}

type HuddleInstance = {
  rootFolder: Folder;
  baseUrl: string;
}

export class HuddleParser {
  
  huddle: HuddleInstance;
  private page: puppeteer.Page;
  private browser: puppeteer.Browser = null;
  private redis: Redis.Redis;
  
  constructor(baseUrl: string, redis: Redis.Redis) {
    this.redis = redis;
    this.huddle = {
      baseUrl,
      rootFolder: {
        name: 'root',
        id: 'root',
        url: urlForFolder('root'),
        rootFolderId: '/',
        subfolders: [],
        files: [],
      },
    };
  }
  
  async visit(url: string) {
    this.browser = this.browser || await puppeteer.launch({ headless: false });
    this.page = this.page || await this.browser.newPage();
    await this.page.goto(url);
    await this.page.waitForSelector('[data-part="header"]', { visible: true });
    const currentUrl = await this.page.url();
    if (currentUrl.startsWith('https://login.huddle.net'))
      await this.logIn();
  }
  
  async logIn() {
    const usernameSel = 'input#userIdentifierField';
    const buttonSel = '[data-automation="continue-button"]';
    const passwordSel = 'input#passwordField';
    
    // load the page
    const { page } = this;
    
    // enter username and continue.
    await page.waitForSelector(usernameSel, { visible: true });
    await delay(500);
    await page.type(usernameSel, process.env.HUDDLE_USERNAME);
    await page.click(buttonSel);
  
    // enter password and continue
    await page.waitForSelector(passwordSel, { visible: true });
    await delay(500);
    await page.type(passwordSel, process.env.HUDDLE_PASSWORD);
    await page.click(buttonSel);
    await page.waitForSelector('#list-search', { visible: true });
  }
  
  async getRootFolders() {
    await this.getFolderContents(this.huddle.rootFolder, false);
  }
  
  async populateRootFolders() {
  
  }
  
  async getFolderContents(folder: Folder, recursive = true) {
    const { id, rootFolderId } = folder;
    
    // get the html for the folder list page if we don't already have it
    const key = 'folder-html:' + id;
    let folderHtml = await this.redis.get(key);
    if (!folderHtml) {
      await this.visit(urlForFolder(id));
      folderHtml = await this.page.content();
      await this.redis.set(key, folderHtml);
    }
    
    // get folders from list page
    const $ = cheerio.load(folderHtml);
    const folderLinks = $('a.files-list__label');
    
    // populate subfolders
    folderLinks.each((i, link) => {
      const folderName = link.firstChild.data;
      const folderUrl = link.attribs.href;
      
      const newFolder: Folder = {
        // move leading number to the end, in parens
        // delete those parens if they're empty.
        name: folderName.replace(/([0-9]*)\s(.*)/, '$2 ($1)').replace(' ()', ''),
        url: folderUrl,
        id: folderUrl.match(/folder\/([0-9]*)\/list/)[1],
        rootFolderId,
        files: [],
        subfolders: [],
      };
      
      if (Object.values(newFolder).some(v => !v))
        throw new Error('There was a problem parsing the folder: ' + JSON.stringify(newFolder, null, 2));
      
      folder.subfolders.push(newFolder);
    });
    console.log(folder);
  }
}

