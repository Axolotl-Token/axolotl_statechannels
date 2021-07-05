import util from 'util';

import {CreateChannelParams, UpdateChannelParams} from '@statechannels/client-api-schema';
import express, {Express} from 'express';
import {get, post} from 'httpie';
import _ from 'lodash';
import chalk from 'chalk';
import Lock from 'async-lock';

import {WalletConfig} from '../config';
import {ObjectiveDoneResult, UpdateChannelResult, Wallet} from '../wallet';
import {SocketIOMessageService} from '../message-service/socket-io-message-service';
import {WalletObjective} from '../models/objective';
export type Job = Step[];
type CreateChannelStep = {
  type: 'CreateChannel';
  serverId: string;
  jobId: string;
  step: number;
  channelParams: CreateChannelParams;
};

type CloseChannelStep = {
  serverId: string;
  type: 'CloseChannel';
  jobId: string;
  step: number;
};

type UpdateChannelStep = {
  serverId: string;
  type: 'UpdateChannel';
  jobId: string;
  step: number;
  updateParams: UpdateChannelParams;
};
export type Step = CreateChannelStep | CloseChannelStep | UpdateChannelStep;

export class ServerWalletNode {
  private approvedObjectives = new Map<string, WalletObjective>();
  private jobQueue: Record<string, Job> = {};
  private jobToChannelMap: Map<string, string> = new Map<string, string>();
  private server: Express;
  private readonly lock = new Lock();

  private constructor(
    private serverWallet: Wallet,
    public port: number,
    private readonly serverId: string,
    private peerPorts: number[]
  ) {
    this.serverWallet.on('ObjectiveProposed', async o => {
      // TODO: The wallet should not be emitting proposed objectives multiple times
      if (!this.approvedObjectives.has(o.objectiveId)) {
        this.approvedObjectives.set(o.objectiveId, o);

        await this.serverWallet.approveObjectives([o.objectiveId]);
      }
    });
    this.server = express();
    this.server.use(express.json());

    this.server.post('/shareSteps', async (req, res) => {
      const requests: Step[] = req.body;
      await this.updateJobQueue(requests);
      res.end();
      await this.processJobs();
    });

    this.server.get('/reset', async (req, res) => {
      const jobIds = Object.keys(this.jobQueue);
      await this.lock.acquire(jobIds, async () => {
        this.jobQueue = {};
        this.jobToChannelMap.clear();
      });

      const onlySelf = req.query['onlySelf'];
      if (!onlySelf) {
        await this.resetPeers();
      }

      console.log(
        chalk.whiteBright('Job Ids have been reset. You may now use the same test file.')
      );
      res.end();
    });

    this.server.post('/jobStepCompleted', async (req, res) => {
      const step: Step & {channelId: string} = req.body;

      await this.lock.acquire(step.jobId, async () => {
        this.removeOldSteps(step.jobId, step.step);

        this.jobToChannelMap.set(step.jobId, step.channelId);
      });

      res.end();
      await this.processJobs();
    });
    this.server.post('/', async (req, res) => {
      const requests: Step[] = req.body;

      await this.updateJobQueue(requests);
      await this.shareStepsWithPeers(requests);
      res.end();
      await this.processJobs();
    });
  }

  private get queueIsEmpty(): boolean {
    for (const jobId of Object.keys(this.jobQueue)) {
      if (this.jobQueue[jobId].length > 0) return false;
    }
    return true;
  }

  private async shareStepsWithPeers(steps: Step[]) {
    for (const peerPort of this.peerPorts) {
      await post(`http://localhost:${peerPort}/shareSteps`, {body: steps});
    }
  }

  private async resetPeers() {
    for (const peerPort of this.peerPorts) {
      await get(`http://localhost:${peerPort}/reset?onlySelf=false`);
    }
  }

