import {ContractArtifacts, createETHDepositTransaction} from '@statechannels/nitro-protocol';
import {BN, Uint256} from '@statechannels/wallet-core';
import {Contract, providers, Wallet} from 'ethers';
import {Observable, ReplaySubject} from 'rxjs';
import {filter, multicast, refCount} from 'rxjs/operators';

import {Address, Bytes32} from '../type-aliases';

export type SetFundingArg = {
  channelId: Bytes32;
  assetHolderAddress: Address;
  amount: Uint256;
};

type FundChannelArg = {
  channelId: Bytes32;
  assetHolderAddress: Address;
  expectedHeld: Uint256;
  amount: Uint256;
};

export interface ChainEventSubscriberInterface {
  setFunding(arg: SetFundingArg): void;
}

interface ChainEventEmitterInterface {
  registerChannel(
    channelId: Bytes32,
    assetHolders: Address[],
    listener: ChainEventSubscriberInterface
  ): void;
}

interface ChainModifierInterface {
  fundChannel(arg: FundChannelArg): Promise<providers.TransactionResponse>;
}

export class ChainService implements ChainModifierInterface, ChainEventEmitterInterface {
  private readonly ethWallet: Wallet;
  private provider: providers.JsonRpcProvider;
  private addressToObservable: Map<Address, Observable<SetFundingArg>> = new Map();

  constructor(provider: string, pk: string, pollingInterval?: number) {
    this.provider = new providers.JsonRpcProvider(provider);
    if (pollingInterval) this.provider.pollingInterval = pollingInterval;
    this.ethWallet = new Wallet(pk, new providers.JsonRpcProvider(provider));
  }

  // Only used for unit tests
  async destructor(): Promise<void> {
    this.provider.removeAllListeners();
    this.provider.polling = false;
  }

  // todo: only works with eth-asset-holder
  fundChannel(arg: FundChannelArg): Promise<providers.TransactionResponse> {
    //todo: add retries
    const transactionRequest = {
      ...createETHDepositTransaction(arg.channelId, arg.expectedHeld, arg.amount),
      to: arg.assetHolderAddress,
      value: arg.amount,
    };
    return this.ethWallet.sendTransaction({
      ...transactionRequest,
    });
  }

  registerChannel(
    channelId: Bytes32,
    assetHolders: Address[],
    subscriber: ChainEventSubscriberInterface
  ): void {
    assetHolders.map(async assetHolder => {
      let obs = this.addressToObservable.get(assetHolder);
      if (!obs) {
        obs = await this.createContractObservable(assetHolder, channelId);
        this.addressToObservable.set(assetHolder, obs);
      }
      obs
        .pipe(filter(event => event.channelId === channelId))
        // todo: subscriber method should be based on event type
        .subscribe({next: subscriber.setFunding});
    });
  }

  private createContractObservable(
    contractAddress: Address,
    channelId: Bytes32
  ): Observable<SetFundingArg> {
    const contract: Contract = new Contract(
      contractAddress,
      ContractArtifacts.EthAssetHolderArtifact.abi
    ).connect(this.provider);
    const obs = new Observable<SetFundingArg>(subscriber => {
      // todo: add other event types
      contract.on('Deposited', (destination, amountDeposited, destinationHoldings) =>
        subscriber.next({
          channelId: destination,
          assetHolderAddress: contractAddress,
          amount: BN.from(destinationHoldings),
        })
      );
    });
    const subj = new ReplaySubject<SetFundingArg>(1);
    const multicastObs = obs.pipe(multicast(subj), refCount());

    contract.holdings(channelId).then((holdings: string) => {
      subj.next({
        channelId,
        assetHolderAddress: contractAddress,
        amount: BN.from(holdings),
      });
    });

    return multicastObs;
  }
}