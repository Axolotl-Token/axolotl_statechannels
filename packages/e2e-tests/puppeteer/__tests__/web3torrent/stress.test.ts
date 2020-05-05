/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable jest/expect-expect */
import {Page, Browser} from 'puppeteer';
import {configureEnvVariables, getEnvBool} from '@statechannels/devtools';

import {
  setUpBrowser,
  waitAndOpenChannel,
  setupLogging,
  setupFakeWeb3,
  waitForNthState,
  waitForClosedState
} from '../../helpers';

import {
  uploadFile,
  prepareStubUploadFile,
  startDownload,
  cancelDownload
} from '../../scripts/web3torrent';
import {Dappeteer} from 'dappeteer';
import {USE_DAPPETEER, CLOSE_BROWSERS} from '../../constants';

configureEnvVariables();
const HEADLESS = getEnvBool('HEADLESS');
jest.setTimeout(HEADLESS ? 200_000 : 1_000_000);

const USES_VIRTUAL_FUNDING = true;

describe('One file, three leechers, one seeder', () => {
  const enum Label {
    A = 'A',
    B = 'B',
    C = 'C',
    D = 'D'
  }

  const leechers: Label[] = [Label.B, Label.C, Label.D];
  const labels: Label[] = leechers.concat([Label.A]);
  type Data<T> = Record<Label, T>;

  const assignEachLabel = <T>(data: Data<T>, cb: (label: Label) => any) =>
    Promise.all(labels.map(async label => (data[label] = await cb(label))));

  const forEach = async <T>(data: Data<T>, cb: (obj: T, label: Label) => any) =>
    await Promise.all(labels.map(async label => await cb(data[label], label)));

  const browsers: Data<{browser: Browser; metamask: Dappeteer}> = {} as Data<{
    browser: Browser;
    metamask: Dappeteer;
  }>;
  const tabs: Data<Page> = {} as Data<Page>;
  afterAll(
    async () => CLOSE_BROWSERS && (await forEach(browsers, async ({browser}) => browser.close()))
  );

  it('allows peers to start torrenting', async () => {
    console.log('Opening browsers');
    await assignEachLabel(browsers, async () => await setUpBrowser(HEADLESS, 0));

    console.log('Waiting on pages');
    await assignEachLabel(tabs, async label => (await browsers[label].browser.pages())[0]);

    console.log('Setting up logs');
    let i = 0;
    await forEach(tabs, async tab => {
      const idx = ++i;
      await setupLogging(tab, idx, 'stress', true);
      !USE_DAPPETEER && (await setupFakeWeb3(tab, idx));
    });

    console.log('Preparing stub file');
    const filePath = '/tmp/web3t-stub';
    prepareStubUploadFile(filePath, 1000000);

    console.log('A uploads the file');
    console.log('Going to URL');
    await tabs.A.goto('http://localhost:3000/upload', {waitUntil: 'load'});
    console.log('Uploading file');
    const file = await uploadFile(tabs.A, USES_VIRTUAL_FUNDING, browsers.A.metamask, filePath);

    console.log('B, C, D start downloading...');
    await Promise.all(
      leechers.map(async label => {
        const tab = tabs[label];
        const {metamask} = browsers[label];
        await startDownload(tab, file, USES_VIRTUAL_FUNDING, metamask);
      })
    );

    console.log('Waiting for open channels');
    await forEach(tabs, waitAndOpenChannel(USES_VIRTUAL_FUNDING));

    console.log('Downloading');
    await forEach(tabs, tab => waitForNthState(tab, 10));

    console.log('C cancels download');
    await cancelDownload(tabs.C);

    console.log('Waiting for channels to close');
    await forEach(tabs, waitForClosedState);
  });
});

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('Two files, three seeders, three leechers', () => {
  const enum Label {
    S1 = 'S1',
    S2 = 'S2',
    SL = 'SL',
    L1 = 'L1',
    L2 = 'L2'
  }
  const enum Files {
    F1 = 'File1',
    F2 = 'File2'
  }

  const seeders: Label[] = [Label.S1, Label.S2, Label.SL];
  const leechers: Label[] = [Label.SL, Label.L1, Label.L2];
  const peers = seeders.concat(leechers.slice(1));
  type Data<T> = Record<Label, T>;

  const assignEachLabel = <T>(data: Data<T>, cb: (label: Label) => any) =>
    Promise.all(peers.map(async label => (data[label] = await cb(label))));

  const forEach = async <T>(data: Data<T>, cb: (obj: T, label: Label) => any) =>
    await Promise.all(peers.map(async label => await cb(data[label], label)));

  const browsers: Data<{browser: Browser; metamask: Dappeteer}> = {} as Data<{
    browser: Browser;
    metamask: Dappeteer;
  }>;
  const tabs: Data<Page> = {} as Data<Page>;
  afterAll(async () => {
    if (HEADLESS) {
      await forEach(browsers, async ({browser}) => browser && (await browser.close()));
    }
  });

  it('allows peers to start torrenting', async () => {
    // 100ms sloMo avoids some undiagnosed race conditions

    console.log('Opening browsers');
    await assignEachLabel(browsers, () => setUpBrowser(HEADLESS, 100));

    console.log('Waiting on pages');
    await assignEachLabel(tabs, async label => (await browsers[label].browser.pages())[0]);

    const logPageOutput = (role: Label) => (msg: any) =>
      // use console.error so we can redirect STDERR to a file
      console.error(`${role}: `, msg.text());
    forEach(tabs, (tab, label) => tab.on('console', logPageOutput(label)));

    console.log('S1, SL upload the same file');
    const [file] = [Label.S1, Label.SL].map(async label => {
      const tab = tabs[label];
      const {metamask} = browsers[label];
      await tab.goto('http://localhost:3000/upload', {waitUntil: 'load'});
      return await uploadFile(tab, USES_VIRTUAL_FUNDING, metamask, Files.F1);
    });

    console.log('L1 starts downloading F1');
    await startDownload(tabs.L1, await file, USES_VIRTUAL_FUNDING, browsers.L1.metamask);

    console.log('S2 uploads F2');
    let file2: string;
    {
      const tab = tabs.S2;
      const {metamask} = browsers.S2;
      await tab.goto('http://localhost:3000/upload', {waitUntil: 'load'});
      [file2] = await uploadFile(tab, USES_VIRTUAL_FUNDING, metamask, Files.F1);
    }

    console.log('L2 starts downloading F2');
    await startDownload(tabs.L2, file2, USES_VIRTUAL_FUNDING, browsers.L2.metamask);
  });
});
