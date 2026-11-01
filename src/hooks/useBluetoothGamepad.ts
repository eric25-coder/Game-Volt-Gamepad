import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONTROLLER_BLUETOOTH_IDENTITY,
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
  isRunningInNativeAndroidApk,
  PairedBluetoothHost,
} from '../plugins/gameVoltBluetoothGamepad';
import { ControllerState } from '../types';

export type { PairedBluetoothHost };
export type NexoraCompatibilityResult = GameVoltCompatibilityResult;

export type BluetoothConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED_NATIVE_HID';

export type BluetoothAdapterStatus =
  | 'ENABLED'
  | 'DISABLED'
  | 'NATIVE_APK_REQUIRED';

export type HidRegistrationStatus =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'UNAVAILABLE_IN_BROWSER'
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
  const isNativeApk = isRunningInNativeAndroidApk();

  const [compatibilityInfo, setCompatibilityInfo] = useState<GameVoltCompatibilityResult | null>(
    null
  );
  const [adapterStatus, setAdapterStatus] = useState<BluetoothAdapterStatus>(() =>
    isNativeApk ? 'ENABLED' : 'NATIVE_APK_REQUIRED'
  );
  const [hidRegistrationStatus, setHidRegistrationStatus] = useState<HidRegistrationStatus>(() => {
    if (
      bridgeInfo.isAndroidDevice &&
      bridgeInfo.detectedAndroidVersion !== null &&
      bridgeInfo.detectedAndroidVersion < 9
    ) {
      return 'UNSUPPORTED_ANDROID_VERSION';
    }
    return isNativeApk ? 'NOT_REGISTERED' : 'UNAVAILABLE_IN_BROWSER';
  });
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

    // Strictly only report CONNECTED when native BluetoothHidDevice callback confirms CONNECTED
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
   * Subscribe to native GameVoltBluetoothGamepad status callbacks.
   * When running inside the installed Android APK, automatically verify compatibility
   * and call `registerGamepad()`.
   */
  useEffect(() => {
    let listenerHandle: { remove: () => Promise<void> | void } | null = null;
    let isMounted = true;

    async function initializeBluetoothHidBridge() {
      try {
        const comp = await GameVoltBluetoothGamepad.checkCompatibility();
        if (!isMounted) return;
        setCompatibilityInfo(comp);

        if (!comp.isNativeAndroidApk) {
          setAdapterStatus('NATIVE_APK_REQUIRED');
          setHidRegistrationStatus('UNAVAILABLE_IN_BROWSER');
          return;
        }

        if (!comp.hidProfileSupported) {
          setHidRegistrationStatus('UNSUPPORTED_ANDROID_VERSION');
          setBtError(
            comp.limitationReason ||
              'BluetoothHidDevice is not supported or restricted on this Android device.'
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
        if (isMounted && isRunningInNativeAndroidApk()) {
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
   * 1. Calls `GameVoltBluetoothGamepad.registerGamepad()` to register the Bluetooth HID Gamepad
   */
  const registerNativeHidGamepad = useCallback(async () => {
    setBtError(null);
    try {
      const comp = await GameVoltBluetoothGamepad.checkCompatibility();
      setCompatibilityInfo(comp);

      if (!comp.isNativeAndroidApk) {
        setHidRegistrationStatus('UNAVAILABLE_IN_BROWSER');
        setBtError(
          comp.limitationReason ||
            `Native Bluetooth HID ("${CONTROLLER_BLUETOOTH_IDENTITY}") requires the installed Android APK.`
        );
        return;
      }

      if (!comp.hidProfileSupported) {
        setHidRegistrationStatus('UNSUPPORTED_ANDROID_VERSION');
        setBtError(
          comp.limitationReason ||
            'BluetoothHidDevice profile is unavailable on this Android device.'
        );
        return;
      }

      const status = await GameVoltBluetoothGamepad.registerGamepad();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 2. Makes the phone discoverable as "Game Volt gamepad" to pair with Windows / Android TV
   */
  const startBluetoothPairing = useCallback(async () => {
    setBtError(null);
    try {
      const comp = await GameVoltBluetoothGamepad.checkCompatibility();
      setCompatibilityInfo(comp);

      if (!comp.isNativeAndroidApk) {
        setBtError(
          comp.limitationReason ||
            `Bluetooth HID pairing ("${CONTROLLER_BLUETOOTH_IDENTITY}") requires the installed Android APK.`
        );
        return;
      }

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
   * 3. Opens the native Android Bluetooth Settings screen
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
   * 4. Refreshes bonded Bluetooth hosts list
   */
  const refreshPairedHosts = useCallback(async () => {
    setBtError(null);
    try {
      const comp = await GameVoltBluetoothGamepad.checkCompatibility();
      setCompatibilityInfo(comp);
      if (!comp.isNativeAndroidApk) {
        setBtError('Paired Bluetooth host enumeration requires the installed Android APK.');
        return;
      }
      const status = await GameVoltBluetoothGamepad.getPairedDevices();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 5. Connects to a specific bonded host (Windows PC, Android TV, Google TV, Smart TV)
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
      const comp = await GameVoltBluetoothGamepad.checkCompatibility();
      setCompatibilityInfo(comp);
      if (!comp.isNativeAndroidApk) {
        setBtError('Bluetooth HID reconnection requires the installed Android APK.');
        return;
      }

      setBtStatus('CONNECTING');
      const status = await GameVoltBluetoothGamepad.reconnectLastHost();
      applyNativeStatusPayload(status);
    } catch (err) {
      setBtStatus('DISCONNECTED');
      setBtError(err instanceof Error ? err.message : String(err));
    }
  }, [applyNativeStatusPayload]);

  /**
   * 7. Forgets (unbonds) a paired Bluetooth host
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
   * 8. Calls `GameVoltBluetoothGamepad.sendHidReport(...)` to transmit the 9-byte binary HID report
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
   * 10. Calls `GameVoltBluetoothGamepad.disconnect()` to release all inputs and disconnect from the host
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
