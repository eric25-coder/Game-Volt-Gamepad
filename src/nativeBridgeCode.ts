// ============================================================================
// GAME VOLT GAMEPAD - UNIVERSAL BLUETOOTH HID CONTROLLER ARCHITECTURE
// Native Plugin: NexoraBluetoothGamepad (android.bluetooth.BluetoothHidDevice)
// ============================================================================

import { Capacitor } from '@capacitor/core';
import { ControllerState, DpadDirection } from './types';

export const CONTROLLER_BLUETOOTH_IDENTITY = 'Game Volt gamepad';

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
      'Settings → Bluetooth & devices → Add device → Bluetooth → Select "Game Volt gamepad"',
    notes:
      'Windows 11 natively recognizes "Game Volt gamepad" in joy.cpl (Set up USB game controllers). For games requiring strict XInput-only APIs without Steam Input, use the included C# ViGEm Receiver.',
  },
  {
    id: 'windows_10',
    name: 'Windows 10 PC',
    hidSupportLevel: 'NATIVE_BLUETOOTH_HID',
    protocolType: 'Bluetooth HID Gamepad (0x05, 0x01 / Usage 0x05)',
    recommendedLayout: 'xbox',
    pairingSteps:
      'Settings → Devices → Bluetooth & other devices → Add Bluetooth or other device → Select "Game Volt gamepad"',
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
      'Settings → Remotes & Accessories → Pair accessory → Select "Game Volt gamepad"',
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
      'Settings → Remotes & Accessories → Pair remote or accessory → Select "Game Volt gamepad"',
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
      'Settings → Connection → External Device Manager / Bluetooth Controller → Pair "Game Volt gamepad"',
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
      'Pair "Game Volt gamepad" to Windows PC / Android TV running Chiaki-ng or PS Remote Play + ViGEm',
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
      'Open host Bluetooth settings while "Game Volt gamepad" is in Discoverable mode and pair.',
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

/**
 * Encodes the current ControllerState into the 9-byte Bluetooth HID Gamepad Report (Report ID 1):
 * Byte 0: Buttons 1..8  (Bit 0=A, Bit 1=B, Bit 2=X, Bit 3=Y, Bit 4=LB, Bit 5=RB, Bit 6=LT, Bit 7=RT)
 * Byte 1: Buttons 9..16 (Bit 0=View, Bit 1=Menu, Bit 2=L3, Bit 3=R3, Bit 4=Home)
 * Byte 2: Hat Switch (0=UP, 1=UP_RIGHT, 2=RIGHT, 3=DOWN_RIGHT, 4=DOWN, 5=DOWN_LEFT, 6=LEFT, 7=UP_LEFT, 8=CENTER)
 * Byte 3: Left Stick X  (-127..+127 signed int8)
 * Byte 4: Left Stick Y  (-127..+127 signed int8)
 * Byte 5: Right Stick X (-127..+127 signed int8)
 * Byte 6: Right Stick Y (-127..+127 signed int8)
 * Byte 7: Left Trigger  (0..255 uint8)
 * Byte 8: Right Trigger (0..255 uint8)
 */
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
  const hasNexora = isNative || Capacitor.isPluginAvailable('NexoraBluetoothGamepad');

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const androidMatch = ua.match(/Android\s+([0-9.]+)/i);
  const isAndroid = isNative || Boolean(androidMatch);
  const androidVer = androidMatch ? parseFloat(androidMatch[1]) : isNative ? 14 : null;

  let summary = '';
  if (isNative) {
    summary =
      'Native Capacitor Android APK active. NexoraBluetoothGamepad (android.bluetooth.BluetoothHidDevice) is connected to the JavaScript bridge.';
  } else if (isAndroid && androidVer !== null && androidVer < 9) {
    summary = `Android ${androidVer} detected. BluetoothHidDevice requires Android 9.0 (API 28) or higher. Use Wi-Fi WebSocket mode instead.`;
  } else if (isAndroid) {
    summary = `Android ${androidVer ?? ''} browser preview detected. Android's BluetoothHidDevice API is a native OS system service and cannot be registered from an ordinary web browser tab. Install the generated Capacitor Android APK to activate native Bluetooth HID.`;
  } else {
    summary =
      'Browser preview active. Build and install the Capacitor Android APK on an Android 9.0+ phone to register as the "Game Volt gamepad" Bluetooth HID hardware controller.';
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

export const CAPACITOR_CONFIG_CODE = `// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gamevolt.gamepad',
  appName: 'Game Volt gamepad',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
`;

export const ANDROID_MANIFEST_XML_CODE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.gamevolt.gamepad">

    <!-- Legacy Bluetooth Permissions (Android 9 / 10 / 11 - API 28..30) -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

    <!-- Android 12+ (API 31+) Runtime Bluetooth HID & Discovery Permissions -->
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission
        android:name="android.permission.BLUETOOTH_SCAN"
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />

    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.INTERNET" />

    <uses-feature android:name="android.hardware.bluetooth" android:required="true" />
    <uses-feature android:name="android.hardware.touchscreen.multitouch.distinct" android:required="true" />

    <application
        android:allowBackup="true"
        android:label="Game Volt gamepad"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="sensorLandscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

export const ANDROID_BUILD_GRADLE_CODE = `plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace "com.gamevolt.gamepad"
    compileSdkVersion 34

    defaultConfig {
        applicationId "com.gamevolt.gamepad"
        minSdkVersion 28 // Android 9.0+ required for BluetoothHidDevice API
        targetSdkVersion 34
        versionCode 1
        versionName "2.0.0"
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = '17'
    }
}

dependencies {
    implementation "androidx.appcompat:appcompat:1.6.1"
    implementation "androidx.core:core-ktx:1.12.0"
    implementation project(':capacitor-android')
}`;

export const ANDROID_MAIN_ACTIVITY_CODE = `package com.gamevolt.gamepad

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register native BluetoothHidDevice plugin BEFORE super.onCreate
        registerPlugin(NexoraBluetoothGamepadPlugin::class.java)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}`;

export const ANDROID_STUDIO_BUILD_INSTRUCTIONS = [
  {
    step: '1. Build the React + TypeScript Web Bundle',
    command: 'npm install && npm run build',
    detail:
      'Compiles the Vite + React + TypeScript interface and Capacitor registerPlugin bridge into /dist.',
  },
  {
    step: '2. Sync Web Assets & Native Plugins to Capacitor Android',
    command: 'npx cap sync android',
    detail:
      'Copies the /dist bundle into /android/app/src/main/assets/public and links @capacitor/android with NexoraBluetoothGamepadPlugin.kt.',
  },
  {
    step: '3. Open the /android Project in Android Studio',
    command: 'npx cap open android',
    detail:
      'In Android Studio, wait for Gradle sync to finish. Verify that MainActivity.kt, NexoraBluetoothGamepadPlugin.kt, and AndroidManifest.xml are present under com.gamevolt.gamepad.',
  },
  {
    step: '4. Build & Install the APK onto Your Physical Android 9.0+ Phone',
    command: 'cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk',
    detail:
      'Connect your Android phone via USB Debugging (or select Build → Build Bundle(s) / APK(s) → Build APK(s) in Android Studio) and install app-debug.apk.',
  },
  {
    step: '5. Register HID, Pair Host & Play',
    command: 'Tap "Register HID" → "Start Pairing" → Pair "Game Volt gamepad" on PC/TV',
    detail:
      'Open the installed Game Volt gamepad app, grant Bluetooth permissions, tap "Start Pairing", and select "Game Volt gamepad" in your Windows 10/11 or Android TV Bluetooth settings.',
  },
];
