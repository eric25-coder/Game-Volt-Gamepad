import React, { useState } from 'react';
import {
  X,
  Wifi,
  QrCode,
  Activity,
  Sliders,
  Settings,
  Check,
  Copy,
  RefreshCw,
  RotateCcw,
  Maximize2,
  Smartphone,
  AlertCircle,
  Bluetooth,
  Radar,
  Play,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  ActiveModalTab,
  ConnectionHistoryItem,
  ConnectionStatus,
  ControllerProfile,
  ControllerState,
  DiscoveredReceiver,
  ReceiverStatus,
  VerificationSuiteState,
  VigemDriverStatus,
} from '../types';
import {
  CONTROLLER_BLUETOOTH_IDENTITY,
  EncodedHidReport,
  HOST_COMPATIBILITY_PROFILES,
  HostCompatibilityProfile,
  HostPlatformId,
} from '../nativeBridgeCode';
import {
  BluetoothAdapterStatus,
  BluetoothConnectionStatus,
  HidRegistrationStatus,
  NexoraCompatibilityResult,
  PairedBluetoothHost,
} from '../hooks/useBluetoothGamepad';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface ControlCenterDrawerProps {
  activeTab: ActiveModalTab;
  onSelectTab: (tab: ActiveModalTab) => void;
  onClose: () => void;
  status: ConnectionStatus;
  receiverStatus: ReceiverStatus;
  vigemStatus: VigemDriverStatus;
  connectedDeviceName: string;
  latencyMs: number | null;
  messagesPerSecond: number;
  packetErrors: number;
  packetsSent: number;
  packetsAcked: number;
  autoReconnect: boolean;
  onToggleAutoReconnect: (val: boolean) => void;
  roomCode: string;
  onChangeRoomCode: (code: string) => void;
  connectionMode: 'relay' | 'direct_lan';
  onChangeConnectionMode: (mode: 'relay' | 'direct_lan') => void;
  customWsUrl: string;
  onChangeCustomWsUrl: (url: string) => void;
  role: 'controller' | 'receiver';
  onChangeRole: (role: 'controller' | 'receiver') => void;
  roomPeers: { role: string; deviceName: string }[];
  errorMessage: string | null;
  history: ConnectionHistoryItem[];
  discoveredReceivers: DiscoveredReceiver[];
  isScanning: boolean;
  onScanForReceivers: () => void;
  onConnect: (opts?: {
    mode?: 'relay' | 'direct_lan';
    url?: string;
    code?: string;
    targetRole?: 'controller' | 'receiver';
  }) => void;
  onDisconnect: () => void;
  compatibilityInfo: NexoraCompatibilityResult | null;
  adapterStatus: BluetoothAdapterStatus;
  hidRegistrationStatus: HidRegistrationStatus;
  isDiscoverable: boolean;
  btStatus: BluetoothConnectionStatus;
  btDeviceName: string;
  btError: string | null;
  pairedHosts: PairedBluetoothHost[];
  btReportsSent: number;
  lastHidReport: EncodedHidReport;
  selectedHostPlatform: HostPlatformId;
  onSelectHostPlatform: (id: HostPlatformId) => void;
  activeHostCompatibility: HostCompatibilityProfile;
  onRegisterNativeHid: () => void;
  onStartBluetoothPairing: () => void;
  onOpenBluetoothSettings: () => void;
  onRefreshPairedHosts: () => void;
  onConnectNativeHidHost: (host: PairedBluetoothHost) => void;
  onReconnectLastHost: () => void;
  onForgetBluetoothHost: (address: string) => void;
  onDisconnectBluetooth: () => void;
  controllerState: ControllerState;
  remoteReceivedState: ControllerState;
  lastPacketJson: string;
  verificationTests: VerificationSuiteState;
  onMarkTestVerified: (key: keyof VerificationSuiteState, value: boolean) => void;
  liveTestHudOpen: boolean;
  onToggleLiveTestHud: (open: boolean) => void;
  profile: ControllerProfile;
  savedProfiles: ControllerProfile[];
  onUpdateProfile: (partial: Partial<ControllerProfile>) => void;
  onSaveNewProfile: (name: string) => void;
  onSelectSavedProfile: (id: string) => void;
  onResetDefaultProfile: () => void;
  onToggleFullscreen: () => void;
}

