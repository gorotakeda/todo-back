import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class GamesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor() {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinGame')
  handleJoinGame(client: Socket, gameId: string) {
    void client.join(`game:${gameId}`);
  }

  @SubscribeMessage('leaveGame')
  handleLeaveGame(client: Socket, gameId: string) {
    void client.leave(`game:${gameId}`);
  }

  // ゲームの状態が更新されたときに全プレイヤーに通知
  notifyGameUpdate(gameId: string, gameData: any): void {
    console.log('Notifying game update for game:', gameId, gameData);
    this.server.to(`game:${gameId}`).emit('gameUpdate', gameData);
  }
}
