import {ChannelResult, Message, ChannelClientInterface} from '@statechannels/channel-client';
import {bigNumberify} from 'ethers/utils';
import {FakeChannelProvider} from '@statechannels/channel-client';
import {ChannelClient} from '@statechannels/channel-client';
import React from 'react';
import {ChannelStatus} from '@statechannels/client-api-schema';

export interface ChannelState {
  channelId: string;
  turnNum: string;
  status: ChannelStatus;
  challengeExpirationTime;
  proposer: string;
  acceptor: string;
  proposerOutcomeAddress: string;
  acceptorOutcomeAddress: string;
  proposerBalance: string;
  acceptorBalance: string;
}

// This class wraps the channel client converting the
// request/response formats to those used in the app

if (process.env.REACT_APP_FAKE_CHANNEL_PROVIDER === 'true') {
  window.channelProvider = new FakeChannelProvider();
} else {
  // TODO: Replace with injection via other means than direct app import
  // NOTE: This adds `channelProvider` to the `Window` object
  require('@statechannels/channel-provider');
}

// TODO: Put inside better place than here where app can handle error case
window.channelProvider.enable(process.env.REACT_APP_WALLET_URL);
export interface PaymentChannelClientInterface {
  mySigningAddress?: string;
  myEthereumSelectedAddress?: string; // this state can be inspected to infer whether we need to get the user to "Connect With MetaMask" or not.
  channelCache: Record<string, ChannelState>;
  myAddress: string;
  createChannel(
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  ): Promise<ChannelState>;
  getAddress(): Promise<string>;
  getEthereumSelectedAddress(): Promise<string>;
  onMessageQueued(callback: (message: Message) => void);
  onChannelUpdated(web3tCallback: (channelState: ChannelState) => any);
  onChannelProposed(web3tCallback: (channelState: ChannelState) => any);
  joinChannel(channelId: string);
  closeChannel(channelId: string): Promise<ChannelState>;
  challengeChannel(channelId: string): Promise<ChannelState>;
  updateChannel(
    channelId: string,
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  );
  makePayment(channelId: string, amount: string);
  acceptPayment(channelState: ChannelState);
  isPaymentToMe(channelState: ChannelState): boolean;
  pushMessage(message: Message<ChannelResult>);
  approveBudgetAndFund(
    playerAmount: string,
    hubAmount: string,
    playerDestinationAddress: string,
    hubAddress: string,
    hubDestinationAddress: string
  );
}

