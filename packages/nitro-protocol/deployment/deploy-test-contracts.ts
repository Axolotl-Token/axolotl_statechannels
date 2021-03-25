// NOTE: this script manages deploying contracts for testing purposes ONLY
// DO NOT USE THIS SCRIPT TO DEPLOY CONTRACTS TO PRODUCTION NETWORKS
import {fstat} from 'fs/promises';
import {writeSync, writeFileSync} from 'fs';

import {GanacheDeployer, ETHERLIME_ACCOUNTS} from '@statechannels/devtools';
import {ContractFactory, Wallet, utils} from 'ethers';

import {getTestProvider, setupContracts, writeGasConsumption} from '../test/test-helpers';
import countingAppArtifact from '../artifacts/contracts/CountingApp.sol/CountingApp.json';
import erc20AssetHolderArtifact from '../artifacts/contracts/test/TestErc20AssetHolder.sol/TestErc20AssetHolder.json';
import ethAssetHolderArtifact from '../artifacts/contracts/ETHAssetHolder.sol/ETHAssetHolder.json';
import nitroAdjudicatorArtifact from '../artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json';
import singleAssetPaymentsArtifact from '../artifacts/contracts/examples/SingleAssetPayments.sol/SingleAssetPayments.json';
import hashLockedSwapArtifact from '../artifacts/contracts/examples/HashLockedSwap.sol/HashLockedSwap.json';
import testAssetHolderArtifact from '../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';
import testForceMoveArtifact from '../artifacts/contracts/test/TESTForceMove.sol/TESTForceMove.json';
import testNitroAdjudicatorArtifact from '../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import tokenArtifact from '../artifacts/contracts/Token.sol/Token.json';
import trivialAppArtifact from '../artifacts/contracts/TrivialApp.sol/TrivialApp.json';
import adjudicatorFactoryArtifact from '../artifacts/contracts/examples/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import singleChannelAdjudicatorArtifact from '../artifacts/contracts/examples/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';

export async function deploy(): Promise<Record<string, string>> {
  const deployer = new GanacheDeployer(Number(process.env.GANACHE_PORT));

  const nitroAdjudicatorDeploymentGas = await deployer.etherlimeDeployer.estimateGas(
    nitroAdjudicatorArtifact as any
  );
  writeGasConsumption('NitroAdjudicator.gas.md', 'deployment', nitroAdjudicatorDeploymentGas);
  console.log(
    `\nDeploying NitroAdjudicator... (cost estimated to be ${nitroAdjudicatorDeploymentGas})\n`
  );
  const NITRO_ADJUDICATOR_ADDRESS = await deployer.deploy(nitroAdjudicatorArtifact as any);

  const COUNTING_APP_ADDRESS = await deployer.deploy(countingAppArtifact as any);
  const HASH_LOCK_ADDRESS = await deployer.deploy(hashLockedSwapArtifact as any);
  const SINGLE_ASSET_PAYMENT_ADDRESS = await deployer.deploy(singleAssetPaymentsArtifact as any);
  const TEST_NITRO_ADJUDICATOR_ADDRESS = await deployer.deploy(testNitroAdjudicatorArtifact as any);
  const TRIVIAL_APP_ADDRESS = await deployer.deploy(trivialAppArtifact as any);
  const TEST_FORCE_MOVE_ADDRESS = await deployer.deploy(testForceMoveArtifact as any);
  const TEST_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    testAssetHolderArtifact as any,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  const TEST_ASSET_HOLDER2_ADDRESS = await deployer.deploy(
    testAssetHolderArtifact as any,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );

  // for test purposes in this package, wire up the assetholders with the testNitroAdjudicator

  const TEST_TOKEN_ADDRESS = await deployer.deploy(
    tokenArtifact as any,
    {},
    new Wallet(ETHERLIME_ACCOUNTS[0].privateKey).address
  );
  const ETH_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    ethAssetHolderArtifact as any,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  const ETH_ASSET_HOLDER2_ADDRESS = await deployer.deploy(
    ethAssetHolderArtifact as any,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  const TEST_TOKEN_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    erc20AssetHolderArtifact as any,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS
  );
  const ADJUDICATOR_FACTORY_ADDRESS = await deployer.deploy(adjudicatorFactoryArtifact as any);

  // copypasted from hardhat-deploy
  function linkRawLibrary(bytecode: string, libraryName: string, libraryAddress: string): string {
    const address = libraryAddress.replace('0x', '');
    let encodedLibraryName;
    if (libraryName.startsWith('$') && libraryName.endsWith('$')) {
      encodedLibraryName = libraryName.slice(1, libraryName.length - 1);
    } else {
      encodedLibraryName = utils.solidityKeccak256(['string'], [libraryName]).slice(2, 36);
    }
    const pattern = new RegExp(`_+\\$${encodedLibraryName}\\$_+`, 'g');
    if (!pattern.exec(bytecode)) {
      throw new Error(
        `Can't link '${libraryName}' (${encodedLibraryName}) in \n----\n ${bytecode}\n----\n`
      );
    }
    return bytecode.replace(pattern, address);
  }

  const singleChannelAdjudicatorArtifactReplaced = {...singleChannelAdjudicatorArtifact};
  singleChannelAdjudicatorArtifactReplaced.bytecode = linkRawLibrary(
    singleChannelAdjudicatorArtifact.bytecode,
    '$6eb8f1fbabd8edee7028b3a94009ba20a9$',
    ADJUDICATOR_FACTORY_ADDRESS
  );

  // we used the placeholder manually
  // https://docs.soliditylang.org/en/v0.8.0/contracts.html#libraries

  const SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS = await deployer.deploy(
    singleChannelAdjudicatorArtifactReplaced as any
  );

  console.log('deployed master');

  const provider = getTestProvider();

  console.log('rdfas');

  const AdjudicatorFactory = await setupContracts(
    provider,
    adjudicatorFactoryArtifact,
    ADJUDICATOR_FACTORY_ADDRESS
  );

  console.log('setupcontracts factory');

  await (await AdjudicatorFactory.setup(SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS)).wait();

  console.log('factory.setup');

  return {
    NITRO_ADJUDICATOR_ADDRESS,
    COUNTING_APP_ADDRESS,
    HASH_LOCK_ADDRESS,
    SINGLE_ASSET_PAYMENT_ADDRESS,
    TRIVIAL_APP_ADDRESS,
    TEST_FORCE_MOVE_ADDRESS,
    TEST_NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS,
    ETH_ASSET_HOLDER_ADDRESS,
    ETH_ASSET_HOLDER2_ADDRESS,
    TEST_TOKEN_ASSET_HOLDER_ADDRESS,
    TEST_ASSET_HOLDER_ADDRESS,
    TEST_ASSET_HOLDER2_ADDRESS,
    // SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS,
    ADJUDICATOR_FACTORY_ADDRESS,
  };
}
