import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientSession {
  ws: WebSocket;
  role: 'controller' | 'receiver';
  roomCode: string;
  deviceName: string;
  vigemStatus: string;
  connectedAt: number;
}

const DEFAULT_RELEASED_STATE = {
  type: 'controller_input',
  buttons: {
    A: false,
    B: false,
    X: false,
    Y: false,
    LB: false,
    RB: false,
    LT: false,
    RT: false,
    View: false,
    Menu: false,
    Home: false,
    L3: false,
    R3: false,
  },
  axes: {
    leftX: 0,
    leftY: 0,
    rightX: 0,
    rightY: 0,
    LT: 0,
    RT: 0,
  },
  dpad: 'CENTER',
  timestamp: Date.now(),
};

function getLocalLanIps(): string[] {
  const ips: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const PORT = 3000;

  app.use(express.json());

  const clients = new Map<WebSocket, ClientSession>();

  // API health & receiver status endpoint
  app.get('/api/status', (_req, res) => {
    const activeRooms: Record<string, { controllers: number; receivers: number }> = {};
    clients.forEach((session) => {
      if (!activeRooms[session.roomCode]) {
        activeRooms[session.roomCode] = { controllers: 0, receivers: 0 };
      }
      if (session.role === 'controller') activeRooms[session.roomCode].controllers++;
      else activeRooms[session.roomCode].receivers++;
    });

    res.json({
      status: 'online',
      activeConnections: clients.size,
      rooms: activeRooms,
      lanIps: getLocalLanIps(),
      timestamp: Date.now(),
    });
  });

  // Automatic Receiver Discovery Endpoint
  app.get('/api/discover', (_req, res) => {
    const receivers: Array<{
      roomCode: string;
      deviceName: string;
      vigemStatus: string;
      connectedAt: number;
    }> = [];

    clients.forEach((s) => {
      if (s.role === 'receiver') {
        receivers.push({
          roomCode: s.roomCode,
          deviceName: s.deviceName,
          vigemStatus: s.vigemStatus,
          connectedAt: s.connectedAt,
        });
      }
    });

    res.json({
      receivers,
      lanIps: getLocalLanIps(),
      timestamp: Date.now(),
    });
  });

  // WebSocket Server mounted on /ws
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcastRoomStatus = (roomCode: string) => {
    const roomClients: { role: string; deviceName: string; vigemStatus: string }[] = [];
    clients.forEach((s) => {
      if (s.roomCode === roomCode) {
        roomClients.push({
          role: s.role,
          deviceName: s.deviceName,
          vigemStatus: s.vigemStatus,
        });
      }
    });

    const statusMsg = JSON.stringify({
      type: 'room_status',
      roomCode,
      peers: roomClients,
      timestamp: Date.now(),
    });

    clients.forEach((s) => {
      if (s.roomCode === roomCode && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(statusMsg);
      }
    });
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
    const roomCode = (url.searchParams.get('code') || 'GVOLT1').toUpperCase();
    const role = (url.searchParams.get('role') === 'receiver' ? 'receiver' : 'controller') as
      | 'controller'
      | 'receiver';
    const deviceName =
      url.searchParams.get('device') ||
      (role === 'controller' ? 'Android Game Volt gamepad' : 'Windows / Android TV Receiver');
    const vigemParam = url.searchParams.get('vigem') || (role === 'receiver' ? 'WEB_RECEIVER' : 'NONE');

    const session: ClientSession = {
      ws,
      role,
      roomCode,
      deviceName,
      vigemStatus: vigemParam,
      connectedAt: Date.now(),
    };

    clients.set(ws, session);

    ws.send(
      JSON.stringify({
        type: 'handshake_ack',
        roomCode,
        role,
        deviceName,
        serverTime: Date.now(),
      })
    );

    broadcastRoomStatus(roomCode);

    ws.on('message', (rawData) => {
      try {
        const message = JSON.parse(rawData.toString());

        if (message.type === 'ping') {
          // Check if there is an active receiver in this room
          let activeReceiver: ClientSession | null = null;
          clients.forEach((peer) => {
            if (peer.roomCode === session.roomCode && peer.role === 'receiver') {
              activeReceiver = peer;
            }
          });

          ws.send(
            JSON.stringify({
              type: 'pong',
              clientTimestamp: message.timestamp,
              serverTimestamp: Date.now(),
              receiverPresent: Boolean(activeReceiver),
              hostName: activeReceiver ? (activeReceiver as ClientSession).deviceName : null,
              vigemStatus: activeReceiver ? (activeReceiver as ClientSession).vigemStatus : 'UNVERIFIED',
            })
          );
          return;
        }

        if (message.type === 'join_room' && message.roomCode) {
          const oldRoom = session.roomCode;
          session.roomCode = String(message.roomCode).toUpperCase();
          if (message.role) session.role = message.role;
          if (message.deviceName) session.deviceName = message.deviceName;
          if (message.vigemStatus) session.vigemStatus = message.vigemStatus;
          broadcastRoomStatus(oldRoom);
          broadcastRoomStatus(session.roomCode);
          return;
        }

        if (message.type === 'receiver_status') {
          if (message.vigemStatus) session.vigemStatus = message.vigemStatus;
          if (message.hostName) session.deviceName = message.hostName;
          broadcastRoomStatus(session.roomCode);
        }

        if (
          message.type === 'controller_input' ||
          message.type === 'keyboard_input' ||
          message.type === 'mouse_input' ||
          message.type === 'rumble'
        ) {
          const payload = JSON.stringify({
            ...message,
            roomCode: session.roomCode,
            relayedAt: Date.now(),
          });

          let deliveredToReceiver = false;
          clients.forEach((peer) => {
            if (
              peer.ws !== ws &&
              peer.roomCode === session.roomCode &&
              peer.ws.readyState === WebSocket.OPEN
            ) {
              peer.ws.send(payload);
              if (peer.role === 'receiver') deliveredToReceiver = true;
            }
          });

          // Acknowledge receipt back to controller for real-time verification
          if (session.role === 'controller' && message.type === 'controller_input') {
            ws.send(
              JSON.stringify({
                type: 'input_ack',
                seq: message.seq ?? 0,
                deliveredToReceiver,
                timestamp: Date.now(),
              })
            );
          }
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      const closedSession = clients.get(ws);
      clients.delete(ws);

      if (closedSession) {
        // Failsafe: if a controller disconnects, immediately broadcast all-buttons-released state
        if (closedSession.role === 'controller') {
          const failsafePayload = JSON.stringify({
            ...DEFAULT_RELEASED_STATE,
            roomCode: closedSession.roomCode,
            failsafeRelease: true,
            timestamp: Date.now(),
          });

          clients.forEach((peer) => {
            if (
              peer.roomCode === closedSession.roomCode &&
              peer.ws.readyState === WebSocket.OPEN
            ) {
              peer.ws.send(failsafePayload);
            }
          });
        }

        broadcastRoomStatus(closedSession.roomCode);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Game Volt gamepad Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
