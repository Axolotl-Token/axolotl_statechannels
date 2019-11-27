import { take, fork } from 'redux-saga/effects';
import { buffers, eventChannel } from 'redux-saga';
import { reduxSagaFirebase } from '../../gateways/firebase';
import { MessageQueuedNotification } from '../../utils/channel-client';
import { RPSChannelClient } from '../../utils/rps-channel-client';

export function* messageQueuedListener() {
  const rpsChannelClient = new RPSChannelClient();

  const subscribe = emit => rpsChannelClient.onMessageQueued(emit);
  const channel = eventChannel(subscribe, buffers.fixed(10));

  while (true) {
    const notification: MessageQueuedNotification = yield take(channel);
    const to = notification.params.recipient;
    yield fork(
      reduxSagaFirebase.database.create,
      `/messages/${to.toLowerCase()}`,
      sanitizeMessageForFirebase(notification.params)
    );
  }
}

function sanitizeMessageForFirebase(message) {
  return JSON.parse(JSON.stringify(message));
}
