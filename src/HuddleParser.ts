import cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import Redis from 'ioredis';

const delay = (time: number) => new Promise(resolve => setTimeout(resolve, time));

type File = {
  name: string;
  url: string;
}

type Folder = {
  name: string;
  url: string;
  subfolders: Folder[];
  files: File[];
}

export class HuddleParser {
  
  huddle: { folders: Folder[] } = { folders: [] };
  page: puppeteer.Page;
  browser: puppeteer.Browser = null;
  
  constructor(private redis: Redis.Redis) {}
  
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
  
  async getFolders() {
    // get the html for the root folder page if we don't already have it
    const key = 'folderIndexHtml';
    let folderIndexHtml = await this.redis.get(key);
    if (!folderIndexHtml) {
      await this.visit(process.env.HUDDLE_ROOT + '#/folder/root/list');
      folderIndexHtml = await this.page.content();
      await this.redis.set(key, folderIndexHtml);
    }
    
    // get folders from index page
    const $ = cheerio.load(folderIndexHtml);
    const folderLinks = $('a.files-list__label');
    
    // populate huddle.folders with names and urls
    folderLinks.each((i, link) => {
      const folderName = link.firstChild.data;
      const folderUrl = link.attribs.href;
      this.huddle.folders.push({
        // move leading number to the end, in parens
        // delete those parens if they're empty.
        name: folderName.replace(/([0-9]*)\s(.*)/, '$2 ($1)').replace(' ()', ''),
        url: folderUrl,
        files: [],
        subfolders: [],
      });
    });
    console.log(this.huddle.folders);
  }
  
  async getFolderContents(folder: Folder) {
    // from the folder page, get the files and subfolders.
    // go through each subfolder recursively
  }
}