import {IncomingEngineConfig} from '../config';

import {MultiThreadedEngine} from './multi-threaded-wallet';
import {EngineInterface} from './types';
import {SingleThreadedEngine} from './wallet';

/**
 * A single- or multi-threaded Nitro Engine
 *
 * @remarks
 * The number of threads is specified in the supplied {@link @statechannels/server-wallet#RequiredServerEngineConfig | configuration}.
 */
export abstract class Engine extends SingleThreadedEngine implements EngineInterface {
  static async create(
    engineConfig: IncomingEngineConfig
  ): Promise<SingleThreadedEngine | MultiThreadedEngine> {
    if (engineConfig?.workerThreadAmount && engineConfig.workerThreadAmount > 0) {
      return MultiThreadedEngine.create(engineConfig);
    } else {
      return SingleThreadedEngine.create(engineConfig);
    }
  }
}

export * from '../config';
export * from './types';
export {SingleThreadedEngine, MultiThreadedEngine};
