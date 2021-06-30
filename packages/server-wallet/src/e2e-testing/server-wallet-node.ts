import {CreateChannelParams, UpdateChannelParams} from '@statechannels/client-api-schema';
import express, {Express} from 'express';
import {post} from 'httpie';

import {WalletConfig} from '../config';
import {ObjectiveDoneResult, UpdateChannelResult, Wallet} from '../wallet';
import {SocketIOMessageService} from '../message-service/socket-io-message-service';
import {WalletObjective} from '../models/objective';
type RegisterJobRequest = {
  jobId: string;
  channelId: string;
};

type CreateChannelRequest = {
  type: 'CreateChannel';
  serverId: string;
  jobId: string;
  channelParams: CreateChannelParams;
};

type CloseChannelRequest = {
  serverId: string;
  type: 'CloseChannel';
  jobId: string;
};

type UpdateChannelRequest = {
  serverId: string;
  type: 'UpdateChannel';
  jobId: string;
  updateParams: UpdateChannelParams;
};
export type ServerOperationRequest =
  | CreateChannelRequest
  | CloseChannelRequest
  | UpdateChannelRequest;

export class ServerWalletNode {
  private approvedObjectives = new Map<string, WalletObjective>();
  private jobChannelMap = new Map<string, string>();

  private server: Express;
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
    this.server.post('/registerJobs', async (req, res) => {
      const requests: RegisterJobRequest[] = req.body;
      for (const request of requests) {
        this.jobChannelMap.set(request.jobId, request.channelId);
      }
      res.end();
    });
    this.server.post('/', async (req, res) => {
      const requests: ServerOperationRequest[] = req.body;
      for (const serverRequest of requests) {
        if (serverRequest.serverId === this.serverId) {
          const result = await this.handleWalletRequest(serverRequest);
          if (result.type !== 'Success') {
            res
              .status(500)
              .send(
                `ServerOperationRequest failed ${JSON.stringify(
                  serverRequest
                )} with wallet response ${JSON.stringify(result)}`
              )
              .end();
          }
        }
      }

      res.end();
    });
  }

  private async broadcastJobId(jobId: string, channelId: string): Promise<void> {
    for (const peerPort of this.peerPorts) {
      console.log(peerPort);
      await post(`http://localhost:${peerPort}/registerJobs`, {body: [{jobId, channelId}]});
    }
  }

  private async handleWalletRequest(
    request: ServerOperationRequest
  ): Promise<ObjectiveDoneResult | UpdateChannelResult> {
    const handlers: Record<
      ServerOperationRequest['type'],
      (req: any) => Promise<ObjectiveDoneResult>
    > = {
      CreateChannel: async (request: CreateChannelRequest) => {
        const [result] = await this.serverWallet.createChannels([request.channelParams]);
        this.jobChannelMap.set(request.jobId, result.channelId);
        await this.broadcastJobId(request.jobId, result.channelId);
        return result.done;
      },
      CloseChannel: async (request: CloseChannelRequest) => {
        const channelId = this.jobChannelMap.get(request.jobId);
        if (!channelId) throw new Error('No channel id found');
        const [result] = await this.serverWallet.closeChannels([channelId]);

        this.jobChannelMap.set(request.jobId, result.channelId);
        return result.done;
      },
      UpdateChannel: async (req: UpdateChannelRequest) => {
        const channelId = this.jobChannelMap.get(req.jobId);
        if (!channelId) throw new Error('No channel id found');
        const {allocations, appData} = req.updateParams;
        const result = await this.serverWallet.updateChannel(channelId, allocations, appData);

        this.jobChannelMap.set(req.jobId, result.channelId);
        return result;
      },
    };
    return handlers[request.type](request);
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
