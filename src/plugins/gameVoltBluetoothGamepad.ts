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

export interface GameVoltStatusPayload {
  bluetoothEnabled: boolean;
  controllerBluetoothName: string;
  hidRegistered: boolean;
  discoverable: boolean;
  connectionState: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTING';
  connectedHost: PairedBluetoothHost | null;
  pairedDevices: PairedBluetoothHost[];
  lastReportHex?: string;
  reportsSentCount?: number;
  error: string | null;
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
 * Defines the primary methods `registerGamepad`, `sendHidReport`, and `disconnect`
 * called by the TypeScript frontend.
 */
export interface GameVoltBluetoothGamepadPlugin {
  /** Registers the Android device as a Bluetooth HID Gamepad ("Game Volt gamepad"). */
  registerGamepad(): Promise<GameVoltStatusPayload>;
  /** Transmits the 9-byte binary Bluetooth HID input report to the connected host. */
  sendHidReport(report: HidReportInputPayload): Promise<{ sent: boolean; reportHex: string }>;
  /** Releases all held buttons/axes and disconnects from the connected Bluetooth HID host. */
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
  addListener(
    eventName: 'bluetoothHidStatusChanged',
    listenerFunc: (status: GameVoltStatusPayload) => void
  ): Promise<PluginListenerHandle>;
}

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
      deviceModel: 'Browser Preview',
      bluetoothSupported: false,
      bluetoothEnabled: false,
      hidProfileSupported: false,
      permissionsGranted: false,
      hidRegistered: false,
      discoverable: false,
      controllerName: 'Game Volt gamepad',
      statusMessage: 'Install the Android APK to use native Bluetooth HID.',
      limitationReason:
        'Native Bluetooth HID requires the compiled Android APK. In browser mode, use Wi-Fi / LAN connection.',
    };
  }

  private getEmptyStatus(error: string | null = null): GameVoltStatusPayload {
    return {
      bluetoothEnabled: false,
      controllerBluetoothName: 'Game Volt gamepad',
      hidRegistered: false,
      discoverable: false,
      connectionState: 'DISCONNECTED',
      connectedHost: null,
      pairedDevices: [],
      error,
    };
  }

  async registerGamepad(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Native Bluetooth HID registration requires the installed Android APK.'
    );
  }

  async sendHidReport(): Promise<{ sent: boolean; reportHex: string }> {
    return { sent: false, reportHex: '00 00 08 00 00 00 00 00 00' };
  }

  async disconnect(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus();
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
      status: this.getEmptyStatus('Android APK required for Bluetooth permissions.'),
    };
  }

  async startPairing(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Bluetooth HID pairing ("Game Volt gamepad") requires the installed Android APK.'
    );
  }

  async openBluetoothSettings(): Promise<void> {
    throw new Error('Opening Android Bluetooth settings requires the installed Android APK.');
  }

  async getPairedDevices(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus('Paired device list requires the installed Android APK.');
  }

  async connectHost(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus('Connecting via Bluetooth HID requires the installed Android APK.');
  }

  async reconnectLastHost(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus(
      'Reconnecting via Bluetooth HID requires the installed Android APK.'
    );
  }

  async forgetDevice(): Promise<GameVoltStatusPayload> {
    return this.getEmptyStatus();
  }

  async releaseAllInputs(): Promise<{ sent: boolean }> {
    return { sent: false };
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
