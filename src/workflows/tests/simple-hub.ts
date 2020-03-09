import {Message} from '../../store/types';
import {Observable, fromEvent} from 'rxjs';
import {EventEmitter} from 'eventemitter3';
import {signState} from '../../store/state-utils';
import {ethers} from 'ethers';

export class SimpleHub {
  constructor(
    private readonly privateKey: string,
    private readonly _eventEmitter = new EventEmitter()
  ) {}

  public get outboxFeed(): Observable<Message> {
    return fromEvent(this._eventEmitter, 'addToOutbox');
  }

  public async pushMessage({signedStates}: Message) {
    signedStates?.map(signedState => {
      const signature = signState(signedState, this.privateKey);
      const {signatures, participants} = signedState;
      const hubIdx = participants.findIndex(p => p.signingAddress === this.getAddress());
      signatures[hubIdx] = signature;

      this._eventEmitter.emit('addToOutbox', {
        signedStates: [{...signedState, signatures}],
        from: 'hub'
      });
    });
  }

  public getAddress() {
    return new ethers.Wallet(this.privateKey).address;
  }
}
