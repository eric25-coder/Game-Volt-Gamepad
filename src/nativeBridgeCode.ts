// ============================================================================
// GAME VOLT GAMEPAD - UNIVERSAL BLUETOOTH HID CONTROLLER ARCHITECTURE
// Native Plugins: GameVoltBluetoothGamepad & NexoraBluetoothGamepad (android.bluetooth.BluetoothHidDevice)
// ============================================================================

import { Capacitor } from '@capacitor/core';
import { ControllerState, DpadDirection } from './types';

export const CONTROLLER_BLUETOOTH_IDENTITY = 'Game Volt Gamepad';

export interface NativeBluetoothStatus {
  isNativeCapacitor: boolean;
  hasNexoraPlugin: boolean;
  hidSupported: boolean;
  isAndroidDevice: boolean;
  detectedAndroidVersion: number | null;
  compatibilitySummary: string;
}

export interface EncodedHidReport {
  reportId: number;
  buttonsMask: number;
  hat: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  lt: number;
  rt: number;
  rawBytes: Uint8Array;
  rawHex: string;
}

export type HostPlatformId =
  | 'windows_11'
  | 'windows_10'
  | 'android_tv'
  | 'google_tv'
  | 'smart_tv'
  | 'playstation_remote'
  | 'generic_hid';

export interface HostCompatibilityProfile {
  id: HostPlatformId;
  name: string;
  hidSupportLevel: 'NATIVE_BLUETOOTH_HID' | 'REMOTE_PLAY_OR_BRIDGE';
  protocolType: string;
  recommendedLayout: 'gamevolt' | 'xbox' | 'playstation';
  pairingSteps: string;
  notes: string;
}

export const HOST_COMPATIBILITY_PROFILES: HostCompatibilityProfile[] = [
  {
    id: 'windows_11',
    name: 'Windows 11 PC',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Bluetooth HID Gamepad (0x05, 0x01 / Usage 0x05) + Steam Input / DirectInput',
    recommendedLayout: 'xbox',
    pairingSteps:
      'Settings → Bluetooth & devices → Add device → Bluetooth → Select "Game Volt Gamepad"',
    notes:
      'Windows 11 natively recognizes "Game Volt Gamepad" in joy.cpl (Set up USB game controllers). For games requiring strict XInput-only APIs without Steam Input, use the included C# ViGEm Receiver.',
  },
  {
    id: 'windows_10',
    name: 'Windows 10 PC',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Bluetooth HID Gamepad (0x05, 0x01 / Usage 0x05)',
    recommendedLayout: 'xbox',
    pairingSteps:
      'Settings → Devices → Bluetooth & other devices → Add Bluetooth or other device → Select "Game Volt Gamepad"',
    notes:
      'Appears in Windows Control Panel → Game Controllers (joy.cpl) with 16 buttons, 8-way POV Hat, 4 thumbstick axes, and 2 analog triggers.',
  },
  {
    id: 'android_tv',
    name: 'Android TV',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Android Linux Kernel hid-generic / Android KeyCharacterMap Gamepad',
    recommendedLayout: 'gamevolt',
    pairingSteps:
      'Settings → Remotes & Accessories → Pair accessory → Select "Game Volt Gamepad"',
    notes:
      'Natively controls the Android TV home launcher (D-Pad, A=Select, B=Back, Home) and all gamepad-enabled Android TV games & cloud gaming apps.',
  },
  {
    id: 'google_tv',
    name: 'Google TV (Chromecast / Bravia / TCL)',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Bluetooth Classic HID Profile (UUID 00001124-0000-1000-8000-00805f9b34fb)',
    recommendedLayout: 'gamevolt',
    pairingSteps:
      'Settings → Remotes & Accessories → Pair remote or accessory → Select "Game Volt Gamepad"',
    notes:
      'Full plug-and-play support for Google TV OS navigation, GeForce NOW, Game Volt Cloud, Xbox Cloud Gaming, and RetroArch.',
  },
  {
    id: 'smart_tv',
    name: 'Samsung Tizen / LG webOS Smart TV',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Standard Bluetooth HID Gamepad (Generic Desktop Usage 0x05)',
    recommendedLayout: 'xbox',
    pairingSteps:
      'Settings → Connection → External Device Manager / Bluetooth Controller → Pair "Game Volt Gamepad"',
    notes:
      'Compatible with Smart TV Gaming Hub Bluetooth controller pairing for standard HID gamepads.',
  },
  {
    id: 'playstation_remote',
    name: 'PlayStation 4 / PlayStation 5 (Remote Play)',
    hidSupportLevel: 'REMOTE_PLAY_OR_BRIDGE',
    protocolType: 'Requires PS Remote Play Host or C# ViGEm DualShock 4 Emulation',
    recommendedLayout: 'playstation',
    pairingSteps:
      'Pair "Game Volt Gamepad" to Windows PC / Android TV running Chiaki-ng or PS Remote Play + ViGEm',
    notes:
      'IMPORTANT: PS4 and PS5 consoles require proprietary hardware cryptographic chips for direct console Bluetooth pairing. Standard Bluetooth HID gamepads control PS4/PS5 via PS Remote Play or a compatible host bridge.',
  },
  {
    id: 'generic_hid',
    name: 'Other Bluetooth HID Host (Linux / SteamOS / macOS)',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'USB/Bluetooth HID 1.11 Gamepad Descriptor (Report ID 1)',
    recommendedLayout: 'gamevolt',
    pairingSteps:
      'Open host Bluetooth settings while "Game Volt Gamepad" is in Discoverable mode and pair.',
    notes:
      'Compatible with Linux BlueZ input plugin, SteamOS, Raspberry Pi, and macOS GameController framework.',
  },
];