  private removeOldSteps(jobId: string, step: number): void {
    const existing = this.jobQueue[jobId] ?? [];
    this.jobQueue[jobId] = existing.filter(s => s.step > step);
  }
  private async updateJobQueue(steps: Step[]): Promise<void> {
    const byJobId = steps.reduce((obj: Record<string, Step[]>, s) => {
      const existing = obj[s.jobId] ?? [];
      obj[s.jobId] = existing.concat([s]);
      return obj;
    }, {});

    for (const jobId of Object.keys(byJobId)) {
      await this.lock.acquire(jobId, async () => {
        const existing = this.jobQueue[jobId] ?? [];
        this.jobQueue[jobId] = _.merge(existing, byJobId[jobId]).sort(
          (s1, s2) => s1.step - s2.step
        );
      });
    }
    console.log(chalk.yellow(`Updated job queue with ${steps.length} steps`));
  }

  private getChannelIdForJob(jobId: string): string {
    const entry = this.jobToChannelMap.get(jobId);
    if (!entry) {
      throw new Error(`No channel id for ${jobId}`);
    }
    return entry;
  }

  private async processJobs() {
    await Promise.all(
      Object.keys(this.jobQueue).map(jobId =>
        this.lock.acquire(jobId, async () => {
          while (
            this.jobQueue[jobId].length > 0 &&
            this.jobQueue[jobId][0].serverId === this.serverId
          ) {
            const currentStep = this.jobQueue[jobId][0];
            console.log(
              chalk.green(
                `Starting ${currentStep.type} step for job ${currentStep.jobId} with step ${currentStep.step}`
              )
            );
            const result = await this.handleStep(currentStep);

            if (result.type !== 'Success') {
              console.error(
                chalk.redBright(
                  `Step ${currentStep.step} for job ${
                    currentStep.jobId
                  } failed with result ${util.inspect(result)}`
                )
              );
              throw new Error(`Wallet returned ${result.type}`);
            }

            await this.removeOldSteps(jobId, currentStep.step);
            await this.broadcastJobProgress(currentStep, result.channelId);
            console.log(
              chalk.magenta(
                `Finished ${currentStep.type} step for job ${currentStep.jobId} with step ${currentStep.step}`
              )
            );
          }
        })
      )
    );
    if (this.queueIsEmpty) {
      console.log(chalk.greenBright('All jobs processed! SUCCESS'));
    }
  }
  private async broadcastJobProgress(step: Step, channelId: string): Promise<void> {
    for (const peerPort of this.peerPorts) {
      await post(`http://localhost:${peerPort}/jobStepCompleted`, {body: {...step, channelId}});
    }
  }

  private async handleStep(step: Step): Promise<ObjectiveDoneResult | UpdateChannelResult> {
    const handlers: Record<Step['type'], (req: any) => Promise<ObjectiveDoneResult>> = {
      CreateChannel: async (request: CreateChannelStep) => {
        const [result] = await this.serverWallet.createChannels([request.channelParams]);

        this.jobToChannelMap.set(request.jobId, result.channelId);
        return result.done;
      },
      CloseChannel: async (request: CloseChannelStep) => {
        const channelId = this.getChannelIdForJob(request.jobId);

        const [result] = await this.serverWallet.closeChannels([channelId]);

        return result.done;
      },
      UpdateChannel: async (req: UpdateChannelStep) => {
        const channelId = this.getChannelIdForJob(step.jobId);

        const {allocations, appData} = req.updateParams;
        const result = await this.serverWallet.updateChannel(channelId, allocations, appData);

        return result;
      },
    };
    return handlers[step.type](step);
  }

  public async destroy(): Promise<void> {
    this.server.removeAllListeners();
    await this.serverWallet.destroy();
  }

  public listen(): void {
    this.server.listen(this.port);
  }

  public async registerPeer(port: number): Promise<void> {
    (this.serverWallet.messageService as SocketIOMessageService).registerPeer(
      `http://localhost:${port}`
    );
  }
  public static async create(
    walletConfig: WalletConfig,
    messageServicePort: number,
    nodePort: number,
    serverId: string,
    peerPorts: number[]
  ): Promise<ServerWalletNode> {
    const messageServiceFactory = await SocketIOMessageService.createFactory(
      'localhost',
      messageServicePort
    );
    const serverWallet = await Wallet.create(walletConfig, messageServiceFactory);
    return new ServerWalletNode(serverWallet, nodePort, serverId, peerPorts);
  }
}
