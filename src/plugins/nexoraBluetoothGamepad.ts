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

export interface NexoraCompatibilityResult {
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

export interface NexoraStatusPayload {
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

export interface NexoraBluetoothGamepadPlugin {
  checkCompatibility(): Promise<NexoraCompatibilityResult>;
  requestBluetoothPermissions(): Promise<{ granted: boolean; status: NexoraStatusPayload }>;
  registerHidDevice(): Promise<NexoraStatusPayload>;
  unregisterHidDevice(): Promise<NexoraStatusPayload>;
  startPairing(options?: { durationSeconds?: number }): Promise<NexoraStatusPayload>;
  openBluetoothSettings(): Promise<void>;
  getPairedDevices(): Promise<NexoraStatusPayload>;
  connectHost(options: { address: string }): Promise<NexoraStatusPayload>;
  reconnectLastHost(): Promise<NexoraStatusPayload>;
  disconnectHost(): Promise<NexoraStatusPayload>;
  forgetDevice(options: { address: string }): Promise<NexoraStatusPayload>;
  sendHidReport(report: HidReportInputPayload): Promise<{ sent: boolean; reportHex: string }>;
  releaseAllInputs(): Promise<{ sent: boolean }>;
  addListener(
    eventName: 'bluetoothHidStatusChanged',
    listenerFunc: (status: NexoraStatusPayload) => void
  ): Promise<PluginListenerHandle>;
}

/**
 * Web fallback implementation used ONLY when running inside a browser preview tab.
 * When compiled and installed as an Android APK via Capacitor, Capacitor automatically
 * routes all calls to the native Kotlin `NexoraBluetoothGamepadPlugin` class.
 */
class NexoraBluetoothGamepadWeb extends WebPlugin implements NexoraBluetoothGamepadPlugin {
  private getBrowserCompatibility(): NexoraCompatibilityResult {
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

  private getEmptyStatus(error: string | null = null): NexoraStatusPayload {
    return {
      bluetoothEnabled: false,
      controllerBluetoothName: 'Game Volt Gamepad',
      hidRegistered: false,
      discoverable: false,
      connectionState: 'DISCONNECTED',
      connectedHost: null,
      pairedDevices: [],
      error,
    };
  }

  async checkCompatibility(): Promise<NexoraCompatibilityResult> {
    return this.getBrowserCompatibility();
  }

  async requestBluetoothPermissions(): Promise<{ granted: boolean; status: NexoraStatusPayload }> {
    return {
      granted: false,
      status: this.getEmptyStatus(
        'Native Android APK required to request BLUETOOTH_CONNECT, BLUETOOTH_SCAN, and BLUETOOTH_ADVERTISE permissions.'
      ),
    };
  }

  async registerHidDevice(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus(
      "Android's BluetoothHidDevice API requires the compiled Capacitor Android APK (NexoraBluetoothGamepadPlugin.kt)."
    );
  }

  async unregisterHidDevice(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus();
  }

  async startPairing(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus(
      'Bluetooth HID discoverability ("Game Volt Gamepad") requires the installed Capacitor Android APK.'
    );
  }

  async openBluetoothSettings(): Promise<void> {
    throw new Error('Opening Android system Bluetooth settings requires the native Android APK.');
  }

  async getPairedDevices(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus(
      'Reading bonded Android Bluetooth HID hosts requires the installed Capacitor Android APK.'
    );
  }

  async connectHost(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus('Connecting via BluetoothHidDevice requires the installed Android APK.');
  }

  async reconnectLastHost(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus('Reconnecting via BluetoothHidDevice requires the installed Android APK.');
  }

  async disconnectHost(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus();
  }

  async forgetDevice(): Promise<NexoraStatusPayload> {
    return this.getEmptyStatus();
  }

  async sendHidReport(): Promise<{ sent: boolean; reportHex: string }> {
    return { sent: false, reportHex: '00 00 08 00 00 00 00 00 00' };
  }

  async releaseAllInputs(): Promise<{ sent: boolean }> {
    return { sent: false };
  }
}

export const NexoraBluetoothGamepad = registerPlugin<NexoraBluetoothGamepadPlugin>(
  'NexoraBluetoothGamepad',
  {
    web: () => new NexoraBluetoothGamepadWeb(),
  }
);

export function isRunningInNativeAndroidApk(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
