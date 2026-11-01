/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, X } from 'lucide-react';
import { GamepadLayout } from './components/GamepadLayout';
import { ControlCenterDrawer } from './components/ControlCenterDrawer';
import { KeyboardMouseOverlay } from './components/KeyboardMouseOverlay';
import { INITIAL_CONTROLLER_STATE, useGamepadSocket } from './hooks/useGamepadSocket';
import { useBluetoothGamepad } from './hooks/useBluetoothGamepad';
import {
  ActiveModalTab,
  ConnectionStatus,
  ControllerProfile,
  ControllerState,
  DpadDirection,
} from './types';

const PROFILES_STORAGE_KEY = 'gamevolt_gamepad_profiles_v3';

const DEFAULT_GAMEVOLT_PROFILE: ControllerProfile = {
  id: 'gamevolt-default',
  name: 'Game Volt Signature',
  layoutPreset: 'gamevolt',
  buttonScale: 1.0,
  buttonOpacity: 1.0,
  joystickDeadzone: 0.08,
  joystickSensitivity: 1.0,
  triggerSensitivity: 1.0,
  calibration: {
    leftOffsetX: 0,
    leftOffsetY: 0,
    rightOffsetX: 0,
    rightOffsetY: 0,
  },
  rgbMode: 'gamevolt',
  rgbIntensity: 1.0,
  customColor: '#ff007f',
  hapticsEnabled: true,
  lowLatencyMode: true,
  batterySaverMode: false,
  stickRestOffset: true,
  brandHeaderText: 'GAME VOLT',
};

const PRESET_PROFILES: ControllerProfile[] = [
  DEFAULT_GAMEVOLT_PROFILE,
  {
    ...DEFAULT_GAMEVOLT_PROFILE,
    id: 'xbox-pro',
    name: 'Xbox Series Layout',
    layoutPreset: 'xbox',
    rgbMode: 'reactive',
  },
  {
    ...DEFAULT_GAMEVOLT_PROFILE,
    id: 'ps5-remote',
    name: 'PlayStation Remote Play',
    layoutPreset: 'playstation',
    rgbMode: 'breathing',
  },
];

function clampAxis(val: number): number {
  return Math.max(-1, Math.min(1, Number(val.toFixed(4))));
}

