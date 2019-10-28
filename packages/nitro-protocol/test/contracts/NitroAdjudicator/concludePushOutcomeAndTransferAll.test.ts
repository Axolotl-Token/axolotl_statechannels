import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet} from 'ethers';
import {HashZero} from 'ethers/constants';
import {hexlify} from 'ethers/utils';
// @ts-ignore
import countingAppArtifact from '../../../build/contracts/CountingApp.json';
// @ts-ignore
import AssetHolderArtifact1 from '../../../build/contracts/TESTAssetHolder.json';
// @ts-ignore
import AssetHolderArtifact2 from '../../../build/contracts/TESTAssetHolder2.json';
// @ts-ignore
import NitroAdjudicatorArtifact from '../../../build/contracts/TESTNitroAdjudicator.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {hashChannelStorage} from '../../../src/contract/channel-storage';
import {AllocationAssetOutcome} from '../../../src/contract/outcome';
import {State} from '../../../src/contract/state';
import {concludePushOutcomeAndTransferAllArgs} from '../../../src/contract/transaction-creators/force-move';
import {
  assetTransferredEventsFromPayouts,
  checkMultipleAssetOutcomeHashes,
  checkMultipleHoldings,
  compileEventsFromLogs,
  computeOutcome,
  getNetworkMap,
  getTestProvider,
  OutcomeShortHand,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  resetMultipleHoldings,
  setupContracts,
  signStates,
} from '../../test-helpers';

const provider = getTestProvider();
let NitroAdjudicator: Contract;
let AssetHolder1: Contract;
let AssetHolder2: Contract;
let networkMap;
let networkId;
const chainId = '0x1234';
const participants = ['', '', ''];
const wallets = new Array(3);
const challengeDuration = 0x1000;

let appDefinition;

const addresses = {
  // channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
  ETH: undefined,
  TOK: undefined,
};

// populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}
beforeAll(async () => {
  networkMap = await getNetworkMap();
  NitroAdjudicator = await setupContracts(provider, NitroAdjudicatorArtifact);
  AssetHolder1 = await setupContracts(provider, AssetHolderArtifact1);
  AssetHolder2 = await setupContracts(provider, AssetHolderArtifact2);
  addresses.ETH = AssetHolder1.address;
  addresses.TOK = AssetHolder2.address;
  networkId = (await provider.getNetwork()).chainId;
  appDefinition = networkMap[networkId][countingAppArtifact.contractName]; // use a fixed appDefinition in all tests
});

const accepts1 = '1 Asset Types';
const accepts2 = '2 Asset Types';

const oneState = {
  whoSignedWhat: [0, 0, 0],
  appData: [HashZero],
};
const turnNumRecord = 5;
let channelNonce = 400;
describe('concludePushOutcomeAndTransferAll', () => {
  beforeEach(() => (channelNonce += 1));
  it.each`
    description | outcomeShortHand              | heldBefore                    | heldAfter                     | newOutcome | payouts                       | reasonString
    ${accepts1} | ${{ETH: {A: 1}}}              | ${{ETH: {c: 1}}}              | ${{ETH: {c: 0}}}              | ${{}}      | ${{ETH: {A: 1}}}              | ${undefined}
    ${accepts2} | ${{ETH: {A: 1}, TOK: {A: 2}}} | ${{ETH: {c: 1}, TOK: {c: 2}}} | ${{ETH: {c: 0}, TOK: {c: 0}}} | ${{}}      | ${{ETH: {A: 1}, TOK: {A: 2}}} | ${undefined}
  `(
    '$description', // for the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({
      outcomeShortHand,
      heldBefore,
      heldAfter,
      newOutcome,
      payouts,
      reasonString,
    }: {
      outcomeShortHand: OutcomeShortHand;
      initialChannelStorageHash;
      heldBefore: OutcomeShortHand;
      heldAfter: OutcomeShortHand;
      newOutcome: OutcomeShortHand;
      payouts: OutcomeShortHand;
      reasonString;
    }) => {
      const channel: Channel = {chainId, participants, channelNonce: hexlify(channelNonce)};
      const channelId = getChannelId(channel);
      addresses.c = channelId;
      const support = oneState;
      const {appData, whoSignedWhat} = support;
      const numStates = appData.length;
      const largestTurnNum = turnNumRecord + 1;
      const initialChannelStorageHash = HashZero;

      // transform input data (unpack addresses and BigNumberify amounts)
      [heldBefore, outcomeShortHand, newOutcome, heldAfter, payouts] = [
        heldBefore,
        outcomeShortHand,
        newOutcome,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses));

      // set holdings on multiple asset holders
      resetMultipleHoldings(heldBefore, [AssetHolder1, AssetHolder2]);

      // compute the outcome.
      const outcome: AllocationAssetOutcome[] = computeOutcome(outcomeShortHand);

      // construct states
      const states: State[] = [];
      for (let i = 1; i <= numStates; i++) {
        states.push({
          isFinal: true,
          channel,
          outcome,
          appDefinition,
          appData: appData[i - 1],
          challengeDuration,
          turnNum: largestTurnNum + i - numStates,
        });
      }

      // call public wrapper to set state (only works on test contract)
      await (await NitroAdjudicator.setChannelStorageHash(
        channelId,
        initialChannelStorageHash
      )).wait();
      expect(await NitroAdjudicator.channelStorageHashes(channelId)).toEqual(
        initialChannelStorageHash
      );

      // sign the states
      const sigs = await signStates(states, wallets, whoSignedWhat);

      // form transaction
      const tx = NitroAdjudicator.concludePushOutcomeAndTransferAll(
        ...concludePushOutcomeAndTransferAllArgs(states, sigs, whoSignedWhat)
      );

      // switch on overall test expectation
      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const receipt = await (await tx).wait();

        // compute expected ChannelStorageHash
        const blockTimestamp = (await provider.getBlock(receipt.blockNumber)).timestamp;
        const expectedChannelStorageHash = hashChannelStorage({
          turnNumRecord: 0,
          finalizesAt: blockTimestamp,
          outcome,
        });

        // check channelStorageHash against the expected value
        expect(await NitroAdjudicator.channelStorageHashes(channelId)).toEqual(
          expectedChannelStorageHash
        );

        // extract logs
        const {logs} = await (await tx).wait();

        // compile events from logs
        const events = compileEventsFromLogs(logs, [AssetHolder1, AssetHolder2, NitroAdjudicator]);

        // compile event expectations
        let expectedEvents = [];

        // add Conclude event to expectations
        expectedEvents.push({
          contract: NitroAdjudicator.address,
          name: 'Concluded',
          values: {channelId},
        });

        // add AssetTransferred events to expectations
        Object.keys(payouts).forEach(assetHolder => {
          expectedEvents = expectedEvents.concat(
            assetTransferredEventsFromPayouts(payouts[assetHolder], assetHolder)
          );
        });

        // check that each expectedEvent is contained as a subset of the properies of each *corresponding* event: i.e. the order matters!
        expect(events).toMatchObject(expectedEvents);

        // check new holdings on each AssetHolder
        checkMultipleHoldings(heldAfter, [AssetHolder1, AssetHolder2]);

        // check new assetOutcomeHash on each AssetHolder
        checkMultipleAssetOutcomeHashes(channelId, newOutcome, [AssetHolder1, AssetHolder2]);
      }
    }
  );
});
