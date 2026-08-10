import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";

@WebSocketGateway({
  cors: { origin: "*" },
  namespace: "notifications",
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization;

      if (!authHeader) {
        this.logger.debug(`Socket ${client.id} disconnected: missing token`);
        client.disconnect();
        return;
      }

      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const publicKey = this.configService.get<string>("JWT_PUBLIC_KEY");

      const payload = await this.jwtService.verifyAsync(token, {
        publicKey,
        algorithms: ["RS256"],
      });

      client.data.user = payload;
      const userId = payload.sub;
      const branchId = payload.branchId;

      if (userId) {
        await client.join(`user_${userId}`);
      }
      if (branchId) {
        await client.join(`branch_${branchId}`);
      }

      this.logger.debug(
        `Socket connected: ${client.id} (User: ${userId}, Branch: ${branchId})`,
      );
    } catch (err: any) {
      this.logger.debug(
        `Socket auth error for ${client.id}: ${err.message ?? err}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  emitToUser(userId: string, event: string, payload: any) {
    if (!this.server) return;
    this.server.to(`user_${userId}`).emit(event, payload);
  }

  emitToBranch(branchId: string, event: string, payload: any) {
    if (!this.server) return;
    this.server.to(`branch_${branchId}`).emit(event, payload);
  }

  broadcast(event: string, payload: any) {
    if (!this.server) return;
    this.server.emit(event, payload);
  }
}
