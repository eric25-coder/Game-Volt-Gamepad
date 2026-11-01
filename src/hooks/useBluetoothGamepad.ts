import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectNativeBluetoothBridge,
  EncodedHidReport,
  encodeHidGamepadReport,
  HOST_COMPATIBILITY_PROFILES,
  HostPlatformId,
} from '../nativeBridgeCode';
import {
  GameVoltBluetoothGamepad,
  GameVoltCompatibilityResult,
  GameVoltStatusPayload,
  PairedBluetoothHost,
} from '../plugins/gameVoltBluetoothGamepad';
import { ControllerState } from '../types';

export type { PairedBluetoothHost };
export type NexoraCompatibilityResult = GameVoltCompatibilityResult;

export type BluetoothConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED_NATIVE_HID';

export type BluetoothAdapterStatus = 'ENABLED' | 'DISABLED';

export type HidRegistrationStatus =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'UNSUPPORTED_ANDROID_VERSION';

const ZERO_CONTROLLER_STATE: ControllerState = {
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

export function useBluetoothGamepad() {
  const bridgeInfo = detectNativeBluetoothBridge();

  const [compatibilityInfo, setCompatibilityInfo] = useState<GameVoltCompatibilityResult | null>(
    null
  );
  const [adapterStatus, setAdapterStatus] = useState<BluetoothAdapterStatus>('DISABLED');
  const [hidRegistrationStatus, setHidRegistrationStatus] =
    useState<HidRegistrationStatus>('NOT_REGISTERED');
  const [isDiscoverable, setIsDiscoverable] = useState<boolean>(false);
  const [btStatus, setBtStatus] = useState<BluetoothConnectionStatus>('DISCONNECTED');
  const [btDeviceName, setBtDeviceName] = useState<string>('No Host Connected');
  const [connectedHost, setConnectedHost] = useState<PairedBluetoothHost | null>(null);
  const [pairedHosts, setPairedHosts] = useState<PairedBluetoothHost[]>([]);
  const [btError, setBtError] = useState<string | null>(null);
  const [btReportsSent, setBtReportsSent] = useState<number>(0);
  const [selectedHostPlatform, setSelectedHostPlatform] = useState<HostPlatformId>('windows_11');
  const [lastHidReport, setLastHidReport] = useState<EncodedHidReport>(() =>
    encodeHidGamepadReport(ZERO_CONTROLLER_STATE)
  );

  const lastHexSentRef = useRef<string>('');
  const reportInFlightRef = useRef<boolean>(false);
  const pendingStateRef = useRef<ControllerState | null>(null);

  const applyNativeStatusPayload = useCallback((payload: GameVoltStatusPayload) => {
    setAdapterStatus(payload.bluetoothEnabled ? 'ENABLED' : 'DISABLED');
    setHidRegistrationStatus(payload.hidRegistered ? 'REGISTERED' : 'NOT_REGISTERED');
    setIsDiscoverable(Boolean(payload.discoverable));

    if (payload.connectionState === 'CONNECTED' && payload.connectedHost) {
      setBtStatus('CONNECTED_NATIVE_HID');
      setConnectedHost(payload.connectedHost);
      setBtDeviceName(payload.connectedHost.name || payload.connectedHost.address);
    } else if (payload.connectionState === 'CONNECTING') {
      setBtStatus('CONNECTING');
    } else {
      setBtStatus('DISCONNECTED');
      setConnectedHost(null);
      setBtDeviceName('No Host Connected');
    }

    if (payload.pairedDevices) {
      setPairedHosts(payload.pairedDevices);
    }
    if (typeof payload.reportsSentCount === 'number') {
      setBtReportsSent(payload.reportsSentCount);
    }
    if (payload.error) {
      setBtError(payload.error);
    }
  }, []);

  /**
   * Automatically initialize and register GameVoltBluetoothGamepad on app launch.
   */
  useEffect(() => {
    let listenerHandle: { remove: () => Promise<void> | void } | null = null;
    let isMounted = true;

    async function initializeBluetoothHidBridge() {
      try {
        const comp = await GameVoltBluetoothGamepad.checkCompatibility();
        if (!isMounted) return;
        setCompatibilityInfo(comp);

        if (!comp.hidProfileSupported) {
          setHidRegistrationStatus('UNSUPPORTED_ANDROID_VERSION');
          setBtError(
            comp.limitationReason ||
              'BluetoothHidDevice is not supported on this Android version.'
          );
          return;
        }

        setAdapterStatus(comp.bluetoothEnabled ? 'ENABLED' : 'DISABLED');
        setHidRegistrationStatus(comp.hidRegistered ? 'REGISTERED' : 'NOT_REGISTERED');
        setIsDiscoverable(comp.discoverable);

        if (comp.bluetoothEnabled) {
          const regStatus = await GameVoltBluetoothGamepad.registerGamepad();
          if (isMounted) {
            applyNativeStatusPayload(regStatus);
          }
        }
      } catch (err) {
        if (isMounted) {
          setBtError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void initializeBluetoothHidBridge();

    GameVoltBluetoothGamepad.addListener('bluetoothHidStatusChanged', (payload) => {
      if (isMounted) {
        applyNativeStatusPayload(payload);
      }
    })
      .then((h) => {
        listenerHandle = h;
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      void listenerHandle?.remove();
    };
  }, [applyNativeStatusPayload]);

  /**
   * 1. Calls `GameVoltBluetoothGamepad.registerGamepad()`
   */
  const registerNativeHidGamepad = useCallback(async () => {
    setBtError(null);
    try {
      const status = await GameVoltBluetoothGamepad.registerGamepad();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 2. Starts Bluetooth pairing as "Game Volt Gamepad"
   */
  const startBluetoothPairing = useCallback(async () => {
    setBtError(null);
    try {
      if (hidRegistrationStatus !== 'REGISTERED') {
        const regStatus = await GameVoltBluetoothGamepad.registerGamepad();
        applyNativeStatusPayload(regStatus);
      }
      const status = await GameVoltBluetoothGamepad.startPairing({ durationSeconds: 300 });
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [hidRegistrationStatus, applyNativeStatusPayload]);

  /**
   * 3. Opens Android Bluetooth Settings
   */
  const openAndroidBluetoothSettings = useCallback(async () => {
    setBtError(null);
    try {
      await GameVoltBluetoothGamepad.openBluetoothSettings();
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /**
   * 4. Refreshes paired Bluetooth hosts
   */
  const refreshPairedHosts = useCallback(async () => {
    setBtError(null);
    try {
      const status = await GameVoltBluetoothGamepad.getPairedDevices();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 5. Connects to a specific bonded host
   */
  const connectNativeHidHost = useCallback(
    async (host: PairedBluetoothHost) => {
      setBtError(null);
      if (host.hidCompatible === false) {
        setBtError(
          host.compatibilityNote ||
            `${host.name} does not support standard Bluetooth HID gamepads directly.`
        );
        return;
      }

      try {
        setBtStatus('CONNECTING');
        const status = await GameVoltBluetoothGamepad.connectHost({ address: host.address });
        applyNativeStatusPayload(status);
      } catch (err) {
        setBtStatus('DISCONNECTED');
        setBtError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyNativeStatusPayload]
  );

  /**
   * 6. Reconnects to the last connected Bluetooth HID host
   */
  const reconnectLastBluetoothHost = useCallback(async () => {
    setBtError(null);
    try {
      setBtStatus('CONNECTING');
      const status = await GameVoltBluetoothGamepad.reconnectLastHost();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtStatus('DISCONNECTED');
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 7. Forgets a paired Bluetooth host
   */
  const forgetBluetoothHost = useCallback(
    async (address: string) => {
      setBtError(null);
      try {
        const status = await GameVoltBluetoothGamepad.forgetDevice({ address });
        applyNativeStatusPayload(status);
      } catch (err) {
        setBtError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyNativeStatusPayload]
  );

  /**
   * 8. Calls `GameVoltBluetoothGamepad.sendHidReport(...)`
   */
  const sendBluetoothGamepadState = useCallback(
    async (state: ControllerState, forceSend = false) => {
      const encoded = encodeHidGamepadReport(state);
      setLastHidReport(encoded);

      if (!forceSend && encoded.rawHex === lastHexSentRef.current) {
        return;
      }
      lastHexSentRef.current = encoded.rawHex;

      if (btStatus !== 'CONNECTED_NATIVE_HID') {
        return;
      }

      if (reportInFlightRef.current) {
        pendingStateRef.current = state;
        return;
      }

      reportInFlightRef.current = true;
      try {
        const res = await GameVoltBluetoothGamepad.sendHidReport({
          buttonsMask: encoded.buttonsMask,
          hat: encoded.hat,
          leftX: state.axes.leftX,
          leftY: state.axes.leftY,
          rightX: state.axes.rightX,
          rightY: state.axes.rightY,
          lt: state.axes.LT,
          rt: state.axes.RT,
        });
        if (res.sent) {
          setBtReportsSent((c) => c + 1);
        }
      } catch {
        // Keep input path non-blocking
      } finally {
        reportInFlightRef.current = false;
        if (pendingStateRef.current) {
          const nextState = pendingStateRef.current;
          pendingStateRef.current = null;
          void sendBluetoothGamepadState(nextState, true);
        }
      }
    },
    [btStatus]
  );

  /**
   * 9. Failsafe: immediately releases all held buttons, triggers, and joysticks
   */
  const sendBluetoothFailsafeRelease = useCallback(async () => {
    setLastHidReport(encodeHidGamepadReport(ZERO_CONTROLLER_STATE));
    lastHexSentRef.current = '';
    if (btStatus === 'CONNECTED_NATIVE_HID') {
      try {
        await GameVoltBluetoothGamepad.releaseAllInputs();
      } catch {
        // Ignore release error when disconnected
      }
    }
  }, [btStatus]);

  /**
   * 10. Calls `GameVoltBluetoothGamepad.disconnect()`
   */
  const disconnectBluetooth = useCallback(async () => {
    await sendBluetoothFailsafeRelease();
    try {
      const status = await GameVoltBluetoothGamepad.disconnect();
      applyNativeStatusPayload(status);
    } catch {
      // Ignore disconnect error
    }
    setBtStatus('DISCONNECTED');
    setConnectedHost(null);
    setBtDeviceName('No Host Connected');
  }, [sendBluetoothFailsafeRelease, applyNativeStatusPayload]);

  const activeHostCompatibility =
    HOST_COMPATIBILITY_PROFILES.find((p) => p.id === selectedHostPlatform) ??
    HOST_COMPATIBILITY_PROFILES[0];

  return {
    compatibilityInfo,
    adapterStatus,
    hidRegistrationStatus,
    isDiscoverable,
    btStatus,
    btDeviceName,
    connectedHost,
    pairedHosts,
    btError,
    btReportsSent,
    lastHidReport,
    bridgeInfo,
    selectedHostPlatform,
    setSelectedHostPlatform,
    activeHostCompatibility,
    registerNativeHidGamepad,
    startBluetoothPairing,
    openAndroidBluetoothSettings,
    refreshPairedHosts,
    connectNativeHidHost,
    reconnectLastBluetoothHost,
    forgetBluetoothHost,
    sendBluetoothGamepadState,
    sendBluetoothFailsafeRelease,
    disconnectBluetooth,
  };
}
