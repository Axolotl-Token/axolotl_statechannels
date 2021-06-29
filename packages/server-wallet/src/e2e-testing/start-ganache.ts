import yargs from 'yargs/yargs';
import {hideBin} from 'yargs/helpers';
import {TEST_ACCOUNTS} from '@statechannels/devtools';
import {writeFile} from 'jsonfile';
import ganache from 'ganache-core';
import {ethers} from 'ethers';
import {waitUntilUsed} from 'tcp-port-used';

import {deploy} from '../../deployment/deploy';
setupGanache();

async function setupGanache() {
  const commandArguments = await yargs(hideBin(process.argv))
    .option('port', {
      alias: 'p',

      default: 8545,
      describe: 'port for the ganache server to run on',
    })
    .option('miningInterval', {
      alias: 'mi',
      description: 'The duration(in ms) for how often a block should be mined.',
      default: 500,
    })
    .option('chainId', {alias: 'c', description: 'The chain id to use', default: 9001})
    .option('artifactFile', {
      alias: 'af',
      description: 'The file to write the artifacts to',
      default: 'temp/contract_artifacts.json',
    }).argv;
  // eslint-disable-next-line no-process-env
  process.env.GANACHE_PORT = commandArguments.port.toString();
  // ganache core exports a very permissive object[] type for accounts
  // it should be {balance: HexString, secretKey: string}[]
  const serverOptions: ganache.IServerOptions = {
    network_id: commandArguments.chainId,
    networkId: commandArguments.chainId,

    port: commandArguments.port,

    accounts: TEST_ACCOUNTS.map(a => ({
      balance: ethers.utils.parseEther('1000000').toHexString(),
      secretKey: a.privateKey,
    })),
    gasLimit: 10_000_000,
    gasPrice: '0x1',
    verbose: false,
  };
  // These seem to be needed to get ganache to use the correct chain id
  const workaroundOptions = {
    _chainId: commandArguments.chainId,
    _chainIdRpc: commandArguments.chainId,
  };

  const server = ganache.server({...serverOptions, ...workaroundOptions});
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  server.listen(commandArguments.port, () => {});

  await waitUntilUsed(commandArguments.port, 500, 10_000);

  // While ganache supports time based mining it disables auto mining after contract calls
  // By sending the mine instructions ourselves we get the best of both worlds
  setInterval(() => {
    const payload = {id: Date.now(), jsonrpc: '2.0', method: 'evm_mine', params: []};

    server.provider.send(payload, (err, _result) => {
      if (err) {
        throw err;
      }
    });
  }, commandArguments.miningInterval);
  console.log(`Ganche started on port ${commandArguments.port}`);
  const endpoint = `http://localhost:${commandArguments.port}`;
  const deployResults = await deploy(endpoint);
  await writeFile(commandArguments.artifactFile, deployResults);

  console.log(`Contract artifacts written to ${commandArguments.artifactFile}`);
}