// This Client targets at _unidirectional_, single asset (ETH) payment channel running on Nitro protocol
export class PaymentChannelClient implements PaymentChannelClientInterface {
  mySigningAddress?: string;
  myEthereumSelectedAddress?: string; // this state can be inspected to infer whether we need to get the user to "Connect With MetaMask" or not.
  channelCache: Record<string, ChannelState> = {};
  myAddress: string;
  constructor(private readonly channelClient: ChannelClientInterface) {}
  async createChannel(
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  ): Promise<ChannelState> {
    const participants = formatParticipants(
      proposer,
      acceptor,
      proposerOutcomeAddress,
      acceptorOutcomeAddress
    );
    const allocations = formatAllocations(
      proposerOutcomeAddress,
      acceptorOutcomeAddress,
      proposerBalance,
      acceptorBalance
    );
    const appDefinition = '0x0'; // TODO SingleAssetPayments address

    const channelResult = await this.channelClient.createChannel(
      participants,
      allocations,
      appDefinition,
      'appData unused'
    );
    this.cacheChannelState(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async getAddress() {
    this.mySigningAddress = await this.channelClient.getAddress();
    return this.mySigningAddress;
  }

  async getEthereumSelectedAddress() {
    this.myEthereumSelectedAddress = window.ethereum.selectedAddress;
    // this.myEthereumSelectedAddress = await this.channelClient.getEthereumSelectedAddress();
    return this.myEthereumSelectedAddress;
  }

  onMessageQueued(callback: (message: Message) => void) {
    return this.channelClient.onMessageQueued(callback);
  }

  cacheChannelState(channelState: ChannelState) {
    this.channelCache = {...this.channelCache, [channelState.channelId]: channelState};
  }

  // Accepts an web3t-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  onChannelUpdated(web3tCallback: (channelState: ChannelState) => any) {
    function callback(channelResult: ChannelResult): any {
      web3tCallback(convertToChannelState(channelResult));
    }
    const unsubChannelUpdated = this.channelClient.onChannelUpdated(callback);
    return () => {
      unsubChannelUpdated();
    };
  }

  onChannelProposed(web3tCallback: (channelState: ChannelState) => any) {
    function callback(channelResult: ChannelResult): any {
      web3tCallback(convertToChannelState(channelResult));
    }
    const unsubChannelProposed = this.channelClient.onChannelProposed(callback);
    return () => {
      unsubChannelProposed();
    };
  }

  async joinChannel(channelId: string) {
    const channelResult = await this.channelClient.joinChannel(channelId);
    this.cacheChannelState(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async closeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.closeChannel(channelId);
    this.cacheChannelState(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async challengeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.challengeChannel(channelId);
    this.cacheChannelState(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async updateChannel(
    channelId: string,
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  ) {
    const allocations = formatAllocations(
      proposerOutcomeAddress,
      acceptorOutcomeAddress,
      proposerBalance,
      acceptorBalance
    );
    const participants = formatParticipants(
      proposer,
      acceptor,
      proposerOutcomeAddress,
      acceptorOutcomeAddress
    );

    // ignore return val for now and stub out response
    const channelResult = await this.channelClient.updateChannel(
      channelId,
      participants,
      allocations,
      'appData unused'
    );
    this.cacheChannelState(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  // acceptor may use this method to make payments (if they have sufficient funds)
  async makePayment(channelId: string, amount: string) {
    const {
      proposer,
      acceptor,
      proposerBalance,
      acceptorBalance,
      proposerOutcomeAddress,
      acceptorOutcomeAddress
    } = this.channelCache[channelId];
    if (bigNumberify(acceptorBalance).gte(amount)) {
      await this.updateChannel(
        channelId,
        proposer,
        acceptor,
        bigNumberify(proposerBalance)
          .add(amount)
          .toString(),
        bigNumberify(acceptorBalance)
          .sub(amount)
          .toString(),
        proposerOutcomeAddress,
        acceptorOutcomeAddress
      );
    }
  }
  // proposer may use this method to accept payments
  async acceptPayment(channelState: ChannelState) {
    const {
      channelId,
      proposer,
      acceptor,
      proposerBalance,
      acceptorBalance,
      proposerOutcomeAddress,
      acceptorOutcomeAddress
    } = channelState;
    await this.updateChannel(
      channelId,
      proposer,
      acceptor,
      proposerBalance,
      acceptorBalance,
      proposerOutcomeAddress,
      acceptorOutcomeAddress
    );
  }

  isPaymentToMe(channelState: ChannelState): boolean {
    // doesn't guarantee that my balance increased
    const myIndex = channelState.proposer ? 0 : 1;
    return channelState.status === 'running' && Number(channelState.turnNum) % 2 === myIndex;
  }

  async pushMessage(message: Message<ChannelResult>) {
    await this.channelClient.pushMessage(message);
    const channelResult: ChannelResult = message.data;
    this.cacheChannelState(convertToChannelState(channelResult));
  }

  async approveBudgetAndFund(
    playerAmount: string,
    hubAmount: string,
    playerDestinationAddress: string,
    hubAddress: string,
    hubDestinationAddress: string
  ) {
    await this.channelClient.approveBudgetAndFund(
      playerAmount,
      hubAmount,
      playerDestinationAddress,
      hubAddress,
      hubDestinationAddress
    );
  }
}

export const paymentChannelClient = new PaymentChannelClient(
  new ChannelClient(window.channelProvider)
);

export const ChannelContext = React.createContext(paymentChannelClient);

const convertToChannelState = (channelResult: ChannelResult): ChannelState => {
  const {
    turnNum,
    channelId,
    participants,
    allocations,
    challengeExpirationTime,
    status
  } = channelResult;
  return {
    channelId,
    turnNum: turnNum.toString(), // TODO: turnNum should be switched to a number (or be a string everywhere),
    status,
    challengeExpirationTime,
    proposer: participants[0].participantId,
    acceptor: participants[1].participantId,
    proposerOutcomeAddress: participants[0].destination,
    acceptorOutcomeAddress: participants[1].destination,
    proposerBalance: bigNumberify(allocations[0].allocationItems[0].amount).toString(),
    acceptorBalance: bigNumberify(allocations[0].allocationItems[1].amount).toString()
  };
};

const formatParticipants = (
  aAddress: string,
  bAddress: string,
  aOutcomeAddress: string = aAddress,
  bOutcomeAddress: string = bAddress
) => [
  {participantId: aAddress, signingAddress: aAddress, destination: aOutcomeAddress},
  {participantId: bAddress, signingAddress: bAddress, destination: bOutcomeAddress}
];

const formatAllocations = (aAddress: string, bAddress: string, aBal: string, bBal: string) => {
  return [
    {
      token: '0x0',
      allocationItems: [
        {destination: aAddress, amount: bigNumberify(aBal).toHexString()},
        {destination: bAddress, amount: bigNumberify(bBal).toHexString()}
      ]
    }
  ];
};

// Mocks

export class MockPaymentChannelClient implements PaymentChannelClientInterface {
  mySigningAddress?: string;
  myEthereumSelectedAddress?: string;
  channelCache: Record<string, ChannelState> = {};
  myAddress: string;
  constructor(private readonly channelClient: ChannelClientInterface) {}

  mockChannelState: ChannelState = {
    channelId: '0x0',
    turnNum: '0x0',
    status: 'running',
    challengeExpirationTime: '0x0',
    proposer: '0x0',
    acceptor: '0x0',
    proposerOutcomeAddress: '0x0',
    acceptorOutcomeAddress: '0x0',
    proposerBalance: '0x0',
    acceptorBalance: '0x0'
  };
  async createChannel(
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  ): Promise<ChannelState> {
    return this.mockChannelState;
  }
  async getAddress() {
    return '0x0';
  }
  async getEthereumSelectedAddress() {
    return '0x0';
  }
  onMessageQueued(callback: (message: Message) => void) {
    return () => {};
  }
  // Accepts an web3t-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  onChannelUpdated(web3tCallback: (channelState: ChannelState) => any) {
    return () => {};
  }
  onChannelProposed(web3tCallback: (channelState: ChannelState) => any) {
    return () => {};
  }
  async joinChannel(channelId: string) {
    return {};
  }
  async closeChannel(channelId: string): Promise<ChannelState> {
    return this.mockChannelState;
  }
  async challengeChannel(channelId: string): Promise<ChannelState> {
    return this.mockChannelState;
  }
  async updateChannel(
    channelId: string,
    proposer: string,
    acceptor: string,
    proposerBalance: string,
    acceptorBalance: string,
    proposerOutcomeAddress: string,
    acceptorOutcomeAddress: string
  ) {
    return {};
  }
  async makePayment(channelId: string, amount: string) {}
  async acceptPayment(channelState: ChannelState) {}
  isPaymentToMe(channelState: ChannelState): boolean {
    return false;
  }
  async pushMessage(message: Message<ChannelResult>) {}
  async approveBudgetAndFund(
    playerAmount: string,
    hubAmount: string,
    playerDestinationAddress: string,
    hubAddress: string,
    hubDestinationAddress: string
  ) {}
}
