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
}

export class HuddleParser {
  
  huddle: HuddleInstance = {
    rootFolder: {
      name: 'root',
      id: 'root',
      url: urlForFolder('root'),
      rootFolderId: '/',
      subfolders: [],
      files: [],
    },
  };
  
  private page: puppeteer.Page;
  private browser: puppeteer.Browser = null;
  private loggedIn = false;
  
  constructor(private redis: Redis.Redis, private fetchDelay = 0, private alwaysFetch = false) {}
  
  async visit(url: string) {
    this.browser = this.browser || await puppeteer.launch({ headless: false });
    this.page = this.page || await this.browser.newPage();
    await this.page.goto(url);
    await this.page.waitForSelector(this.loggedIn
      ? 'a[data-automation="file-name"]'
      : '[data-part="header"]', { visible: true });
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
    await page.waitForSelector(buttonSel, { visible: true });
    await page.click(buttonSel);
  
    // enter password and continue
    await page.waitForSelector(passwordSel, { visible: true });
    await delay(500);
    await page.type(passwordSel, process.env.HUDDLE_PASSWORD);
    await page.waitForSelector(buttonSel, { visible: true });
    await page.click(buttonSel);
    await page.waitForSelector('#list-search', { visible: true });
  
    this.loggedIn = true;
  }
  
  async getRootFolders() {
    await this.getFolderContents(this.huddle.rootFolder, false);
  }
  
  async populateRootFolders() {
    for (const folder of this.huddle.rootFolder.subfolders) {
      await this.getFolderContents(folder);
    }
  
    const data = JSON.stringify(this.huddle.rootFolder);
    await this.redis.set('folder:root', data);
    await this.redis.set('history:folder:root:' + new Date().toISOString(), data);
  
    // this doesn't seem to set different scores each time and just overwrites the existing element.
    // that's why we're covering our bases above.
    await this.redis.zadd('history:folder:root', new Date().toISOString(), data);
  
    console.log('Done');
  }
  
  async getHtmlForFolder(folder: Folder): Promise<string> {
    
    // get the html for the folder list page if we don't already have it
    const { url, id, name } = folder;
    const key = 'folder-html:' + id;
    let folderHtml = await this.redis.get(key);
    
    console.log(folderHtml ? 'Parsing' : 'Getting', 'contents of', name, 'at', url);
    
    if (!folderHtml || this.alwaysFetch) {
      await this.visit(urlForFolder(id));
      await delay(this.fetchDelay);
      folderHtml = await this.page.content();
      await this.redis.set(key, folderHtml);
    }
    return folderHtml;
  }
  
  getFileInfoFromElement(link: cheerio.Element, rootFolder: Folder): File {
    const name = link.firstChild.data;
    const url = link.attribs.href;
    return { name, url, rootFolderId: rootFolder.id };
  }
  
  getFolderInfoFromElement(link: cheerio.Element, rootFolder: Folder): Folder {
    const folderName = link.firstChild.data;
    const folderUrl = link.attribs.href;
    
    const newFolder: Folder = {
      // move leading number to the end, in parens
      // delete those parens if they're empty.
      name: folderName.replace(/([0-9]*)\s(.*)/, '$2 ($1)').replace(' ()', ''),
      url: folderUrl,
      id: folderUrl.match(/folder\/([0-9]*)\/list/)[1],
      rootFolderId: rootFolder.id,
      files: [],
      subfolders: [],
    };
    
    if (Object.values(newFolder).some(v => !v))
      throw new Error('There was a problem parsing the folder: ' + JSON.stringify(newFolder, null, 2));
    
    return newFolder;
  }
  
  async getFolderContents(folder: Folder, recursive = true) {
    const folderHtml = await this.getHtmlForFolder(folder);
    const $ = cheerio.load(folderHtml);
    
    // get files
    const fileLinks = $('li.file > a[data-automation="file-name"]');
    fileLinks.each((i, link) => folder.files.push(this.getFileInfoFromElement(link, folder)));
    
    // populate subfolders
    // we need to go recursively through the subfolders, *asynchronously*
    // so we need to use a for loop not a forEach or cheerio.Element[].each
    const folderLinks = $('li.folder > a[data-automation="file-name"]');
    const folderEls: cheerio.Element[] = [];
    folderLinks.each((i, link) => folderEls.push(link));
    
    for (const link of folderEls) {
      const newFolder = this.getFolderInfoFromElement(link, folder);
      
      folder.subfolders.push(newFolder);
      
      // I suppose we could recur inside getFolderInfoFromElement
      // But that would have to get the folder's files too, and while
      // that would probably work fine, it's a little more confusing
      // than I'd like.
      if (recursive) await this.getFolderContents(newFolder);
    }
  }
}

