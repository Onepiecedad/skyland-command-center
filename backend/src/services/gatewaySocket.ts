import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import logger from '../utils/logger.js';
import type { WSClient, WebSocketMessage } from '../types/index.js';

/**
 * WebSocket Gateway Server with Heartbeat
 * Manages real-time connections with automatic reconnection support
 */

// Configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
// Note: HEARTBEAT_TIMEOUT and RECONNECTION_WINDOW reserved for future reconnection logic

class GatewaySocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Connection state tracking
  public connectionStats = {
    totalConnections: 0,
    activeConnections: 0,
    messagesReceived: 0,
    messagesSent: 0,
    disconnections: 0,
    reconnections: 0
  };

  /**
   * Initialize the WebSocket server
   */
  initialize(server: import('http').Server): void {
    if (this.isRunning) {
      logger.warn('WebSocket server already running');
      return;
    }

    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      // Enable per-message deflate for better performance
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true
      }
    });

    this.setupEventHandlers();
    this.startHeartbeat();
    this.isRunning = true;

    logger.info('WebSocket gateway initialized on /ws');
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      this.handleConnection(socket, req);
    });

    this.wss.on('error', (error: Error) => {
      logger.error('WebSocket server error:', error);
    });

    this.wss.on('close', () => {
      logger.info('WebSocket server closed');
      this.isRunning = false;
    });
  }

  /**
   * Handle new client connection
   */
  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const clientIp = req.socket.remoteAddress || 'unknown';
    
    const client: WSClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      lastPing: Date.now(),
      isAlive: true
    };

    this.clients.set(clientId, client);
    this.connectionStats.totalConnections++;
    this.connectionStats.activeConnections = this.clients.size;

    logger.info({
      message: 'Client connected',
      clientId,
      clientIp,
      activeConnections: this.clients.size
    });

    // Send welcome message with client ID
    this.sendToClient(client, {
      type: 'update',
      payload: { 
        event: 'connected', 
        clientId,
        message: 'Connected to Skyland Command Center'
      },
      timestamp: Date.now()
    });

    // Setup socket event handlers
    socket.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    socket.on('pong', () => {
      this.handlePong(client);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnection(client, code, reason);
    });

    socket.on('error', (error: Error) => {
      logger.error({
        message: 'Socket error',
        clientId,
        error: error.message
      });
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: WSClient, data: Buffer): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      this.connectionStats.messagesReceived++;

      logger.debug({
        message: 'Received WebSocket message',
        clientId: client.id,
        type: message.type
      });

      switch (message.type) {
        case 'ping':
          this.sendToClient(client, {
            type: 'pong',
            timestamp: Date.now()
          });
          break;

        case 'subscribe':
          if (message.channel) {
            client.subscriptions.add(message.channel);
            this.sendToClient(client, {
              type: 'update',
              channel: message.channel,
              payload: { event: 'subscribed', channel: message.channel },
              timestamp: Date.now()
            });
          }
          break;

        case 'unsubscribe':
          if (message.channel) {
            client.subscriptions.delete(message.channel);
            this.sendToClient(client, {
              type: 'update',
              channel: message.channel,
              payload: { event: 'unsubscribed', channel: message.channel },
              timestamp: Date.now()
            });
          }
          break;

        default:
          logger.warn({
            message: 'Unknown message type',
            clientId: client.id,
            type: message.type
          });
      }
    } catch (error) {
      logger.error({
        message: 'Failed to parse WebSocket message',
        clientId: client.id,
        error: (error as Error).message
      });
      
      this.sendToClient(client, {
        type: 'error',
        payload: { message: 'Invalid message format' },
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle pong response from client
   */
  private handlePong(client: WSClient): void {
    client.isAlive = true;
    client.lastPing = Date.now();
    logger.debug({ message: 'Pong received', clientId: client.id });
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(client: WSClient, code: number, reason: Buffer): void {
    this.clients.delete(client.id);
    this.connectionStats.activeConnections = this.clients.size;
    this.connectionStats.disconnections++;

    const reasonStr = reason.toString() || 'No reason provided';
    
    logger.info({
      message: 'Client disconnected',
      clientId: client.id,
      code,
      reason: reasonStr,
      activeConnections: this.clients.size
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          // Client didn't respond to ping, terminate connection
          logger.warn({
            message: 'Client heartbeat timeout, terminating',
            clientId: client.id,
            lastPing: client.lastPing
          });
          client.socket.terminate();
          return;
        }

        // Reset alive status and send ping
        client.isAlive = false;
        
        try {
          client.socket.ping();
          logger.debug({ message: 'Ping sent', clientId: client.id });
        } catch (error) {
          logger.error({
            message: 'Failed to send ping',
            clientId: client.id,
            error: (error as Error).message
          });
          client.socket.terminate();
        }
      });
    }, HEARTBEAT_INTERVAL);

    logger.info({ message: 'Heartbeat started', interval: HEARTBEAT_INTERVAL });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WSClient, message: WebSocketMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      try {
        client.socket.send(JSON.stringify(message));
        this.connectionStats.messagesSent++;
      } catch (error) {
        logger.error({
          message: 'Failed to send message',
          clientId: client.id,
          error: (error as Error).message
        });
      }
    }
  }

  /**
   * Broadcast message to all connected clients or specific channel
   */
  broadcast(message: WebSocketMessage, channel?: string): void {
    this.clients.forEach((client) => {
      // If channel specified, only send to subscribers
      if (channel && !client.subscriptions.has(channel)) {
        return;
      }
      
      this.sendToClient(client, message);
    });

    logger.debug({
      message: 'Broadcast sent',
      channel: channel || 'all',
      recipientCount: channel 
        ? Array.from(this.clients.values()).filter(c => c.subscriptions.has(channel)).length
        : this.clients.size
    });
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection statistics
   */
  getStats(): typeof this.connectionStats {
    return { ...this.connectionStats };
  }

  /**
   * Get connected clients count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected clients
   */
  getClients(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    this.clients.forEach((client) => {
      client.socket.close(1000, 'Server shutting down');
    });
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.isRunning = false;
    logger.info('WebSocket gateway stopped');
  }
}

// Export singleton instance
export const gatewaySocket = new GatewaySocketServer();
export default gatewaySocket;
