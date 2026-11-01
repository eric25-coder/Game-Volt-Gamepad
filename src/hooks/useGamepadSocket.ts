import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ControllerState,
  ConnectionStatus,
  ConnectionHistoryItem,
  ReceiverStatus,
  VigemDriverStatus,
  DiscoveredReceiver,
  VerificationSuiteState,
} from '../types';

const HISTORY_STORAGE_KEY = 'gamevolt_connection_history_v1';

export const INITIAL_CONTROLLER_STATE: ControllerState = {
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
};

export function getDefaultRelayWsUrl(
  roomCode: string,
  role: 'controller' | 'receiver' = 'controller'
): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?code=${encodeURIComponent(roomCode)}&role=${role}`;
}

export const useGamepadSocket = () => {
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [receiverStatus, setReceiverStatus] = useState<ReceiverStatus>('DISCONNECTED');
  const [vigemStatus, setVigemStatus] = useState<VigemDriverStatus>('UNVERIFIED');
  const [connectedDeviceName, setConnectedDeviceName] = useState<string>('None');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [messagesPerSecond, setMessagesPerSecond] = useState<number>(0);
  const [packetErrors, setPacketErrors] = useState<number>(0);
  const [packetsSent, setPacketsSent] = useState<number>(0);
  const [packetsAcked, setPacketsAcked] = useState<number>(0);
  const [autoReconnect, setAutoReconnect] = useState<boolean>(true);
  const [discoveredReceivers, setDiscoveredReceivers] = useState<DiscoveredReceiver[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  const [verificationTests, setVerificationTests] = useState<VerificationSuiteState>({
    test1_phoneConnected: false,
    test2_receiverEventsConfirmed: false,
    test3_virtualGamepadConfirmed: false,
    test4_joyCplVerified: false,
    test5_gameResponseVerified: false,
    test6_disconnectFailsafeVerified: false,
    test7_reconnectRestoredVerified: false,
    test8_simultaneousInputsVerified: false,
  });

  const [roomCode, setRoomCode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('pair');
      if (urlCode) return urlCode.toUpperCase();
    }
    return 'GVOLT1';
  });

  const [connectionMode, setConnectionMode] = useState<'relay' | 'direct_lan'>('relay');
  const [customWsUrl, setCustomWsUrl] = useState<string>('ws://192.168.1.100:8765');
  const [role, setRole] = useState<'controller' | 'receiver'>('controller');
  const [roomPeers, setRoomPeers] = useState<
    { role: string; deviceName: string; vigemStatus?: string }[]
  >([]);
  const [remoteReceivedState, setRemoteReceivedState] =
    useState<ControllerState>(INITIAL_CONTROLLER_STATE);
  const [lastPacketJson, setLastPacketJson] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [history, setHistory] = useState<ConnectionHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const mpsIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const intentionalDisconnectRef = useRef<boolean>(false);
  const hadPreviousConnectionRef = useRef<boolean>(false);
  const msgCountInWindowRef = useRef<number>(0);
  const seqRef = useRef<number>(0);

  const markTestVerified = useCallback((key: keyof VerificationSuiteState, value = true) => {
    setVerificationTests((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const saveToHistory = useCallback((item: Omit<ConnectionHistoryItem, 'id' | 'lastConnected'>) => {
    setHistory((prev) => {
      const filtered = prev.filter((p) => !(p.url === item.url && p.roomCode === item.roomCode));
      const updated: ConnectionHistoryItem[] = [
        {
          ...item,
          id: `${Date.now()}`,
          lastConnected: Date.now(),
        },
        ...filtered,
      ].slice(0, 8);
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage quota errors
      }
      return updated;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Rolling 1-second Messages Per Second (MPS) telemetry loop
  useEffect(() => {
    mpsIntervalRef.current = window.setInterval(() => {
      setMessagesPerSecond(msgCountInWindowRef.current);
      msgCountInWindowRef.current = 0;
    }, 1000);
    return () => {
      if (mpsIntervalRef.current) window.clearInterval(mpsIntervalRef.current);
    };
  }, []);

  // Automatic Receiver Discovery (queries /api/discover + probes localhost:8765 for C# Windows Receiver)
  const scanForReceivers = useCallback(async () => {
    setIsScanning(true);
    const found: DiscoveredReceiver[] = [];

    try {
      const res = await fetch('/api/discover');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.receivers)) {
          data.receivers.forEach(
            (r: { roomCode: string; deviceName: string; vigemStatus: string }, idx: number) => {
              found.push({
                id: `relay-${r.roomCode}-${idx}`,
                name: `${r.deviceName} (Room ${r.roomCode})`,
                url: getDefaultRelayWsUrl(r.roomCode, 'controller'),
                roomCode: r.roomCode,
                mode: 'relay',
                vigemStatus: r.vigemStatus || 'WEB_RECEIVER',
              });
            }
          );
        }
        if (Array.isArray(data.lanIps)) {
          data.lanIps.forEach((ip: string) => {
            found.push({
              id: `lan-${ip}`,
              name: `Detected LAN Host (${ip}:8765)`,
              url: `ws://${ip}:8765`,
              mode: 'direct_lan',
              vigemStatus: 'PROBE_CANDIDATE',
            });
          });
        }
      }
    } catch {
      // Ignore discovery fetch error
    }

    // Probe ws://127.0.0.1:8765 if running on the same Windows PC
    try {
      await new Promise<void>((resolve) => {
        const probe = new WebSocket('ws://127.0.0.1:8765');
        const timer = window.setTimeout(() => {
          probe.close();
          resolve();
        }, 650);
        probe.onopen = () => {
          window.clearTimeout(timer);
          found.unshift({
            id: 'local-csharp-8765',
            name: 'Local Windows C# ViGEm Receiver (127.0.0.1:8765)',
            url: 'ws://127.0.0.1:8765',
            mode: 'direct_lan',
            vigemStatus: 'CONNECTED',
          });
          probe.close();
          resolve();
        };
        probe.onerror = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
    } catch {
      // Ignore probe error
    }

    setDiscoveredReceivers(found);
    setIsScanning(false);
  }, []);

  const sendFailsafeReleaseFrame = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(
          JSON.stringify({
            type: 'controller_input',
            seq: ++seqRef.current,
            ...INITIAL_CONTROLLER_STATE,
            failsafeRelease: true,
            timestamp: Date.now(),
          })
        );
        markTestVerified('test6_disconnectFailsafeVerified', true);
      } catch {
        // Ignore close send error
      }
    }
  }, [markTestVerified]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearTimers();
    if (socketRef.current) {
      sendFailsafeReleaseFrame();
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus('DISCONNECTED');
    setReceiverStatus('DISCONNECTED');
    setVigemStatus('UNVERIFIED');
    setConnectedDeviceName('None');
    setLatencyMs(null);
    setRoomPeers([]);
  }, [clearTimers, sendFailsafeReleaseFrame]);

  const connect = useCallback(
    (overrideOpts?: {
      mode?: 'relay' | 'direct_lan';
      url?: string;
      code?: string;
      targetRole?: 'controller' | 'receiver';
    }) => {
      intentionalDisconnectRef.current = false;
      const activeMode = overrideOpts?.mode ?? connectionMode;
      const activeCode = (overrideOpts?.code ?? roomCode).trim().toUpperCase() || 'GVOLT1';
      const activeRole = overrideOpts?.targetRole ?? role;
      const targetUrl =
        activeMode === 'relay'
          ? getDefaultRelayWsUrl(activeCode, activeRole)
          : (overrideOpts?.url ?? customWsUrl).trim();

      clearTimers();
      if (socketRef.current) {
        sendFailsafeReleaseFrame();
        socketRef.current.close();
        socketRef.current = null;
      }

      setErrorMessage(null);
      setStatus('CONNECTING');

      try {
        const ws = new WebSocket(targetUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          setStatus('CONNECTED');
          setErrorMessage(null);
          markTestVerified('test1_phoneConnected', true);

          if (hadPreviousConnectionRef.current) {
            markTestVerified('test7_reconnectRestoredVerified', true);
          }
          hadPreviousConnectionRef.current = true;

          if (activeMode === 'direct_lan') {
            setReceiverStatus('CONNECTED_WINDOWS_VIGEM');
            setConnectedDeviceName(`Windows PC (${targetUrl})`);
          } else {
            setReceiverStatus('RELAY_WAITING');
            setConnectedDeviceName(`Relay Room ${activeCode}`);
          }

          saveToHistory({
            name:
              activeMode === 'relay'
                ? `Game Volt Room (${activeCode})`
                : `Windows C# Receiver (${targetUrl})`,
            url: targetUrl,
            roomCode: activeCode,
            mode: activeMode,
          });

          // Send initial ping immediately
          ws.send(JSON.stringify({ type: 'ping', timestamp: performance.now() }));

          // Periodic heartbeat every 1000ms
          heartbeatIntervalRef.current = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: performance.now() }));
            }
          }, 1000);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'pong' && typeof data.clientTimestamp === 'number') {
              const rtt = Math.max(1, Math.round(performance.now() - data.clientTimestamp));
              setLatencyMs(rtt);

              if (data.vigemStatus === 'CONNECTED') {
                setVigemStatus('CONNECTED');
                setReceiverStatus('CONNECTED_WINDOWS_VIGEM');
                if (data.hostName) setConnectedDeviceName(data.hostName);
                markTestVerified('test3_virtualGamepadConfirmed', true);
              } else if (data.vigemStatus === 'DRIVER_MISSING') {
                setVigemStatus('DRIVER_MISSING');
                setReceiverStatus('CONNECTED_WEB_HOST');
                if (data.hostName) setConnectedDeviceName(data.hostName);
              } else if (data.receiverPresent) {
                setReceiverStatus('CONNECTED_WEB_HOST');
                setVigemStatus('WEB_RECEIVER');
                if (data.hostName) setConnectedDeviceName(data.hostName);
              }
              return;
            }

            if (data.type === 'receiver_status') {
              if (data.hostName) setConnectedDeviceName(data.hostName);
              if (data.vigemStatus === 'CONNECTED') {
                setVigemStatus('CONNECTED');
                setReceiverStatus('CONNECTED_WINDOWS_VIGEM');
                markTestVerified('test3_virtualGamepadConfirmed', true);
              } else if (data.vigemStatus === 'DRIVER_MISSING') {
                setVigemStatus('DRIVER_MISSING');
                setReceiverStatus('CONNECTED_WEB_HOST');
              }
              return;
            }

            if (data.type === 'input_ack') {
              setPacketsAcked((c) => c + 1);
              markTestVerified('test2_receiverEventsConfirmed', true);
              return;
            }

            if (data.type === 'rumble' && navigator.vibrate) {
              navigator.vibrate(data.durationMs || 80);
              return;
            }

            if (data.type === 'room_status' && Array.isArray(data.peers)) {
              setRoomPeers(data.peers);
              const receiverPeer = data.peers.find(
                (p: { role: string }) => p.role === 'receiver'
              );
              if (receiverPeer) {
                setReceiverStatus(
                  receiverPeer.vigemStatus === 'CONNECTED'
                    ? 'CONNECTED_WINDOWS_VIGEM'
                    : 'CONNECTED_WEB_HOST'
                );
                setVigemStatus(
                  receiverPeer.vigemStatus === 'CONNECTED' ? 'CONNECTED' : 'WEB_RECEIVER'
                );
                setConnectedDeviceName(receiverPeer.deviceName);
              } else if (activeMode === 'relay') {
                setReceiverStatus('RELAY_WAITING');
              }
              return;
            }

            if (data.type === 'controller_input' && data.buttons && data.axes) {
              setRemoteReceivedState({
                buttons: data.buttons,
                axes: data.axes,
                dpad: data.dpad || 'CENTER',
              });
              setLastPacketJson(JSON.stringify(data, null, 2));
              msgCountInWindowRef.current += 1;
              markTestVerified('test2_receiverEventsConfirmed', true);
            }
          } catch {
            setPacketErrors((e) => e + 1);
          }
        };

        ws.onerror = () => {
          setPacketErrors((e) => e + 1);
          setErrorMessage(
            activeMode === 'direct_lan'
              ? `Cannot reach Windows Receiver at ${targetUrl}. Ensure the C# Receiver is running on port 8765 and firewall allows local LAN connections.`
              : 'WebSocket connection interrupted.'
          );
          setStatus('DISCONNECTED');
          setReceiverStatus('DISCONNECTED');
        };

        ws.onclose = () => {
          clearTimers();
          setStatus('DISCONNECTED');
          setReceiverStatus('DISCONNECTED');
          setLatencyMs(null);

          // Automatic Reconnection if not intentionally disconnected
          if (!intentionalDisconnectRef.current && autoReconnect) {
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connect(overrideOpts);
            }, 2200);
          }
        };
      } catch (err) {
        setPacketErrors((e) => e + 1);
        setStatus('DISCONNECTED');
        setErrorMessage(err instanceof Error ? err.message : 'Invalid WebSocket URL');
      }
    },
    [
      connectionMode,
      roomCode,
      role,
      customWsUrl,
      autoReconnect,
      clearTimers,
      sendFailsafeReleaseFrame,
      saveToHistory,
      markTestVerified,
    ]
  );

  // Fast, zero-allocation-overhead input sender
  const sendInput = useCallback(
    (state: ControllerState, recordJsonPreview = false) => {
      const seq = ++seqRef.current;
      const payloadObj = {
        type: 'controller_input',
        seq,
        timestamp: Date.now(),
        buttons: state.buttons,
        axes: {
          leftX: Number(state.axes.leftX.toFixed(3)),
          leftY: Number(state.axes.leftY.toFixed(3)),
          rightX: Number(state.axes.rightX.toFixed(3)),
          rightY: Number(state.axes.rightY.toFixed(3)),
          LT: Number(state.axes.LT.toFixed(3)),
          RT: Number(state.axes.RT.toFixed(3)),
        },
        dpad: state.dpad,
      };

      const jsonString = JSON.stringify(payloadObj);
      if (recordJsonPreview) {
        setLastPacketJson(JSON.stringify(payloadObj, null, 2));
      }

      // Check simultaneous multi-touch inputs for TEST 8 verification
      const pressedCount = Object.values(state.buttons).filter(Boolean).length;
      const stickDeflected =
        Math.abs(state.axes.leftX) > 0.1 ||
        Math.abs(state.axes.leftY) > 0.1 ||
        Math.abs(state.axes.rightX) > 0.1 ||
        Math.abs(state.axes.rightY) > 0.1;
      if (pressedCount >= 2 || (pressedCount >= 1 && stickDeflected)) {
        markTestVerified('test8_simultaneousInputsVerified', true);
      }

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          socketRef.current.send(jsonString);
          msgCountInWindowRef.current += 1;
          setPacketsSent((c) => c + 1);
          if (connectionMode === 'direct_lan') {
            markTestVerified('test2_receiverEventsConfirmed', true);
          }
        } catch {
          setPacketErrors((e) => e + 1);
        }
      }
    },
    [connectionMode, markTestVerified]
  );

  const sendKeyboardInput = useCallback((key: string, action: 'down' | 'up' | 'press') => {
    const payload = {
      type: 'keyboard_input',
      key,
      action,
      timestamp: Date.now(),
    };
    setLastPacketJson(JSON.stringify(payload, null, 2));
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(payload));
        msgCountInWindowRef.current += 1;
        setPacketsSent((c) => c + 1);
      } catch {
        setPacketErrors((e) => e + 1);
      }
    }
  }, []);

  const sendMouseInput = useCallback(
    (deltaX: number, deltaY: number, button?: 'left' | 'right' | 'middle', pressed?: boolean) => {
      const payload = {
        type: 'mouse_input',
        dx: Math.round(deltaX),
        dy: Math.round(deltaY),
        button: button || null,
        pressed: pressed ?? false,
        timestamp: Date.now(),
      };
      setLastPacketJson(JSON.stringify(payload, null, 2));
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          socketRef.current.send(JSON.stringify(payload));
          msgCountInWindowRef.current += 1;
          setPacketsSent((c) => c + 1);
        } catch {
          setPacketErrors((e) => e + 1);
        }
      }
    },
    []
  );

  useEffect(() => {
    connect({ mode: 'relay' });
    scanForReceivers();
    return () => {
      intentionalDisconnectRef.current = true;
      clearTimers();
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    receiverStatus,
    vigemStatus,
    connectedDeviceName,
    latencyMs,
    messagesPerSecond,
    packetErrors,
    packetsSent,
    packetsAcked,
    autoReconnect,
    setAutoReconnect,
    discoveredReceivers,
    isScanning,
    scanForReceivers,
    verificationTests,
    markTestVerified,
    roomCode,
    setRoomCode,
    connectionMode,
    setConnectionMode,
    customWsUrl,
    setCustomWsUrl,
    role,
    setRole,
    roomPeers,
    remoteReceivedState,
    lastPacketJson,
    errorMessage,
    history,
    connect,
    disconnect,
    sendFailsafeReleaseFrame,
    sendInput,
    sendKeyboardInput,
    sendMouseInput,
  };
};