const DPAD_TO_HAT_MAP: Record<DpadDirection, number> = {
  UP: 0,
  UP_RIGHT: 1,
  RIGHT: 2,
  DOWN_RIGHT: 3,
  DOWN: 4,
  DOWN_LEFT: 5,
  LEFT: 6,
  UP_LEFT: 7,
  CENTER: 8,
};

export function encodeHidGamepadReport(state: ControllerState): EncodedHidReport {
  const b = state.buttons;
  let mask = 0;
  if (b.A) mask |= 1 << 0;
  if (b.B) mask |= 1 << 1;
  if (b.X) mask |= 1 << 2;
  if (b.Y) mask |= 1 << 3;
  if (b.LB) mask |= 1 << 4;
  if (b.RB) mask |= 1 << 5;
  if (b.LT) mask |= 1 << 6;
  if (b.RT) mask |= 1 << 7;
  if (b.View) mask |= 1 << 8;
  if (b.Menu) mask |= 1 << 9;
  if (b.L3) mask |= 1 << 10;
  if (b.R3) mask |= 1 << 11;
  if (b.Home) mask |= 1 << 12;

  const hat = DPAD_TO_HAT_MAP[state.dpad] ?? 8;

  const lx = Math.max(-127, Math.min(127, Math.round(state.axes.leftX * 127)));
  const ly = Math.max(-127, Math.min(127, Math.round(state.axes.leftY * 127)));
  const rx = Math.max(-127, Math.min(127, Math.round(state.axes.rightX * 127)));
  const ry = Math.max(-127, Math.min(127, Math.round(state.axes.rightY * 127)));
  const lt = Math.max(0, Math.min(255, Math.round(state.axes.LT * 255)));
  const rt = Math.max(0, Math.min(255, Math.round(state.axes.RT * 255)));

  const rawBytes = new Uint8Array([
    mask & 0xff,
    (mask >> 8) & 0xff,
    hat & 0x0f,
    lx & 0xff,
    ly & 0xff,
    rx & 0xff,
    ry & 0xff,
    lt & 0xff,
    rt & 0xff,
  ]);

  const rawHex = Array.from(rawBytes)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  return {
    reportId: 1,
    buttonsMask: mask,
    hat,
    leftX: lx,
    leftY: ly,
    rightX: rx,
    rightY: ry,
    lt,
    rt,
    rawBytes,
    rawHex,
  };
}

export function detectNativeBluetoothBridge(): NativeBluetoothStatus {
  const isNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const hasNexora =
    isNative ||
    Capacitor.isPluginAvailable('GameVoltBluetoothGamepad') ||
    Capacitor.isPluginAvailable('NexoraBluetoothGamepad');

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const androidMatch = ua.match(/Android\s+([0-9.]+)/i);
  const isAndroid = isNative || Boolean(androidMatch);
  const androidVer = androidMatch ? parseFloat(androidMatch[1]) : isNative ? 14 : null;

  let summary = '';
  if (isNative) {
    summary =
      'Native Capacitor Android APK active. GameVoltBluetoothGamepad (android.bluetooth.BluetoothHidDevice) is connected to the JavaScript bridge.';
  } else if (isAndroid && androidVer !== null && androidVer < 9) {
    summary = `Android ${androidVer} detected. BluetoothHidDevice requires Android 9.0 (API 28) or higher. Use Wi-Fi WebSocket mode instead.`;
  } else if (isAndroid) {
    summary = `Android ${androidVer ?? ''} browser preview detected. Android's BluetoothHidDevice API is a native OS system service and cannot be registered from an ordinary web browser tab. Install the generated Capacitor Android APK to activate native Bluetooth HID.`;
  } else {
    summary =
      'Browser preview active. Build and install the Capacitor Android APK on an Android 9.0+ phone to register as the "Game Volt Gamepad" Bluetooth HID hardware controller.';
  }

  return {
    isNativeCapacitor: isNative,
    hasNexoraPlugin: hasNexora,
    hidSupported: isNative,
    isAndroidDevice: isAndroid,
    detectedAndroidVersion: androidVer,
    compatibilitySummary: summary,
  };
}

export const UNIVERSAL_HID_DESCRIPTOR_HEX =
  '05 01 09 05 A1 01 85 01 05 09 19 01 29 10 15 00 25 01 75 01 95 10 81 02 05 01 09 39 15 00 25 07 35 00 46 3B 01 65 14 75 04 95 01 81 42 75 04 95 01 81 01 05 01 09 30 09 31 09 32 09 35 15 81 25 7F 75 08 95 04 81 02 05 02 09 C5 09 C4 15 00 26 FF 00 75 08 95 02 81 02 C0';
