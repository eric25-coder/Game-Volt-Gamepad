export type DpadDirection =
  | 'CENTER'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'UP_LEFT'
  | 'UP_RIGHT'
  | 'DOWN_LEFT'
  | 'DOWN_RIGHT';

export interface ControllerButtons {
  A: boolean;
  B: boolean;
  X: boolean;
  Y: boolean;
  LB: boolean;
  RB: boolean;
  LT: boolean;
  RT: boolean;
  View: boolean;
  Menu: boolean;
  Home: boolean;
  L3: boolean;
  R3: boolean;
}

export interface ControllerAxes {
  leftX: number; // -1.0 to 1.0
  leftY: number; // -1.0 to 1.0
  rightX: number; // -1.0 to 1.0
  rightY: number; // -1.0 to 1.0
  LT: number; // 0.0 to 1.0
  RT: number; // 0.0 to 1.0
}

export interface ControllerState {
  buttons: ControllerButtons;
  axes: ControllerAxes;
  dpad: DpadDirection;
}

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export type ReceiverStatus =
  | 'DISCONNECTED'
  | 'RELAY_WAITING'
  | 'CONNECTED_WEB_HOST'
  | 'CONNECTED_WINDOWS_VIGEM';

export type VigemDriverStatus =
  | 'UNVERIFIED'
  | 'WEB_RECEIVER'
  | 'DRIVER_MISSING'
  | 'CONNECTED';

export type RGBMode = 'gamevolt' | 'reactive' | 'rainbow' | 'breathing' | 'static' | 'off';

export type LayoutPreset = 'gamevolt' | 'xbox' | 'playstation';

export interface AxisCalibration {
  leftOffsetX: number;
  leftOffsetY: number;
  rightOffsetX: number;
  rightOffsetY: number;
}

export interface ControllerProfile {
  id: string;
  name: string;
  layoutPreset: LayoutPreset;
  buttonScale: number; // 0.85 to 1.2
  buttonOpacity: number; // 0.5 to 1.0
  joystickDeadzone: number; // 0.0 to 0.35
  joystickSensitivity: number; // 0.5 to 2.0
  triggerSensitivity: number; // 0.5 to 2.0
  rgbMode: RGBMode;
  rgbIntensity: number; // 0.2 to 1.0
  customColor: string;
  hapticsEnabled: boolean;
  lowLatencyMode: boolean;
  batterySaverMode: boolean;
  stickRestOffset: boolean;
  brandHeaderText: string;
  calibration: AxisCalibration;
}

export interface ConnectionHistoryItem {
  id: string;
  name: string;
  url: string;
  roomCode: string;
  mode: 'relay' | 'direct_lan';
  lastConnected: number;
}

export interface DiscoveredReceiver {
  id: string;
  name: string;
  url: string;
  roomCode?: string;
  mode: 'relay' | 'direct_lan';
  vigemStatus: string;
}

export interface VerificationSuiteState {
  test1_phoneConnected: boolean;
  test2_receiverEventsConfirmed: boolean;
  test3_virtualGamepadConfirmed: boolean;
  test4_joyCplVerified: boolean;
  test5_gameResponseVerified: boolean;
  test6_disconnectFailsafeVerified: boolean;
  test7_reconnectRestoredVerified: boolean;
  test8_simultaneousInputsVerified: boolean;
}

export type ActiveModalTab =
  | 'none'
  | 'connect'
  | 'qr_pair'
  | 'test'
  | 'customize'
  | 'windows_receiver'
  | 'platforms'
  | 'settings';
