import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { RealtimeService } from './realtime.service.js';
import { RADIO_EVENTS, RADIO_NAMESPACE } from './realtime.types.js';

/**
 * Public, read-only real-time feed for the radio player and the dashboard (/radio namespace).
 *
 * Clients receive the current now-playing and stream-status snapshots on connect, then every
 * change. There are deliberately no message handlers: nothing a client sends has any effect, so
 * no admin action, credential or internal value is reachable through this socket. The audio
 * itself never travels here; it stays on Liquidsoap -> Icecast. Allowed origins are enforced by
 * RadioIoAdapter (SOCKET_ALLOWED_ORIGINS).
 */
@WebSocketGateway({ namespace: RADIO_NAMESPACE })
export class RadioGateway
  implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>
{
  private readonly logger = new Logger(RadioGateway.name);
  private readonly connected = new Set<string>();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly realtime: RealtimeService) {}

  afterInit(namespace: Namespace): void {
    // One subscription for all clients; the namespace fans it out.
    this.unsubscribe.push(
      this.realtime.onNowPlaying((event) => namespace.emit(RADIO_EVENTS.nowPlaying, event)),
      this.realtime.onStreamStatus((event) => namespace.emit(RADIO_EVENTS.streamStatus, event)),
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    this.connected.add(client.id);
    this.realtime.setClientCount(this.connected.size);

    // Snapshots go to this client only, so it is correct from the first moment and after every
    // reconnect, without waiting for the next change.
    try {
      const nowPlaying = await this.realtime.getNowPlaying();
      if (nowPlaying && client.connected) client.emit(RADIO_EVENTS.nowPlaying, nowPlaying);
    } catch (error) {
      this.logger.warn(
        `Could not send the now-playing snapshot: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    if (client.connected) client.emit(RADIO_EVENTS.streamStatus, this.realtime.getStreamStatus());
  }

  handleDisconnect(client: Socket): void {
    this.connected.delete(client.id);
    this.realtime.setClientCount(this.connected.size);
  }
}
