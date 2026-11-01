import { Capacitor, PluginListenerHandle, registerPlugin, WebPlugin } from '@capacitor/core';

export interface PairedBluetoothHost {
  name: string;
  address: string;
  deviceType: string;
  bondState?: string;
  isConnected: boolean;
  hidCompatible: boolean;
  compatibilityNote?: string;
}

export interface GameVoltCompatibilityResult {
  platform: 'android' | 'web' | 'ios';
  isNativeAndroidApk: boolean;
  androidSdkInt: number;
  androidRelease: string;
  deviceModel: string;
  bluetoothSupported: boolean;
  bluetoothEnabled: boolean;
  hidProfileSupported: boolean;
  permissionsGranted: boolean;
  hidRegistered: boolean;
  discoverable: boolean;
  controllerName: string;
  statusMessage: string;
  limitationReason: string | null;
}

export type NativeBluetoothConnectionState =
  | 'DISCONNECTED'
  | 'DISCOVERABLE'
  | 'PAIRING'
  | 'BONDED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTING';

export interface GameVoltStatusPayload {
  bluetoothEnabled: boolean;
  hidProfileAvailable?: boolean;
  controllerBluetoothName: string;
  hidRegistered: boolean;
  registrationCallbackMessage?: string;
  discoverable: boolean;
  pairingStatus?: 'NONE' | 'PAIRING' | 'BONDED';
  hostDeviceAddress?: string;
  connectionState: NativeBluetoothConnectionState;
  connectedHost: PairedBluetoothHost | null;
  pairedDevices: PairedBluetoothHost[];
  lastReportHex?: string;
  reportsSentCount?: number;
  error: string | null;
  callbackLogs?: string[];
}

export interface DiagnosticTestStep {
  step: string;
  passed: boolean;
  detail: string;
}

export interface DiagnosticTestResult {
  allPassed: boolean;
  readyForPairing: boolean;
  steps: DiagnosticTestStep[];
  status: GameVoltStatusPayload;
}

export interface HidReportInputPayload {
  buttonsMask: number;
  hat: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  lt: number;
  rt: number;
}

/**
 * GameVoltBluetoothGamepad Capacitor Plugin Interface
 */
export interface GameVoltBluetoothGamepadPlugin {
  registerGamepad(): Promise<GameVoltStatusPayload>;
  sendHidReport(report: HidReportInputPayload): Promise<{ sent: boolean; reportHex: string }>;
  disconnect(): Promise<GameVoltStatusPayload>;

  checkCompatibility(): Promise<GameVoltCompatibilityResult>;
  requestBluetoothPermissions(): Promise<{ granted: boolean; status: GameVoltStatusPayload }>;
  startPairing(options?: { durationSeconds?: number }): Promise<GameVoltStatusPayload>;
  openBluetoothSettings(): Promise<void>;
  getPairedDevices(): Promise<GameVoltStatusPayload>;
  connectHost(options: { address: string }): Promise<GameVoltStatusPayload>;
  reconnectLastHost(): Promise<GameVoltStatusPayload>;
  forgetDevice(options: { address: string }): Promise<GameVoltStatusPayload>;
  releaseAllInputs(): Promise<{ sent: boolean }>;
  runDiagnosticTest(): Promise<DiagnosticTestResult>;
  addListener(
    eventName: 'bluetoothHidStatusChanged',
    listenerFunc: (status: GameVoltStatusPayload) => void
  ): Promise<PluginListenerHandle>;
}

/**
 * Web fallback implementation used ONLY when running inside a browser preview tab.
 * When compiled and installed as an Android APK via Capacitor, Capacitor automatically
 * routes all calls to the native Kotlin `GameVoltBluetoothGamepadPlugin` class.
 */
class GameVoltBluetoothGamepadWeb extends WebPlugin implements GameVoltBluetoothGamepadPlugin {
  private getBrowserCompatibility(): GameVoltCompatibilityResult {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const androidMatch = ua.match(/Android\s+([0-9.]+)/i);
    const androidRelease = androidMatch ? androidMatch[1] : 'N/A';
    const majorVer = androidMatch ? parseInt(androidMatch[1], 10) : 0;

    return {
      platform: 'web',
      isNativeAndroidApk: false,
      androidSdkInt: majorVer >= 9 ? 28 + (majorVer - 9) : 0,
      androidRelease,
      deviceModel: 'Browser Preview Environment',
      bluetoothSupported: false,
      bluetoothEnabled: false,
      hidProfileSupported: false,
      permissionsGranted: false,
      hidRegistered: false,
      discoverable: false,
      controllerName: 'Game Volt Gamepad',
      statusMessage:
        'Browser preview active. Install the generated Capacitor Android APK to use native BluetoothHidDevice.',
      limitationReason:
        "Android's BluetoothHidDevice API is a native OS system service and cannot be registered from an ordinary web browser tab. Build and install the Android APK to activate native Bluetooth HID.",
    };
  }