export default function App() {
  const {
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
    discoveredReceivers,
    isScanning,
    scanForReceivers,
    verificationTests,
    markTestVerified,
    connect,
    disconnect,
    sendInput,
    sendFailsafeReleaseFrame,
    sendKeyboardInput,
    sendMouseInput,
  } = useGamepadSocket();

  const {
    compatibilityInfo,
    adapterStatus,
    hidRegistrationStatus,
    isDiscoverable,
    btStatus,
    btDeviceName,
    btError,
    pairedHosts,
    btReportsSent,
    lastHidReport,
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
  } = useBluetoothGamepad();

  const [controllerState, setControllerState] = useState<ControllerState>(INITIAL_CONTROLLER_STATE);
  const stateRef = useRef<ControllerState>(INITIAL_CONTROLLER_STATE);

  const [activeModal, setActiveModal] = useState<ActiveModalTab>('none');
  const [liveTestHudOpen, setLiveTestHudOpen] = useState(false);
  const [keyboardMouseMode, setKeyboardMouseMode] = useState<'none' | 'keyboard' | 'mouse'>('none');

  const [savedProfiles, setSavedProfiles] = useState<ControllerProfile[]>(() => {
    try {
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      if (!raw) return PRESET_PROFILES;
      const parsed = JSON.parse(raw) as ControllerProfile[];
      return parsed.map((p) => ({
        ...DEFAULT_GAMEVOLT_PROFILE,
        ...p,
        calibration: p.calibration ?? DEFAULT_GAMEVOLT_PROFILE.calibration,
      }));
    } catch {
      return PRESET_PROFILES;
    }
  });

  const [profile, setProfile] = useState<ControllerProfile>(DEFAULT_GAMEVOLT_PROFILE);

  // Automatic failsafe release on window blur, visibility change, or pagehide to prevent stuck buttons
  useEffect(() => {
    const handleFailsafeReleaseAll = () => {
      stateRef.current = INITIAL_CONTROLLER_STATE;
      setControllerState(INITIAL_CONTROLLER_STATE);
      sendFailsafeReleaseFrame();
      void sendBluetoothFailsafeRelease();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleFailsafeReleaseAll();
      }
    };

    window.addEventListener('blur', handleFailsafeReleaseAll);
    window.addEventListener('pagehide', handleFailsafeReleaseAll);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleFailsafeReleaseAll);
      window.removeEventListener('pagehide', handleFailsafeReleaseAll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sendFailsafeReleaseFrame, sendBluetoothFailsafeRelease]);

  const handleButtonChange = useCallback(
    (button: keyof ControllerState['buttons'], pressed: boolean, analogValue?: number) => {
      const prev = stateRef.current;
      const nextAxes = { ...prev.axes };
      if (button === 'LT') {
        nextAxes.LT = pressed ? Math.max(0, Math.min(1, analogValue ?? 1)) : 0;
      } else if (button === 'RT') {
        nextAxes.RT = pressed ? Math.max(0, Math.min(1, analogValue ?? 1)) : 0;
      }

      const next: ControllerState = {
        ...prev,
        buttons: {
          ...prev.buttons,
          [button]: pressed,
        },
        axes: nextAxes,
      };
      stateRef.current = next;
      setControllerState(next);
      void sendBluetoothGamepadState(next, true);
      sendInput(next, true);
    },
    [sendBluetoothGamepadState, sendInput]
  );

  const handleStickMove = useCallback(
    (side: 'left' | 'right', rawX: number, rawY: number) => {
      const prev = stateRef.current;
      const cal = profile.calibration;
      const isReleased = rawX === 0 && rawY === 0;

      const x = isReleased
        ? 0
        : clampAxis(rawX + (side === 'left' ? cal.leftOffsetX : cal.rightOffsetX));
      const y = isReleased
        ? 0
        : clampAxis(rawY + (side === 'left' ? cal.leftOffsetY : cal.rightOffsetY));

      const next: ControllerState = {
        ...prev,
        axes:
          side === 'left'
            ? { ...prev.axes, leftX: x, leftY: y }
            : { ...prev.axes, rightX: x, rightY: y },
      };

      stateRef.current = next;
      // Immediately transmit over Bluetooth HID & WebSocket with zero React render delay
      void sendBluetoothGamepadState(next, isReleased);
      sendInput(next, isReleased);

      // Only trigger React state re-render if diagnostic modal or live test HUD is open, or on stick release
      if (activeModal !== 'none' || liveTestHudOpen || isReleased) {
        setControllerState(next);
      }
    },
    [sendBluetoothGamepadState, sendInput, profile.calibration, activeModal, liveTestHudOpen]
  );

  const handleDpadChange = useCallback(
    (direction: DpadDirection) => {
      const prev = stateRef.current;
      const next: ControllerState = {
        ...prev,
        dpad: direction,
      };
      stateRef.current = next;
      setControllerState(next);
      void sendBluetoothGamepadState(next, true);
      sendInput(next, true);
    },
    [sendBluetoothGamepadState, sendInput]
  );

  const handleUpdateProfile = (partial: Partial<ControllerProfile>) => {
    setProfile((prev) => ({ ...prev, ...partial }));
  };

  const handleSaveNewProfile = (name: string) => {
    const newProf: ControllerProfile = {
      ...profile,
      id: `custom-${Date.now()}`,
      name,
    };
    const updated = [...savedProfiles, newProf];
    setSavedProfiles(updated);
    setProfile(newProf);
    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage error
    }
  };

  const handleSelectSavedProfile = (id: string) => {
    const found = savedProfiles.find((p) => p.id === id);
    if (found) setProfile(found);
  };

  const handleResetDefaultProfile = () => {
    setProfile(DEFAULT_GAMEVOLT_PROFILE);
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const isBtConnected = btStatus === 'CONNECTED_NATIVE_HID';

  const effectiveStatus: ConnectionStatus =
    isBtConnected || status === 'CONNECTED'
      ? 'CONNECTED'
      : btStatus === 'CONNECTING' || status === 'CONNECTING'
      ? 'CONNECTING'
      : 'DISCONNECTED';

  const effectiveDeviceName = isBtConnected
    ? `${btDeviceName} (Bluetooth HID)`
    : connectedDeviceName;

  const pressedButtonsList = (
    Object.keys(controllerState.buttons) as Array<keyof ControllerState['buttons']>
  ).filter((k) => controllerState.buttons[k]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#060608]">
      <GamepadLayout
        controllerState={controllerState}
        status={effectiveStatus}
        latencyMs={latencyMs}
        profile={profile}
        onButtonChange={handleButtonChange}
        onStickMove={handleStickMove}
        onDpadChange={handleDpadChange}
        onOpenModal={(tab) => setActiveModal(tab)}
        onOpenKeyboardMouse={(mode) => setKeyboardMouseMode(mode)}
      />

      {/* Interactive Live TEST CONTROLLER Floating HUD */}
      {liveTestHudOpen && activeModal === 'none' && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40 w-[94vw] max-w-2xl px-3 py-2 rounded-xl bg-black/90 border border-pink-500/50 backdrop-blur-md shadow-[0_0_25px_rgba(236,72,153,0.35)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular select-none">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
            <span className="font-bold text-white">TEST CONTROLLER</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                effectiveStatus === 'CONNECTED'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {effectiveStatus}
            </span>
            <span className="text-zinc-400">
              BT HID: <strong className="text-blue-400">{btStatus}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-zinc-300">
            <span>
              Buttons:{' '}
              <strong className="text-pink-400">
                {pressedButtonsList.length > 0 ? pressedButtonsList.join(' + ') : 'NONE'}
              </strong>
            </span>
            <span>
              HID Report: <strong className="text-emerald-400">[{lastHidReport.rawHex}]</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveModal('test')}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-sans font-semibold"
            >
              Full Diagnostics
            </button>
            <button
              onClick={() => setLiveTestHudOpen(false)}
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white"
              title="Close Test HUD"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {keyboardMouseMode !== 'none' && (
        <KeyboardMouseOverlay
          mode={keyboardMouseMode}
          onClose={() => setKeyboardMouseMode('none')}
          onSwitchMode={(m) => setKeyboardMouseMode(m)}
          onSendKey={sendKeyboardInput}
          onSendMouse={sendMouseInput}
        />
      )}

      <ControlCenterDrawer
        activeTab={activeModal}
        onSelectTab={(tab) => setActiveModal(tab)}
        onClose={() => setActiveModal('none')}
        status={effectiveStatus}
        receiverStatus={receiverStatus}
        vigemStatus={vigemStatus}
        connectedDeviceName={effectiveDeviceName}
        latencyMs={latencyMs}
        messagesPerSecond={messagesPerSecond}
        packetErrors={packetErrors}
        packetsSent={packetsSent}
        packetsAcked={packetsAcked}
        autoReconnect={autoReconnect}
        onToggleAutoReconnect={setAutoReconnect}
        roomCode={roomCode}
        onChangeRoomCode={setRoomCode}
        connectionMode={connectionMode}
        onChangeConnectionMode={setConnectionMode}
        customWsUrl={customWsUrl}
        onChangeCustomWsUrl={setCustomWsUrl}
        role={role}
        onChangeRole={setRole}
        roomPeers={roomPeers}
        errorMessage={errorMessage}
        history={history}
        discoveredReceivers={discoveredReceivers}
        isScanning={isScanning}
        onScanForReceivers={scanForReceivers}
        onConnect={connect}
        onDisconnect={disconnect}
        compatibilityInfo={compatibilityInfo}
        adapterStatus={adapterStatus}
        hidRegistrationStatus={hidRegistrationStatus}
        isDiscoverable={isDiscoverable}
        btStatus={btStatus}
        btDeviceName={btDeviceName}
        btError={btError}
        pairedHosts={pairedHosts}
        btReportsSent={btReportsSent}
        lastHidReport={lastHidReport}
        selectedHostPlatform={selectedHostPlatform}
        onSelectHostPlatform={setSelectedHostPlatform}
        activeHostCompatibility={activeHostCompatibility}
        onRegisterNativeHid={registerNativeHidGamepad}
        onStartBluetoothPairing={startBluetoothPairing}
        onOpenBluetoothSettings={openAndroidBluetoothSettings}
        onRefreshPairedHosts={refreshPairedHosts}
        onConnectNativeHidHost={connectNativeHidHost}
        onReconnectLastHost={reconnectLastBluetoothHost}
        onForgetBluetoothHost={forgetBluetoothHost}
        onDisconnectBluetooth={disconnectBluetooth}
        controllerState={controllerState}
        remoteReceivedState={remoteReceivedState}
        lastPacketJson={lastPacketJson}
        verificationTests={verificationTests}
        onMarkTestVerified={markTestVerified}
        liveTestHudOpen={liveTestHudOpen}
        onToggleLiveTestHud={setLiveTestHudOpen}
        profile={profile}
        savedProfiles={savedProfiles}
        onUpdateProfile={handleUpdateProfile}
        onSaveNewProfile={handleSaveNewProfile}
        onSelectSavedProfile={handleSelectSavedProfile}
        onResetDefaultProfile={handleResetDefaultProfile}
        onToggleFullscreen={handleToggleFullscreen}
      />
    </main>
  );
}