export const ControlCenterDrawer: React.FC<ControlCenterDrawerProps> = ({
  activeTab,
  onSelectTab,
  onClose,
  status,
  connectedDeviceName,
  latencyMs,
  messagesPerSecond,
  autoReconnect,
  onToggleAutoReconnect,
  roomCode,
  onChangeRoomCode,
  connectionMode,
  onChangeConnectionMode,
  customWsUrl,
  onChangeCustomWsUrl,
  role,
  onChangeRole,
  errorMessage,
  discoveredReceivers,
  isScanning,
  onScanForReceivers,
  onConnect,
  onDisconnect,
  adapterStatus,
  hidRegistrationStatus,
  isDiscoverable,
  btStatus,
  btDeviceName,
  btError,
  pairedHosts,
  lastHidReport,
  selectedHostPlatform,
  onSelectHostPlatform,
  onRegisterNativeHid,
  onStartBluetoothPairing,
  onOpenBluetoothSettings,
  onRefreshPairedHosts,
  onConnectNativeHidHost,
  onReconnectLastHost,
  onForgetBluetoothHost,
  onDisconnectBluetooth,
  controllerState,
  remoteReceivedState,
  onToggleLiveTestHud,
  profile,
  savedProfiles,
  onUpdateProfile,
  onSaveNewProfile,
  onSelectSavedProfile,
  onResetDefaultProfile,
  onToggleFullscreen,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  if (activeTab === 'none') return null;

  const currentTab =
    activeTab === 'qr_pair' || activeTab === 'platforms' || activeTab === 'windows_receiver'
      ? 'connect'
      : activeTab;

  const pairingUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?pair=${encodeURIComponent(roomCode)}`
      : `http://localhost:3000/?pair=${roomCode}`;

  const handleCopyPairUrl = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const inspectedState = role === 'receiver' ? remoteReceivedState : controllerState;

  const handleCalibrateCenterZero = () => {
    onUpdateProfile({
      calibration: {
        leftOffsetX: Number((-inspectedState.axes.leftX).toFixed(3)),
        leftOffsetY: Number((-inspectedState.axes.leftY).toFixed(3)),
        rightOffsetX: Number((-inspectedState.axes.rightX).toFixed(3)),
        rightOffsetY: Number((-inspectedState.axes.rightY).toFixed(3)),
      },
    });
  };

  const handleResetCalibration = () => {
    onUpdateProfile({
      calibration: {
        leftOffsetX: 0,
        leftOffsetY: 0,
        rightOffsetX: 0,
        rightOffsetY: 0,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 select-none">
      <div className="w-full max-w-4xl max-h-[88vh] bg-[#0c0d12] border border-zinc-800 sm:rounded-2xl flex flex-col overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.95)]">
        {/* Top Navigation Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#11131a] border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {[
              { id: 'connect', label: 'Connect', icon: Bluetooth },
              { id: 'test', label: 'Controller Test', icon: Activity },
              { id: 'customize', label: 'RGB & Layout', icon: Sliders },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id as ActiveModalTab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)]'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* TAB 1: BLUETOOTH & CONNECT */}
          {currentTab === 'connect' && (
            <div className="space-y-4">
              {/* Bluetooth HID Card */}
              <div className="p-4 rounded-xl bg-[#13151d] border border-blue-500/35 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bluetooth className="w-4 h-4 text-blue-400" />
                    <h2 className="text-sm font-bold text-white">
                      {CONTROLLER_BLUETOOTH_IDENTITY} (Bluetooth HID)
                    </h2>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold font-mono-tabular ${
                      btStatus === 'CONNECTED_NATIVE_HID'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : btStatus === 'CONNECTING'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        btStatus === 'CONNECTED_NATIVE_HID'
                          ? 'bg-emerald-400'
                          : btStatus === 'CONNECTING'
                          ? 'bg-amber-400 animate-ping'
                          : 'bg-zinc-500'
                      }`}
                    />
                    {btStatus === 'CONNECTED_NATIVE_HID' ? 'CONNECTED' : btStatus}
                  </span>
                </div>

                {/* Compact Status Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2.5 rounded-lg bg-[#090a0f] border border-zinc-800">
                    <div className="text-[10px] uppercase text-zinc-400 font-bold">Bluetooth</div>
                    <div
                      className={`text-xs font-bold font-mono-tabular mt-0.5 ${
                        adapterStatus === 'ENABLED' ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {adapterStatus}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#090a0f] border border-zinc-800">
                    <div className="text-[10px] uppercase text-zinc-400 font-bold">HID Profile</div>
                    <div
                      className={`text-xs font-bold font-mono-tabular mt-0.5 ${
                        hidRegistrationStatus === 'REGISTERED' ? 'text-emerald-400' : 'text-zinc-400'
                      }`}
                    >
                      {hidRegistrationStatus}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#090a0f] border border-zinc-800">
                    <div className="text-[10px] uppercase text-zinc-400 font-bold">Visibility</div>
                    <div
                      className={`text-xs font-bold font-mono-tabular mt-0.5 ${
                        isDiscoverable ? 'text-pink-400' : 'text-zinc-400'
                      }`}
                    >
                      {isDiscoverable ? 'DISCOVERABLE' : 'HIDDEN'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#090a0f] border border-zinc-800">
                    <div className="text-[10px] uppercase text-zinc-400 font-bold">Host</div>
                    <div className="text-xs font-bold text-white mt-0.5 truncate">
                      {btDeviceName}
                    </div>
                  </div>
                </div>

                {/* Target Host Preset Buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {HOST_COMPATIBILITY_PROFILES.map((plat) => (
                    <button
                      key={plat.id}
                      onClick={() => {
                        onSelectHostPlatform(plat.id);
                        onUpdateProfile({ layoutPreset: plat.recommendedLayout });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        selectedHostPlatform === plat.id
                          ? 'bg-blue-600/25 border-blue-500 text-white'
                          : 'bg-[#090a0e] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {plat.name}
                    </button>
                  ))}
                </div>

                {btError && (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{btError}</span>
                  </div>
                )}

                {/* Bluetooth Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={onRegisterNativeHid}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Bluetooth className="w-3.5 h-3.5" />
                    Register Gamepad
                  </button>

                  <button
                    onClick={onStartBluetoothPairing}
                    className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Radar className="w-3.5 h-3.5" />
                    Start Pairing
                  </button>

                  <button
                    onClick={onOpenBluetoothSettings}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    BT Settings
                  </button>

                  <button
                    onClick={onRefreshPairedHosts}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Paired Devices
                  </button>

                  <button
                    onClick={onReconnectLastHost}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold"
                  >
                    Reconnect
                  </button>

                  {btStatus === 'CONNECTED_NATIVE_HID' && (
                    <button
                      onClick={onDisconnectBluetooth}
                      className="px-3 py-2 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-500/40 text-red-200 text-xs font-semibold"
                    >
                      Disconnect
                    </button>
                  )}

                  <button
                    onClick={() => {
                      onToggleLiveTestHud(true);
                      onClose();
                    }}
                    className="ml-auto px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Test Controller
                  </button>
                </div>

                {/* Paired Hosts List */}
                {pairedHosts.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-zinc-800">
                    {pairedHosts.map((host) => (
                      <div
                        key={host.address}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-[#090a0f] border border-zinc-800"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="text-xs font-bold text-white truncate">{host.name}</div>
                          <div className="text-[10px] font-mono-tabular text-zinc-400">
                            {host.address}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => onConnectNativeHidHost(host)}
                            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                          >
                            {host.isConnected ? 'Connected' : 'Connect'}
                          </button>
                          <button
                            onClick={() => onForgetBluetoothHost(host.address)}
                            className="p-1.5 rounded bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-300"
                            title="Forget Device"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Wi-Fi / LAN Connection & QR Pair */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-8 p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-pink-400" />
                      Wi-Fi / LAN Connection
                    </h3>
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoReconnect}
                        onChange={(e) => onToggleAutoReconnect(e.target.checked)}
                        className="accent-pink-500 rounded"
                      />
                      Auto-Reconnect
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-1 bg-[#0b0c10] rounded-lg border border-zinc-800">
                    <button
                      onClick={() => onChangeConnectionMode('relay')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
                        connectionMode === 'relay'
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Room Code / QR
                    </button>
                    <button
                      onClick={() => onChangeConnectionMode('direct_lan')}
                      className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
                        connectionMode === 'direct_lan'
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Direct LAN IP
                    </button>
                  </div>

                  {connectionMode === 'relay' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        maxLength={8}
                        value={roomCode}
                        onChange={(e) => onChangeRoomCode(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-lg bg-[#090a0e] border border-zinc-700 text-white font-mono-tabular text-sm uppercase tracking-widest focus:border-pink-500 focus:outline-none"
                        placeholder="GVOLT1"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => {
                            onChangeRole('controller');
                            onConnect({ mode: 'relay', targetRole: 'controller' });
                          }}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold border ${
                            role === 'controller'
                              ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                              : 'bg-[#090a0e] border-zinc-800 text-zinc-400'
                          }`}
                        >
                          Controller
                        </button>
                        <button
                          onClick={() => {
                            onChangeRole('receiver');
                            onConnect({ mode: 'relay', targetRole: 'receiver' });
                          }}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold border ${
                            role === 'receiver'
                              ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                              : 'bg-[#090a0e] border-zinc-800 text-zinc-400'
                          }`}
                        >
                          Receiver
                        </button>
                      </div>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={customWsUrl}
                      onChange={(e) => onChangeCustomWsUrl(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#090a0e] border border-zinc-700 text-white font-mono-tabular text-sm focus:border-pink-500 focus:outline-none"
                      placeholder="ws://192.168.1.100:8765"
                    />
                  )}

                  {errorMessage && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-300">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onConnect()}
                      className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {status === 'CONNECTED' ? 'Reconnect' : 'Connect'}
                    </button>

                    <button
                      onClick={onScanForReceivers}
                      disabled={isScanning}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
                    >
                      <Radar
                        className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-pink-400' : ''}`}
                      />
                      {isScanning ? 'Scanning...' : 'Scan LAN'}
                    </button>

                    {status === 'CONNECTED' && (
                      <button
                        onClick={onDisconnect}
                        className="px-3 py-2 rounded-lg bg-zinc-900 hover:bg-red-950/60 text-zinc-300 text-xs font-semibold"
                      >
                        Disconnect
                      </button>
                    )}

                    <div className="ml-auto text-xs font-mono-tabular text-zinc-400">
                      {status} · {latencyMs !== null ? `${latencyMs}ms` : '—'}
                    </div>
                  </div>

                  {discoveredReceivers.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                      {discoveredReceivers.map((rec) => (
                        <div
                          key={rec.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-[#090a0e] border border-zinc-800 text-xs"
                        >
                          <span className="text-zinc-200 font-medium">
                            {rec.name} ({rec.url})
                          </span>
                          <button
                            onClick={() => {
                              onChangeConnectionMode(rec.mode);
                              if (rec.mode === 'relay' && rec.roomCode) {
                                onChangeRoomCode(rec.roomCode);
                                onConnect({ mode: 'relay', code: rec.roomCode });
                              } else {
                                onChangeCustomWsUrl(rec.url);
                                onConnect({ mode: 'direct_lan', url: rec.url });
                              }
                            }}
                            className="px-2.5 py-1 rounded bg-pink-600 text-white font-semibold"
                          >
                            Pair
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Compact QR Card */}
                <div className="lg:col-span-4 p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 flex flex-col items-center justify-center text-center space-y-2.5">
                  <div className="flex items-center gap-1.5 text-pink-400 text-xs font-semibold">
                    <QrCode className="w-3.5 h-3.5" />
                    <span>QR Pair ({roomCode})</span>
                  </div>

                  <div className="p-2 bg-white rounded-xl">
                    <svg viewBox="0 0 120 120" className="w-24 h-24">
                      <rect width="120" height="120" fill="#ffffff" />
                      <path
                        d="M10,10 h30 v30 h-30 z M15,15 v20 h20 v-20 z M20,20 h10 v10 h-10 z
                           M80,10 h30 v30 h-30 z M85,15 v20 h20 v-20 z M90,20 h10 v10 h-10 z
                           M10,80 h30 v30 h-30 z M15,85 v20 h20 v-20 z M20,90 h10 v10 h-10 z"
                        fill="#090a0f"
                      />
                      {Array.from({ length: 64 }).map((_, idx) => {
                        const row = Math.floor(idx / 8);
                        const col = idx % 8;
                        const charCode =
                          roomCode.charCodeAt(idx % Math.max(1, roomCode.length)) || 69;
                        const bit = (charCode + idx * 7) % 3 !== 0;
                        const x = 44 + (col % 4) * 8;
                        const y = 14 + row * 11;
                        return bit ? (
                          <rect key={idx} x={x} y={y} width="6" height="6" rx="1" fill="#090a0f" />
                        ) : null;
                      })}
                      <rect x="46" y="46" width="28" height="28" rx="6" fill="#ec4899" />
                      <text
                        x="60"
                        y="64"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {roomCode.slice(0, 4)}
                      </text>
                    </svg>
                  </div>

                  <button
                    onClick={handleCopyPairUrl}
                    className="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5"
                  >
                    {copiedLink ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedLink ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONTROLLER TEST & DIAGNOSTICS */}
          {currentTab === 'test' && (
            <div className="space-y-4">
              {/* Compact Telemetry Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-[#13151d] border border-zinc-800/90">
                  <div className="text-[10px] text-zinc-400 uppercase font-bold">Connection</div>
                  <div
                    className={`text-xs font-bold font-mono-tabular mt-1 ${
                      status === 'CONNECTED' ? 'text-emerald-400' : 'text-zinc-400'
                    }`}
                  >
                    {status} ({connectedDeviceName})
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#13151d] border border-zinc-800/90">
                  <div className="text-[10px] text-zinc-400 uppercase font-bold">Bluetooth HID</div>
                  <div className="text-xs font-bold font-mono-tabular text-blue-400 mt-1">
                    {btStatus}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#13151d] border border-zinc-800/90">
                  <div className="text-[10px] text-zinc-400 uppercase font-bold">
                    HID Report (9B)
                  </div>
                  <div className="text-xs font-bold font-mono-tabular text-emerald-400 mt-1">
                    [{lastHidReport.rawHex}]
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#13151d] border border-zinc-800/90">
                  <div className="text-[10px] text-zinc-400 uppercase font-bold">
                    Latency / Rate
                  </div>
                  <div className="text-xs font-bold font-mono-tabular text-pink-400 mt-1">
                    {latencyMs !== null ? `${latencyMs}ms` : '—'} · {messagesPerSecond} msg/s
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-white">
                      Button, Stick & Trigger States
                    </h2>
                    <span className="text-xs font-mono-tabular px-2 py-0.5 rounded bg-zinc-800 text-pink-400">
                      D-Pad: {inspectedState.dpad}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onToggleLiveTestHud(true);
                      onClose();
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Live Test HUD
                  </button>
                </div>

                {/* Button Matrix */}
                <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                  {(
                    Object.keys(inspectedState.buttons) as Array<keyof ControllerState['buttons']>
                  ).map((btnKey) => {
                    const active = inspectedState.buttons[btnKey];
                    return (
                      <div
                        key={btnKey}
                        className={`p-2 rounded-lg border text-center transition-all ${
                          active
                            ? 'bg-pink-600/25 border-pink-500 text-white shadow-[0_0_12px_rgba(236,72,153,0.5)]'
                            : 'bg-[#090a0e] border-zinc-800 text-zinc-500'
                        }`}
                      >
                        <div className="text-xs font-bold">{btnKey}</div>
                        <div className="text-[10px] font-mono-tabular mt-0.5">
                          {active ? 'ON' : 'OFF'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Joysticks & Triggers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-[#090a0e] border border-zinc-800 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-semibold">Left Stick</span>
                      <span className="font-mono-tabular text-pink-400">
                        X: {inspectedState.axes.leftX.toFixed(2)} · Y:{' '}
                        {inspectedState.axes.leftY.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-pink-500"
                        style={{ width: `${((inspectedState.axes.leftX + 1) / 2) * 100}%` }}
                      />
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{ width: `${((inspectedState.axes.leftY + 1) / 2) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#090a0e] border border-zinc-800 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-semibold">Right Stick</span>
                      <span className="font-mono-tabular text-blue-400">
                        X: {inspectedState.axes.rightX.toFixed(2)} · Y:{' '}
                        {inspectedState.axes.rightY.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${((inspectedState.axes.rightX + 1) / 2) * 100}%` }}
                      />
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500"
                        style={{ width: `${((inspectedState.axes.rightY + 1) / 2) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-[#090a0e] border border-zinc-800">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400 font-semibold">LT Trigger</span>
                      <span className="font-mono-tabular text-purple-400">
                        {Math.round(inspectedState.axes.LT * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{ width: `${inspectedState.axes.LT * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#090a0e] border border-zinc-800">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400 font-semibold">RT Trigger</span>
                      <span className="font-mono-tabular text-blue-400">
                        {Math.round(inspectedState.axes.RT * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${inspectedState.axes.RT * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Calibration */}
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">
                    Joystick Center Calibration
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCalibrateCenterZero}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white"
                    >
                      Calibrate Center
                    </button>
                    <button
                      onClick={handleResetCalibration}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RGB & LAYOUT */}
          {currentTab === 'customize' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white">RGB Lighting & Layout</h2>
                  <button
                    onClick={onResetDefaultProfile}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-2">RGB Mode</label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { id: 'gamevolt', label: 'Game Volt' },
                      { id: 'reactive', label: 'Reactive' },
                      { id: 'rainbow', label: 'Rainbow' },
                      { id: 'breathing', label: 'Breathing' },
                      { id: 'static', label: 'Custom' },
                      { id: 'off', label: 'Off' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          onUpdateProfile({ rgbMode: m.id as ControllerProfile['rgbMode'] })
                        }
                        className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all ${
                          profile.rgbMode === m.id
                            ? 'bg-pink-600/20 border-pink-500 text-white'
                            : 'bg-[#090a0e] border-zinc-800 text-zinc-400'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090a0e] border border-zinc-800">
                  <span className="text-xs font-semibold text-zinc-300">Custom RGB Color</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={profile.customColor}
                      onChange={(e) =>
                        onUpdateProfile({
                          customColor: e.target.value,
                          rgbMode: 'static',
                        })
                      }
                      className="w-8 h-6 rounded cursor-pointer bg-transparent border border-zinc-700"
                    />
                    <span className="text-xs font-mono-tabular text-zinc-300">
                      {profile.customColor.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-2">
                    Button Layout
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'gamevolt', label: 'Standard (Y/X/B/A)' },
                      { id: 'xbox', label: 'Xbox (Y/X/B/A)' },
                      { id: 'playstation', label: 'PlayStation (△/□/○/✕)' },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() =>
                          onUpdateProfile({
                            layoutPreset: preset.id as ControllerProfile['layoutPreset'],
                          })
                        }
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-all ${
                          profile.layoutPreset === preset.id
                            ? 'bg-purple-600/20 border-purple-500 text-white'
                            : 'bg-[#090a0e] border-zinc-800 text-zinc-400'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400">Control Size</span>
                      <span className="font-mono-tabular text-white">
                        {Math.round(profile.buttonScale * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.85"
                      max="1.15"
                      step="0.05"
                      value={profile.buttonScale}
                      onChange={(e) => onUpdateProfile({ buttonScale: parseFloat(e.target.value) })}
                      className="w-full accent-pink-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400">Opacity</span>
                      <span className="font-mono-tabular text-white">
                        {Math.round(profile.buttonOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.05"
                      value={profile.buttonOpacity}
                      onChange={(e) =>
                        onUpdateProfile({ buttonOpacity: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400">Stick Deadzone</span>
                      <span className="font-mono-tabular text-white">
                        {Math.round(profile.joystickDeadzone * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="0.35"
                      step="0.02"
                      value={profile.joystickDeadzone}
                      onChange={(e) =>
                        onUpdateProfile({ joystickDeadzone: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-400">RGB Brightness</span>
                      <span className="font-mono-tabular text-white">
                        {Math.round(profile.rgbIntensity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="1.0"
                      step="0.05"
                      value={profile.rgbIntensity}
                      onChange={(e) =>
                        onUpdateProfile({ rgbIntensity: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 space-y-3">
                <h3 className="text-sm font-bold text-white">Profiles</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="New profile name"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#090a0e] border border-zinc-700 text-xs text-white"
                  />
                  <button
                    onClick={() => {
                      if (newProfileName.trim()) {
                        onSaveNewProfile(newProfileName.trim());
                        setNewProfileName('');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold"
                  >
                    Save
                  </button>
                </div>

                <div className="space-y-2">
                  {savedProfiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onSelectSavedProfile(p.id)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                        profile.id === p.id
                          ? 'bg-pink-600/15 border-pink-500 text-white'
                          : 'bg-[#090a0e] border-zinc-800 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <span className="text-xs font-bold">{p.name}</span>
                      {profile.id === p.id && (
                        <span className="text-[11px] font-semibold text-pink-400">Active</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CLEAN, MINIMAL SETTINGS */}
          {currentTab === 'settings' && (
            <div className="max-w-xl mx-auto p-4 rounded-xl bg-[#13151d] border border-zinc-800/90 space-y-3">
              <h3 className="text-sm font-bold text-white">Settings</h3>

              {[
                {
                  label: 'Haptic Vibration',
                  value: profile.hapticsEnabled,
                  onToggle: () => onUpdateProfile({ hapticsEnabled: !profile.hapticsEnabled }),
                },
                {
                  label: 'Low-Latency Mode',
                  value: profile.lowLatencyMode,
                  onToggle: () => onUpdateProfile({ lowLatencyMode: !profile.lowLatencyMode }),
                },
                {
                  label: 'Battery Saver',
                  value: profile.batterySaverMode,
                  onToggle: () =>
                    onUpdateProfile({
                      batterySaverMode: !profile.batterySaverMode,
                      rgbMode: !profile.batterySaverMode ? 'reactive' : 'gamevolt',
                    }),
                },
              ].map((setting, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#090a0e] border border-zinc-800"
                >
                  <span className="text-xs font-semibold text-white">{setting.label}</span>
                  <button
                    onClick={setting.onToggle}
                    className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                      setting.value ? 'bg-pink-600' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        setting.value ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  onClick={onToggleFullscreen}
                  className="py-2.5 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white flex items-center justify-center gap-2"
                >
                  <Maximize2 className="w-4 h-4" />
                  Fullscreen
                </button>

                <button
                  onClick={onResetDefaultProfile}
                  className="py-2.5 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Defaults
                </button>
              </div>

              {!isInstalled && (isInstallable || isIOS) && (
                <button
                  onClick={install}
                  className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 text-xs font-bold text-white flex items-center justify-center gap-2 shadow-lg"
                >
                  <Smartphone className="w-4 h-4" />
                  Install App
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
