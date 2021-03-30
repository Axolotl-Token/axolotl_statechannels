import {CreateChannelParams, Message} from '@statechannels/client-api-schema';
import _ from 'lodash';

import {MessageServiceInterface} from './message-service/types';
import {getMessages} from './message-service/utils';
import {WalletObjective} from './models/objective';
import {Engine} from './engine';

export const delay = async (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export type RetryOptions = {
  /**
   * The number of attempts to make.
   */
  numberOfAttempts: number;
  /**
   * The initial delay to use in milliseconds
   */
  initialDelay: number;

  /**
   * The multiple that the delay is multiplied by each time
   */
  multiple: number;
};
type EnsureResult = 'Complete' | EnsureObjectiveFailed;

export type EnsureObjectiveFailed = {
  type: 'EnsureObjectiveFailed';
  numberOfAttempts: number;
};

export type CreateChannelResult = {
  done: Promise<EnsureResult>;
  channelId: string;
};

const DEFAULTS: RetryOptions = {numberOfAttempts: 10, multiple: 2, initialDelay: 50};
export class Wallet {
  /**
   * Constructs a channel manager that will ensure objectives get accomplished by resending messages if needed.
   * @param engine The engine to use.
   * @param messageService  The message service to use.
   * @param retryOptions How often and for how long the channel manager should retry objectives.
   * @returns A channel manager.
   */
  public static async create(
    engine: Engine,
    messageService: MessageServiceInterface,
    retryOptions: Partial<RetryOptions> = DEFAULTS
  ): Promise<Wallet> {
    return new Wallet(engine, messageService, {...DEFAULTS, ...retryOptions});
  }
  private constructor(
    private _engine: Engine,
    private _messageService: MessageServiceInterface,
    private _retryOptions: RetryOptions
  ) {}

  /**
   Creates channels using the given parameters.
   * @param channelParameters
   * @returns
   */
  public async createChannels(
    channelParameters: CreateChannelParams[]
  ): Promise<CreateChannelResult[]> {
    return Promise.all(
      channelParameters.map(async p => {
        const createResult = await this._engine.createChannel(p);
        if (!createResult.newObjective) {
          throw new Error('Missing objective');
        }
        return {
          channelId: createResult.channelResult.channelId,

          done: this.ensureObjective(createResult.newObjective, getMessages(createResult)),
        };
      })
    );
  }

  /**
   * Ensures that the provided objectives get completed.
   * Will resend messages as required to ensure that the objectives get completed.
   * @param objectives The list of objectives to ensure get completed.
   * @param objectiveMessages The collection of outgoing messages related to the objective.
   * @returns A promise that resolves when all the objectives are completed
   */
  private async ensureObjective(
    objective: WalletObjective,
    objectiveMessages: Message[]
  ): Promise<EnsureResult> {
    let isComplete = false;

    const onObjectiveSucceeded = (o: WalletObjective) => {
      if (o.objectiveId === o.objectiveId) {
        isComplete = true;
        this._engine.removeListener('objectiveSucceeded', onObjectiveSucceeded);
      }
    };

    this._engine.on('objectiveSucceeded', onObjectiveSucceeded);

    // Now that we're listening for objective success we can now send messages
    // that might trigger progress on the objective
    await this._messageService.send(objectiveMessages);

    const {multiple, initialDelay, numberOfAttempts} = this._retryOptions;
    for (let i = 0; i < numberOfAttempts; i++) {
      if (isComplete) return 'Complete';
      const delayAmount = initialDelay * Math.pow(multiple, i);
      await delay(delayAmount);

      const {outbox} = await this._engine.syncObjectives([objective.objectiveId]);
      await this._messageService.send(getMessages(outbox));
    }

    return {numberOfAttempts: this._retryOptions.numberOfAttempts, type: 'EnsureObjectiveFailed'};
  }

  async destroy(): Promise<void> {
    return this._engine.destroy();
  }
}
