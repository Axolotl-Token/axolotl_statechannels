import {
  BN,
  calculateChannelId,
  checkThat,
  isSimpleEthAllocation,
  Objective,
  SignedState,
  Uint256,
  Zero
} from '@statechannels/wallet-core';
import _, {Dictionary} from 'lodash';

import {ChannelStoreEntry} from './store/channel-store-entry';
import {logger} from './logger';
import {Store} from './store';
import {ChainWatcher, ChannelChainInfo} from './chain';

export type Message = {
  objectives: Objective[];
  signedStates: SignedState[];
};
type Response = Message & {deposit?: boolean};

type Funding = 'DEPOSITED' | undefined;
type OnNewMessage = (message: Message) => void;

type DepositInfo = {
  depositAt: Uint256;
  myDeposit: Uint256;
  totalAfterDeposit: Uint256;
  fundedAt: Uint256;
};

export class BrowserWallet {
  private constructor(
    private onNewMessage: OnNewMessage,
    private chain = new ChainWatcher(),
    public store = new Store(chain),
    private registeredChannels = new Set<string>(),
    private channelFundingAmount: Dictionary<Uint256> = {},
    private channelFundingStatus: Dictionary<Funding> = {}
  ) {}

  private async init(): Promise<BrowserWallet> {
    await this.store.initialize();
    return this;
  }

  static async create(onNewMessage: OnNewMessage): Promise<BrowserWallet> {
    return new BrowserWallet(onNewMessage).init();
  }

  async incomingMessage(payload: Message): Promise<Message> {
    let response: Message = {
      objectives: [],
      signedStates: []
    };
    // Store any new objectives
    const payloadObjective = payload.objectives?.[0];
    if (!payloadObjective) {
      logger.info('No incoming objectives');
    } else {
      await this.store.addObjective(payloadObjective);
    }

    // Store any new states
    const payloadState = payload.signedStates?.[0];
    if (!payloadState) {
      logger.info('No incoming states');
    } else {
      await this.store.addState(payloadState);
      const channelId = calculateChannelId(payloadState);
      if (!this.registeredChannels.has(channelId)) {
        this.chain.chainUpdatedFeed(channelId).subscribe({
          next: chainInfo => this.onFundingUpdate(channelId, chainInfo)
        });
      }
    }

    for (const objective of this.store.objectives) {
      switch (objective.type) {
        case 'OpenChannel': {
          response = await this.onOpenChannelObjective(objective.data.targetChannelId);
          break;
        }
        default:
          throw new Error('Objective not supported');
      }
    }
    return response;
  }

  async onOpenChannelObjective(channelId: string): Promise<Message> {
    const channel = await this.store.getEntry(channelId);
    const pk = await this.store.getPrivateKey(await this.store.getAddress());
    const depositInfo = await this.getDepositInfo(channelId);

    const response = this.crankOpenChannelObjective(
      channel,
      this.channelFundingAmount[channelId],
      this.channelFundingStatus[channelId],
      depositInfo,
      pk
    );
    if (response.deposit) {
      this.channelFundingStatus[channelId] = 'DEPOSITED';
      // TODO: remove this hardcoding
      await this.chain.deposit(
        channel.channelId,
        this.channelFundingAmount[channelId],
        depositInfo.myDeposit
      );
    }
    if (response.signedStates[0]) {
      await this.store.addState(response.signedStates[0]);
      this.onNewMessage(response);
    }
    return response;
  }

  crankOpenChannelObjective(
    channel: ChannelStoreEntry,
    fundingAmount: Uint256,
    fundingStatus: Funding,
    depositInfo: DepositInfo,
    pk: string
  ): Response {
    const response: Response = {
      objectives: [],
      signedStates: []
    };
    const {latestState} = channel;
    // Prefund state
    if (latestState.turnNum === 0 && !channel.isSupportedByMe) {
      const newState = channel.signAndAdd(latestState, pk);
      response.signedStates = [newState];
      return response;
    }

    // TODO: remove this hardcoding
    if (
      BN.gte(fundingAmount, depositInfo.depositAt) &&
      BN.lt(fundingAmount, depositInfo.totalAfterDeposit) &&
      fundingStatus !== 'DEPOSITED'
    ) {
      response.deposit = true;
      return response;
    }
    if (
      BN.gte(fundingAmount, depositInfo.fundedAt) &&
      latestState.turnNum === 3 &&
      channel.latestSignedByMe.turnNum === 0
    ) {
      const newState = channel.signAndAdd(latestState, pk);
      response.signedStates = [newState];
      return response;
    }

    return response;
  }

  async onFundingUpdate(channelId: string, channelChainInfo: ChannelChainInfo): Promise<void> {
    this.channelFundingAmount[channelId] = channelChainInfo.amount;
    await this.onOpenChannelObjective(channelId);
  }

  async getDepositInfo(channelId: string): Promise<DepositInfo> {
    const {latestState, myIndex} = await this.store.getEntry(channelId);
    const {allocationItems} = checkThat(latestState.outcome, isSimpleEthAllocation);

    const fundedAt = allocationItems.map(a => a.amount).reduce(BN.add);
    let depositAt = Zero;
    for (let i = 0; i < allocationItems.length; i++) {
      const {amount} = allocationItems[i];
      if (i !== myIndex) depositAt = BN.add(depositAt, amount);
      else {
        const totalAfterDeposit = BN.add(depositAt, amount);
        return {depositAt, myDeposit: amount, totalAfterDeposit, fundedAt};
      }
    }

    throw Error(`Could not find an allocation for participant id ${myIndex}`);
  }
}