  private getEmptyStatus(error: string | null = null): GameVoltStatusPayload {
    return {
      bluetoothEnabled: false,
      hidProfileAvailable: false,
      controllerBluetoothName: 'Game Volt Gamepad',
      hidRegistered: false,
      registrationCallbackMessage: 'Browser preview (requires native Android APK)',
      discoverable: false,
      pairingStatus: 'NONE',
      hostDeviceAddress: 'None',
      connectionState: 'DISCONNECTED',
      connectedHost: null,
      pairedDevices: [],
      error,
      callbackLogs: [
        '[Browser Preview] Native BluetoothHidDevice callbacks are only available inside the installed Android APK.',
      ],
    };
  }

  async checkCompatibility(): Promise<GameVoltCompatibilityResult> {
    return this.getBrowserCompatibility();
  }

  async requestBluetoothPermissions(): Promise<{
    granted: boolean;
    status: GameVoltStatusPayload;
  }> {
    return {
      granted: false,
      status: this.getEmptyStatus(
        'Native Android APK required to request BLUETOOTH_CONNECT, BLUETOOTH_SCAN, and BLUETOOTH_ADVERTISE permissions.'
      ),
    };
  }

  async registerGamepad(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      "Android's BluetoothHidDevice API requires the compiled Capacitor Android APK (GameVoltBluetoothGamepadPlugin.kt)."
    );
  }

  async startPairing(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Bluetooth HID discoverability ("Game Volt Gamepad") requires the installed Capacitor Android APK.'
    );
  }

  async openBluetoothSettings(): Promise<void> {
    throw new Error('Opening Android system Bluetooth settings requires the native Android APK.');
  }

  async getPairedDevices(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Reading bonded Android Bluetooth HID hosts requires the installed Capacitor Android APK.'
    );
  }

  async connectHost(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Connecting via BluetoothHidDevice requires the installed Android APK.'
    );
  }

  async reconnectLastHost(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Reconnecting via BluetoothHidDevice requires the installed Android APK.'
    );
  }

  async disconnect(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus();
  }

  async forgetDevice(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus();
  }

  async sendHidReport(
    report: HidReportInputPayload
  ): Promise<{ sent: boolean; reportHex: string }> {
    const lx = Math.max(-127, Math.min(127, Math.round(report.leftX * 127))) & 0xff;
    const ly = Math.max(-127, Math.min(127, Math.round(report.leftY * 127))) & 0xff;
    const rx = Math.max(-127, Math.min(127, Math.round(report.rightX * 127))) & 0xff;
    const ry = Math.max(-127, Math.min(127, Math.round(report.rightY * 127))) & 0xff;
    const lt = Math.max(0, Math.min(255, Math.round(report.lt * 255))) & 0xff;
    const rt = Math.max(0, Math.min(255, Math.round(report.rt * 255))) & 0xff;

    const bytes = [
      report.buttonsMask & 0xff,
      (report.buttonsMask >> 8) & 0xff,
      report.hat & 0x0f,
      lx,
      ly,
      rx,
      ry,
      lt,
      rt,
    ];
    const reportHex = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    return { sent: false, reportHex };
  }

  async releaseAllInputs(): Promise<{ sent: boolean }> {
    return { sent: false };
  }

  async runDiagnosticTest(): Promise<DiagnosticTestResult> {
    return {
      allPassed: false,
      readyForPairing: false,
      steps: [
        {
          step: '1. Native Android APK Environment',
          passed: false,
          detail:
            'Running in web browser preview. Install the compiled Android APK to run native BluetoothHidDevice diagnostics.',
        },
      ],
      status: this.getEmptyStatus(
        'Install the Android APK to run the native Bluetooth HID hardware diagnostic test.'
      ),
    };
  }
}

export const GameVoltBluetoothGamepad = registerPlugin<GameVoltBluetoothGamepadPlugin>(
  'GameVoltBluetoothGamepad',
  {
    web: () => new GameVoltBluetoothGamepadWeb(),
  }
);

export function isRunningInNativeAndroidApk(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
