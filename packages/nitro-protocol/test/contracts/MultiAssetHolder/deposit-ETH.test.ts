import {expectRevert} from '@statechannels/devtools';
import {Wallet, BigNumber, ethers} from 'ethers';
const {parseUnits} = ethers.utils;

import {Channel, getChannelId} from '../../../src/contract/channel';
import {
  getRandomNonce,
  getTestProvider,
  MAGIC_ADDRESS_INDICATING_ETH,
  setupContract,
} from '../../test-helpers';
import {TESTNitroAdjudicator} from '../../../typechain/TESTNitroAdjudicator';
// eslint-disable-next-line import/order
import TESTNitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
const testNitroAdjudicator = (setupContract(
  getTestProvider(),
  TESTNitroAdjudicatorArtifact,
  process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
) as unknown) as TESTNitroAdjudicator;

const chainId = process.env.CHAIN_NETWORK_ID;
const participants = [];

// Populate destinations array
for (let i = 0; i < 3; i++) {
  participants[i] = Wallet.createRandom().address;
}

const description0 = 'Deposits ETH (msg.value = amount , expectedHeld = 0)';
const description1 = 'Reverts deposit of ETH (msg.value = amount, expectedHeld > holdings)';
const description2 = 'Deposits ETH (msg.value = amount, expectedHeld + amount < holdings)';
const description3 =
  'Deposits ETH (msg.value = amount,  amount < holdings < amount + expectedHeld)';

// Amounts are valueString represenationa of wei
describe('deposit', () => {
  let channelNonce = getRandomNonce('deposit');
  afterEach(() => {
    channelNonce++;
  });
  it.each`
    description     | held   | expectedHeld | amount | msgValue | heldAfterString | reasonString
    ${description0} | ${'0'} | ${'0'}       | ${'1'} | ${'1'}   | ${'1'}          | ${undefined}
    ${description1} | ${'0'} | ${'1'}       | ${'2'} | ${'2'}   | ${'0'}          | ${'holdings < expectedHeld'}
    ${description2} | ${'3'} | ${'1'}       | ${'1'} | ${'1'}   | ${'3'}          | ${'holdings already sufficient'}
    ${description3} | ${'3'} | ${'2'}       | ${'2'} | ${'2'}   | ${'4'}          | ${undefined}
  `(
    '$description',
    async ({held, expectedHeld, amount, msgValue, reasonString, heldAfterString}) => {
      held = parseUnits(held, 'wei');
      expectedHeld = parseUnits(expectedHeld, 'wei');
      amount = parseUnits(amount, 'wei');
      msgValue = parseUnits(msgValue, 'wei');
      const heldAfter = parseUnits(heldAfterString, 'wei');

      const destinationChannel: Channel = {chainId, channelNonce, participants};
      const destination = getChannelId(destinationChannel);

      if (held > 0) {
        // Set holdings by depositing in the 'safest' way
        const tx0 = testNitroAdjudicator.deposit(
          MAGIC_ADDRESS_INDICATING_ETH,
          destination,
          '0x00',
          held,
          {
            value: held,
          }
        );
        const {events} = await (await tx0).wait();
        const depositedEvent = getDepositedEvent(events);

        expect(
          await testNitroAdjudicator.holdings(MAGIC_ADDRESS_INDICATING_ETH, destination)
        ).toEqual(held);
        expect(depositedEvent).toMatchObject({
          destination,
          amountDeposited: BigNumber.from(held),
          destinationHoldings: BigNumber.from(held),
        });
      }
      const tx = testNitroAdjudicator.deposit(
        MAGIC_ADDRESS_INDICATING_ETH,
        destination,
        expectedHeld,
        amount,
        {
          value: msgValue,
        }
      );

      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const {events} = await (await tx).wait();
        const event = getDepositedEvent(events);
        expect(event).toMatchObject({
          destination,
          amountDeposited: heldAfter.sub(held),
          destinationHoldings: heldAfter,
        });

        const allocatedAmount = await testNitroAdjudicator.holdings(
          MAGIC_ADDRESS_INDICATING_ETH,
          destination
        );
        await expect(allocatedAmount).toEqual(heldAfter);
      }
    }
  );
});

const getDepositedEvent = events => events.find(({event}) => event === 'Deposited').args;
