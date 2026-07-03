import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

interface CustomWebSocket extends WebSocket {
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    // If the path is /ws, upgrade it. Otherwise let Express handle normal HTTP/REST upgrade
    if (request.url?.startsWith('/ws')) {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: CustomWebSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.send(JSON.stringify({ type: 'connected', data: { timestamp: new Date() } }));
  });

  const interval = setInterval(() => {
    wss?.clients.forEach((ws: CustomWebSocket) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(interval);
  });
}

export function broadcast(type: string, data: any) {
  if (!wss) return;
  const message = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
