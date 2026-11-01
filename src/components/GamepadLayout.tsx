import React, { useEffect, useRef, useState } from 'react';
import { DomeButton } from './GamepadButton';
import { Joystick } from './Joystick';
import {
  ActiveModalTab,
  ConnectionStatus,
  ControllerProfile,
  ControllerState,
  DpadDirection,
} from '../types';

interface GamepadLayoutProps {
  controllerState: ControllerState;
  status: ConnectionStatus;
  latencyMs: number | null;
  profile: ControllerProfile;
  onButtonChange: (
    button: keyof ControllerState['buttons'],
    pressed: boolean,
    analogValue?: number
  ) => void;
  onStickMove: (side: 'left' | 'right', x: number, y: number) => void;
  onDpadChange: (direction: DpadDirection) => void;
  onOpenModal: (tab: ActiveModalTab) => void;
  onOpenKeyboardMouse: (mode: 'keyboard' | 'mouse') => void;
}

interface ShoulderTriggerProps {
  label: 'LT' | 'LB' | 'RT' | 'RB';
  side: 'left' | 'right';
  isTop: boolean;
  glowColor: string;
  hapticsEnabled: boolean;
  onPressChange: (pressed: boolean, analogPressure: number) => void;
}

const ErgonomicTriggerButton: React.FC<ShoulderTriggerProps> = ({
  label,
  side,
  isTop,
  glowColor,
  hapticsEnabled,
  onPressChange,
}) => {
  const [pressed, setPressed] = useState(false);
  const pointerIdRef = useRef<number | null>(null);

  const computePressure = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isTop) return 1;
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return Math.min(1, Math.max(0.75, 0.5 + relY * 0.6));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    const p = computePressure(e);
    setPressed(true);
    onPressChange(true, p);
    if (hapticsEnabled && navigator.vibrate) navigator.vibrate(14);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId || !isTop) return;
    const p = computePressure(e);
    onPressChange(true, p);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setPressed(false);
    onPressChange(false, 0);
  };

  const pathData =
    side === 'left'
      ? isTop
        ? 'M 12,4 L 92,4 Q 100,4 97,14 L 74,116 Q 71,126 60,126 L 12,126 Q 4,126 4,116 L 4,14 Q 4,4 12,4 Z'
        : 'M 12,4 L 60,4 Q 71,4 74,14 L 97,120 Q 100,130 92,130 L 12,130 Q 4,130 4,120 L 4,14 Q 4,4 12,4 Z'
      : isTop
      ? 'M 8,4 L 88,4 Q 96,4 96,14 L 96,116 Q 96,126 88,126 L 40,126 Q 29,126 26,116 L 3,14 Q 0,4 8,4 Z'
      : 'M 40,4 L 88,4 Q 96,4 96,14 L 96,120 Q 96,130 88,130 L 8,130 Q 0,130 3,120 L 26,14 Q 29,4 40,4 Z';

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      className={`relative w-full h-full flex items-center justify-center select-none touch-none transition-transform duration-75 ${
        pressed ? 'scale-[0.95]' : 'scale-100'
      }`}
      style={{
        filter: pressed
          ? `drop-shadow(0 0 16px ${glowColor})`
          : 'drop-shadow(0 5px 10px rgba(0,0,0,0.92))',
      }}
    >
      <svg
        viewBox="0 0 100 134"
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible pointer-events-none"
      >
        <defs>
          <linearGradient id={`grad-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={pressed ? '#3b3f4a' : '#2c2f36'} />
            <stop offset="55%" stopColor={pressed ? '#24272f' : '#1b1d22'} />
            <stop offset="100%" stopColor="#101215" />
          </linearGradient>
          <linearGradient id={`bevel-${label}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={pressed ? glowColor : '#555963'} />
            <stop offset="50%" stopColor={pressed ? glowColor : '#2c2f36'} />
            <stop offset="100%" stopColor={pressed ? glowColor : '#424650'} />
          </linearGradient>
        </defs>

        <path
          d={pathData}
          fill="#050608"
          stroke={pressed ? glowColor : '#040406'}
          strokeWidth="6"
          strokeLinejoin="round"
        />

        <path
          d={pathData}
          fill={`url(#grad-${label})`}
          stroke={`url(#bevel-${label})`}
          strokeWidth={pressed ? '3' : '2'}
          strokeLinejoin="round"
        />

        <text
          x={side === 'left' ? '40' : '60'}
          y="72"
          textAnchor="middle"
          fill={pressed ? '#ffffff' : '#8e929b'}
          fontSize="23"
          fontWeight="700"
          fontFamily="Plus Jakarta Sans, sans-serif"
          style={{
            filter: pressed ? `drop-shadow(0 0 8px ${glowColor})` : 'none',
          }}
        >
          {label}
        </text>
      </svg>
    </button>
  );
};

export const GamepadLayout: React.FC<GamepadLayoutProps> = ({
  controllerState,
  status,
  latencyMs,
  profile,
  onButtonChange,
  onStickMove,
  onDpadChange,
  onOpenModal,
  onOpenKeyboardMouse,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dpadRef = useRef<HTMLDivElement>(null);
  const dpadPointerId = useRef<number | null>(null);
  const [gyroEnabled, setGyroEnabled] = useState(false);

  // Measure the exact visible phone screen dimensions via ResizeObserver + visualViewport
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 844,
    h: typeof window !== 'undefined' ? window.innerHeight : 390,
  }));

  useEffect(() => {
    const updateSize = () => {
      if (rootRef.current) {
        setViewport({
          w: rootRef.current.clientWidth || window.innerWidth,
          h: rootRef.current.clientHeight || window.innerHeight,
        });
      } else {
        setViewport({
          w: window.visualViewport?.width ?? window.innerWidth,
          h: window.visualViewport?.height ?? window.innerHeight,
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener('resize', updateSize);
    window.visualViewport?.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
      window.visualViewport?.removeEventListener('resize', updateSize);
    };
  }, []);

  // Automatically rotate 90deg when the phone is in portrait orientation so the landscape controller
  // always fits 100% of the physical phone screen without shrinking or clipping
  const isPortraitViewport = viewport.h > viewport.w;
  const landW = isPortraitViewport ? viewport.h : viewport.w;
  const landH = isPortraitViewport ? viewport.w : viewport.h;

  // Compute proportional height unit so all controls fit cleanly within 0%..100% of phone height & width
  const hUnit = Math.min(landH, landW * 0.46) / 100;
  const scale = profile.buttonScale;

  const dpadSize = Math.round(hUnit * 40 * scale);
  const viewMenuSize = Math.round(hUnit * 13 * scale);
  const centerRadialSize = Math.round(hUnit * 37 * scale);
  const abxySize = Math.round(hUnit * 15.5 * scale);
  const abxyOffsetX = Math.round(hUnit * 12.8 * scale);
  const abxyOffsetY = Math.round(hUnit * 13.2 * scale);
  const joystickSize = Math.round(hUnit * 32 * scale);
  const ltsRtsSize = Math.round(hUnit * 15 * scale);
  const dockWidth = Math.round(hUnit * 10.5 * scale);
  const dockHeight = Math.round(hUnit * 19.5 * scale);

  useEffect(() => {
    if (!gyroEnabled) return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const tilt = event.beta ?? event.gamma ?? 0;
      const clamped = Math.max(-1, Math.min(1, tilt / 35));
      onStickMove('left', clamped, controllerState.axes.leftY);
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      onStickMove('left', 0, 0);
    };
  }, [gyroEnabled, controllerState.axes.leftY, onStickMove]);

  const computeDpadFromPointer = (clientX: number, clientY: number): DpadDirection => {
    const rect = dpadRef.current?.getBoundingClientRect();
    if (!rect) return 'CENTER';

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const screenDX = clientX - cx;
    const screenDY = clientY - cy;

    const dx = isPortraitViewport ? screenDY : screenDX;
    const dy = isPortraitViewport ? -screenDX : screenDY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < Math.min(rect.width, rect.height) * 0.12) return 'CENTER';

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg >= -22.5 && angleDeg < 22.5) return 'RIGHT';
    if (angleDeg >= 22.5 && angleDeg < 67.5) return 'DOWN_RIGHT';
    if (angleDeg >= 67.5 && angleDeg < 112.5) return 'DOWN';
    if (angleDeg >= 112.5 && angleDeg < 157.5) return 'DOWN_LEFT';
    if (angleDeg >= 157.5 || angleDeg < -157.5) return 'LEFT';
    if (angleDeg >= -157.5 && angleDeg < -112.5) return 'UP_LEFT';
    if (angleDeg >= -112.5 && angleDeg < -67.5) return 'UP';
    return 'UP_RIGHT';
  };

  const handleDpadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dpadPointerId.current = e.pointerId;
    const dir = computeDpadFromPointer(e.clientX, e.clientY);
    onDpadChange(dir);
    if (profile.hapticsEnabled && navigator.vibrate) navigator.vibrate(12);
  };

  const handleDpadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dpadPointerId.current !== e.pointerId) return;
    const dir = computeDpadFromPointer(e.clientX, e.clientY);
    if (dir !== controllerState.dpad) {
      onDpadChange(dir);
      if (profile.hapticsEnabled && navigator.vibrate) navigator.vibrate(6);
    }
  };

  const handleDpadUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dpadPointerId.current !== e.pointerId) return;
    dpadPointerId.current = null;
    onDpadChange('CENTER');
  };

  const dpadUpActive = controllerState.dpad.includes('UP');
  const dpadDownActive = controllerState.dpad.includes('DOWN');
  const dpadLeftActive = controllerState.dpad.includes('LEFT');
  const dpadRightActive = controllerState.dpad.includes('RIGHT');

  const isPlayStation = profile.layoutPreset === 'playstation';

  const rgbClass =
    profile.rgbMode === 'rainbow'
      ? 'animate-rgb-rainbow'
      : profile.rgbMode === 'breathing'
      ? 'animate-rgb-breathe'
      : '';

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 w-dvw h-dvh overflow-hidden select-none touch-none"
      style={{
        background:
          'radial-gradient(ellipse at 50% 42%, #13151a 0%, #0b0c0f 55%, #060608 100%)',
        opacity: profile.buttonOpacity,
      }}
    >
      {/* Absolute-centered Landscape Stage (Never squished by Flexbox when rotated on a phone) */}
      <div
        className="absolute top-1/2 left-1/2 overflow-hidden select-none touch-none"
        style={{
          width: `${landW}px`,
          height: `${landH}px`,
          transform: isPortraitViewport
            ? 'translate(-50%, -50%) rotate(90deg)'
            : 'translate(-50%, -50%)',
          transformOrigin: 'center center',
        }}
      >
        {/* Left & Right Curved Glossy Controller Chassis Side Edges */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-2 z-20"
          style={{
            background: 'linear-gradient(90deg, #262930 0%, #0d0e12 65%, transparent 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-2 z-20"
          style={{
            background: 'linear-gradient(270deg, #262930 0%, #0d0e12 65%, transparent 100%)',
          }}
        />

        {/* Top Metallic Bevel Hairline Across Entire Width */}
        <div
          className="pointer-events-none absolute top-0 inset-x-0 h-[2px] z-20"
          style={{
            background:
              'linear-gradient(90deg, #1b1d22 0%, #5c6068 25%, #9ca0a8 50%, #5c6068 75%, #1b1d22 100%)',
          }}
        />

        {/* 1. TOP-CENTER GAMEVOLT TRAPEZOIDAL HEADER */}
        <div
          onClick={() => onOpenModal('connect')}
          style={{
            left: '50%',
            top: '0%',
            width: '35%',
            height: '15.5%',
          }}
          className={`absolute -translate-x-1/2 z-10 cursor-pointer flex items-center justify-center ${rgbClass}`}
        >
          <svg
            viewBox="0 0 440 92"
            preserveAspectRatio="none"
            className="w-full h-full overflow-visible"
          >
            <defs>
              <linearGradient id="gamevoltTrapStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                  offset="0%"
                  stopColor={profile.rgbMode === 'static' ? profile.customColor : '#ff007f'}
                />
                <stop
                  offset="35%"
                  stopColor={profile.rgbMode === 'static' ? profile.customColor : '#ff006a'}
                />
                <stop
                  offset="75%"
                  stopColor={profile.rgbMode === 'static' ? profile.customColor : '#7e22ce'}
                />
                <stop
                  offset="100%"
                  stopColor={profile.rgbMode === 'static' ? profile.customColor : '#3b0764'}
                />
              </linearGradient>
              <linearGradient id="gamevoltTrapFill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#16181d" />
                <stop offset="100%" stopColor="#101216" />
              </linearGradient>
            </defs>

            {profile.rgbMode !== 'off' && (
              <path
                d="M 6,1 L 44,68 Q 56,84 82,84 L 358,84 Q 384,84 396,68 L 434,1"
                fill="none"
                stroke="url(#gamevoltTrapStroke)"
                strokeWidth="7"
                strokeLinecap="round"
                style={{
                  filter: 'blur(5px)',
                  opacity: profile.rgbIntensity * 0.9,
                }}
              />
            )}

            <path
              d="M 6,1 L 44,68 Q 56,84 82,84 L 358,84 Q 384,84 396,68 L 434,1"
              fill="url(#gamevoltTrapFill)"
              stroke={profile.rgbMode === 'off' ? '#272a30' : 'url(#gamevoltTrapStroke)'}
              strokeWidth="4.5"
              strokeLinecap="round"
            />

            {/* Engraved GAMEVOLT Wordmark */}
            <g transform="translate(220, 40)">
              <text
                x="-14"
                y="5"
                textAnchor="end"
                fill="#050608"
                fontSize="20"
                fontWeight="700"
                letterSpacing="3.5"
                fontFamily="Orbitron, sans-serif"
              >
                GAME
              </text>
              <path
                d="M-8,-7 H8 L5,-3.5 H-8 Z M-3,-1.5 H13 L10,2 H-3 Z M-8,4 H6 L3,7.5 H-8 Z"
                fill="#050608"
              />
              <text
                x="17"
                y="5"
                textAnchor="start"
                fill="#050608"
                fontSize="20"
                fontWeight="700"
                letterSpacing="3.5"
                fontFamily="Orbitron, sans-serif"
              >
                VOLT
              </text>
            </g>
          </svg>
        </div>

        {/* 2. TOP-RIGHT GREEN STATUS LED DOT */}
        <button
          type="button"
          onClick={() => onOpenModal('connect')}
          style={{
            left: '91.5%',
            top: '4.8%',
            width: `${Math.max(18, Math.round(hUnit * 4.5))}px`,
            height: `${Math.max(18, Math.round(hUnit * 4.5))}px`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center cursor-pointer"
          title={status === 'CONNECTED' ? `Connected (${latencyMs ?? 1}ms)` : 'Click to Connect'}
        >
          <span
            className="w-[42%] h-[42%] rounded-full transition-all"
            style={{
              backgroundColor:
                status === 'CONNECTED'
                  ? '#34d399'
                  : status === 'CONNECTING'
                  ? '#fbbf24'
                  : '#ef4444',
              boxShadow:
                status === 'CONNECTED'
                  ? '0 0 10px 2px rgba(52, 211, 153, 0.9)'
                  : status === 'CONNECTING'
                  ? '0 0 10px 2px rgba(251, 191, 36, 0.9)'
                  : '0 0 8px 1px rgba(239, 68, 68, 0.75)',
            }}
          />
        </button>

        {/* 3. LEFT TRIGGERS: LT & LB */}
        <div
          style={{
            left: '1.5%',
            top: '9%',
            width: '8.8%',
            height: '23%',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="absolute z-10"
        >
          <ErgonomicTriggerButton
            label="LT"
            side="left"
            isTop={true}
            glowColor="#a855f7"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(pressed, pressure) => onButtonChange('LT', pressed, pressure)}
          />
        </div>

        <div
          style={{
            left: '1.5%',
            top: '35%',
            width: '8.8%',
            height: '24%',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="absolute z-10"
        >
          <ErgonomicTriggerButton
            label="LB"
            side="left"
            isTop={false}
            glowColor="#a855f7"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(pressed, pressure) => onButtonChange('LB', pressed, pressure)}
          />
        </div>

        {/* 4. RIGHT TRIGGERS: RT & RB */}
        <div
          style={{
            right: '1.5%',
            top: '9%',
            width: '8.8%',
            height: '23%',
            transform: `scale(${scale})`,
            transformOrigin: 'top right',
          }}
          className="absolute z-10"
        >
          <ErgonomicTriggerButton
            label="RT"
            side="right"
            isTop={true}
            glowColor="#3b82f6"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(pressed, pressure) => onButtonChange('RT', pressed, pressure)}
          />
        </div>

        <div
          style={{
            right: '1.5%',
            top: '35%',
            width: '8.8%',
            height: '24%',
            transform: `scale(${scale})`,
            transformOrigin: 'top right',
          }}
          className="absolute z-10"
        >
          <ErgonomicTriggerButton
            label="RB"
            side="right"
            isTop={false}
            glowColor="#3b82f6"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(pressed, pressure) => onButtonChange('RB', pressed, pressure)}
          />
        </div>

        {/* 5. CIRCULAR BRUSHED-METAL D-PAD */}
        <div
          ref={dpadRef}
          onPointerDown={handleDpadDown}
          onPointerMove={handleDpadMove}
          onPointerUp={handleDpadUpOrCancel}
          onPointerCancel={handleDpadUpOrCancel}
          style={{
            left: '21.2%',
            top: '33%',
            width: `${dpadSize}px`,
            height: `${dpadSize}px`,
            transform: 'translate(-50%, -50%)',
            background:
              'linear-gradient(145deg, #c2c6ce 0%, #7a7e87 32%, #292c32 72%, #111317 100%)',
            boxShadow:
              '0 8px 20px rgba(0,0,0,0.95), 0 0 0 3px #060709, inset 0 2px 3px rgba(255,255,255,0.45)',
          }}
          className="absolute rounded-full flex items-center justify-center z-10 touch-none select-none cursor-pointer"
        >
          <div
            className="w-[87%] h-[87%] rounded-full relative flex items-center justify-center pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 42% 38%, #636770 0%, #373a42 52%, #1b1d22 88%, #101215 100%)',
              boxShadow: 'inset 0 5px 12px rgba(0,0,0,0.85), 0 1px 2px rgba(255,255,255,0.2)',
            }}
          >
            {/* UP Paddle */}
            <div
              className="absolute top-[5%] left-1/2 -translate-x-1/2 w-[31%] h-[36%] rounded-t-[28%] rounded-b-[16%] flex items-start justify-center pt-[6%] transition-all duration-75"
              style={{
                background: dpadUpActive
                  ? 'linear-gradient(180deg, #38bdf8 0%, #1e293b 100%)'
                  : 'linear-gradient(145deg, #9ca0a9 0%, #3b3e46 50%, #181a1f 100%)',
                boxShadow: dpadUpActive
                  ? '0 0 16px 3px rgba(255,255,255,0.85)'
                  : '0 4px 8px rgba(0,0,0,0.85)',
                padding: '2px',
              }}
            >
              <div
                className="w-full h-full rounded-t-[24%] rounded-b-[12%] flex items-start justify-center pt-[12%]"
                style={{
                  background: 'linear-gradient(180deg, #121418 0%, #24272e 100%)',
                  boxShadow: 'inset 0 3px 5px rgba(0,0,0,0.9)',
                }}
              >
                <svg viewBox="0 0 24 12" className="w-[46%] h-[28%]">
                  <path
                    d="M3,9 L12,3 L21,9"
                    fill="none"
                    stroke={dpadUpActive ? '#ffffff' : '#8b909a'}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {/* DOWN Paddle */}
            <div
              className="absolute bottom-[5%] left-1/2 -translate-x-1/2 w-[31%] h-[36%] rounded-b-[28%] rounded-t-[16%] flex items-end justify-center pb-[6%] transition-all duration-75"
              style={{
                background: dpadDownActive
                  ? 'linear-gradient(0deg, #38bdf8 0%, #1e293b 100%)'
                  : 'linear-gradient(145deg, #9ca0a9 0%, #3b3e46 50%, #181a1f 100%)',
                boxShadow: dpadDownActive
                  ? '0 0 16px 3px rgba(255,255,255,0.85)'
                  : '0 4px 8px rgba(0,0,0,0.85)',
                padding: '2px',
              }}
            >
              <div
                className="w-full h-full rounded-b-[24%] rounded-t-[12%] flex items-end justify-center pb-[12%]"
                style={{
                  background: 'linear-gradient(180deg, #24272e 0%, #121418 100%)',
                  boxShadow: 'inset 0 -3px 5px rgba(0,0,0,0.9)',
                }}
              >
                <svg viewBox="0 0 24 12" className="w-[46%] h-[28%]">
                  <path
                    d="M3,3 L12,9 L21,3"
                    fill="none"
                    stroke={dpadDownActive ? '#ffffff' : '#8b909a'}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {/* LEFT Paddle */}
            <div
              className="absolute left-[5%] top-1/2 -translate-y-1/2 w-[36%] h-[31%] rounded-l-[28%] rounded-r-[16%] flex items-center justify-start pl-[6%] transition-all duration-75"
              style={{
                background: dpadLeftActive
                  ? 'linear-gradient(90deg, #38bdf8 0%, #1e293b 100%)'
                  : 'linear-gradient(145deg, #9ca0a9 0%, #3b3e46 50%, #181a1f 100%)',
                boxShadow: dpadLeftActive
                  ? '0 0 16px 3px rgba(255,255,255,0.85)'
                  : '0 4px 8px rgba(0,0,0,0.85)',
                padding: '2px',
              }}
            >
              <div
                className="w-full h-full rounded-l-[24%] rounded-r-[12%] flex items-center justify-start pl-[12%]"
                style={{
                  background: 'linear-gradient(90deg, #121418 0%, #24272e 100%)',
                  boxShadow: 'inset 3px 0 5px rgba(0,0,0,0.9)',
                }}
              >
                <svg viewBox="0 0 12 24" className="w-[28%] h-[46%]">
                  <path
                    d="M9,3 L3,12 L9,21"
                    fill="none"
                    stroke={dpadLeftActive ? '#ffffff' : '#8b909a'}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {/* RIGHT Paddle */}
            <div
              className="absolute right-[5%] top-1/2 -translate-y-1/2 w-[36%] h-[31%] rounded-r-[28%] rounded-l-[16%] flex items-center justify-end pr-[6%] transition-all duration-75"
              style={{
                background: dpadRightActive
                  ? 'linear-gradient(270deg, #38bdf8 0%, #1e293b 100%)'
                  : 'linear-gradient(145deg, #9ca0a9 0%, #3b3e46 50%, #181a1f 100%)',
                boxShadow: dpadRightActive
                  ? '0 0 16px 3px rgba(255,255,255,0.85)'
                  : '0 4px 8px rgba(0,0,0,0.85)',
                padding: '2px',
              }}
            >
              <div
                className="w-full h-full rounded-r-[24%] rounded-l-[12%] flex items-center justify-end pr-[12%]"
                style={{
                  background: 'linear-gradient(270deg, #121418 0%, #24272e 100%)',
                  boxShadow: 'inset -3px 0 5px rgba(0,0,0,0.9)',
                }}
              >
                <svg viewBox="0 0 12 24" className="w-[28%] h-[46%]">
                  <path
                    d="M3,3 L9,12 L3,21"
                    fill="none"
                    stroke={dpadRightActive ? '#ffffff' : '#8b909a'}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* 6. VIEW BUTTON */}
        <div
          style={{
            left: '35.5%',
            top: '32%',
            width: `${viewMenuSize}px`,
            height: `${viewMenuSize}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute z-10"
        >
          <DomeButton
            glowColor="#ffffff"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(p) => onButtonChange('View', p)}
            label={
              <svg viewBox="0 0 24 24" className="w-[46%] h-[46%]">
                <path
                  d="M4,13 V6 H13 V9"
                  fill="none"
                  stroke="#d1d5db"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  x="9"
                  y="10"
                  width="11"
                  height="8"
                  rx="1"
                  fill="none"
                  stroke="#d1d5db"
                  strokeWidth="2.2"
                />
              </svg>
            }
          />
        </div>

        {/* 7. MENU BUTTON */}
        <div
          style={{
            left: '64.5%',
            top: '32%',
            width: `${viewMenuSize}px`,
            height: `${viewMenuSize}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute z-10"
        >
          <DomeButton
            glowColor="#ffffff"
            hapticsEnabled={profile.hapticsEnabled}
            onPressChange={(p) => onButtonChange('Menu', p)}
            label={
              <svg viewBox="0 0 24 24" className="w-[46%] h-[46%]">
                <path
                  d="M5,7 H19 M5,12 H19 M5,17 H19"
                  stroke="#d1d5db"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
        </div>

        {/* 8. CENTER "X" GUIDE BUTTON + 4-SEGMENT RADIAL COLLAR */}
        <div
          style={{
            left: '50.0%',
            top: '40.5%',
            width: `${centerRadialSize}px`,
            height: `${centerRadialSize}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute flex items-center justify-center z-10"
        >
          <svg viewBox="0 0 224 224" className="w-full h-full absolute inset-0 pointer-events-none">
            <path
              d="M 14,132 A 100,100 0 0,0 210,132 L 166,118 A 56,56 0 0,1 58,118 Z"
              fill="#111216"
              stroke="#191b20"
              strokeWidth="1.5"
            />
            <line x1="72" y1="152" x2="42" y2="184" stroke="#07080a" strokeWidth="3" />
            <line x1="112" y1="168" x2="112" y2="212" stroke="#07080a" strokeWidth="3" />
            <line x1="152" y1="152" x2="182" y2="184" stroke="#07080a" strokeWidth="3" />
          </svg>

          {/* Radial Icon 1: Steering Wheel / Gyro Tilt Mode */}
          <button
            type="button"
            onClick={() => setGyroEnabled((g) => !g)}
            style={{ left: '19%', top: '65%', width: '16%', height: '16%' }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer ${
              gyroEnabled ? 'text-pink-400' : 'text-[#d1d5db] hover:text-white'
            }`}
            title="Toggle Gyro Tilt Steering"
          >
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M3.5,10.5 H9.8 M14.2,10.5 H20.5 M12,14.2 V20.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Radial Icon 2: Keyboard Mode */}
          <button
            type="button"
            onClick={() => onOpenKeyboardMouse('keyboard')}
            style={{ left: '37%', top: '83%', width: '16%', height: '16%' }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-[#d1d5db] hover:text-pink-400 cursor-pointer"
            title="Open PC Gaming Keyboard"
          >
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <rect x="2" y="5" width="20" height="14" rx="2" fill="currentColor" />
              <rect x="4.5" y="7.5" width="2" height="2" fill="#111216" />
              <rect x="8" y="7.5" width="2" height="2" fill="#111216" />
              <rect x="11.5" y="7.5" width="2" height="2" fill="#111216" />
              <rect x="15" y="7.5" width="2" height="2" fill="#111216" />
              <rect x="18" y="7.5" width="1.5" height="2" fill="#111216" />
              <rect x="4.5" y="11" width="2" height="2" fill="#111216" />
              <rect x="8" y="11" width="2" height="2" fill="#111216" />
              <rect x="11.5" y="11" width="2" height="2" fill="#111216" />
              <rect x="15" y="11" width="2" height="2" fill="#111216" />
              <rect x="18" y="11" width="1.5" height="2" fill="#111216" />
              <rect x="6.5" y="14.5" width="11" height="2" fill="#111216" />
            </svg>
          </button>

          {/* Radial Icon 3: Virtual Mouse Mode */}
          <button
            type="button"
            onClick={() => onOpenKeyboardMouse('mouse')}
            style={{ left: '63%', top: '83%', width: '16%', height: '16%' }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-[#525660] hover:text-purple-400 cursor-pointer"
            title="Open Virtual Mouse Trackpad"
          >
            <svg viewBox="0 0 24 24" className="w-full h-full fill-current">
              <path d="M5.5,3.5 L18.5,11.5 L12.5,13.2 L15.5,19.5 L13.2,20.6 L10.2,14.3 L5.5,18.2 Z" />
            </svg>
          </button>

          {/* Radial Icon 4: Power / System Menu */}
          <button
            type="button"
            onClick={() => onOpenModal('connect')}
            style={{ left: '81%', top: '65%', width: '16%', height: '16%' }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-[#525660] hover:text-pink-400 cursor-pointer"
            title="Connection & System Menu"
          >
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <path
                d="M12,3 V11 M7.05,6.05 A8,8 0 1,0 16.95,6.05"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Central Neon-Pink Ringed "X" Guide Dome Button */}
          <div
            style={{ width: '46%', height: '46%' }}
            className={`relative z-10 ${rgbClass}`}
          >
            <DomeButton
              glowColor="#ff007f"
              showNeonRing={profile.rgbMode !== 'off'}
              neonRingColor={profile.rgbMode === 'static' ? profile.customColor : '#ff007f'}
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('Home', p)}
              label={
                <svg viewBox="0 0 24 24" className="w-[46%] h-[46%]">
                  <path
                    d="M6,6 L18,18 M18,6 L6,18"
                    stroke="#b4b8c2"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                </svg>
              }
            />
          </div>
        </div>

        {/* 9. RIGHT DIAMOND ABXY CLUSTER */}
        <div
          style={{
            left: '78.8%',
            top: '33%',
            width: '0px',
            height: '0px',
          }}
          className="absolute z-10"
        >
          {/* TOP: Y Button */}
          <div
            style={{
              left: '0px',
              top: `${-abxyOffsetY}px`,
              width: `${abxySize}px`,
              height: `${abxySize}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className="absolute"
          >
            <DomeButton
              textColor="#eab308"
              glowColor="#eab308"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('Y', p)}
              label={
                <svg viewBox="0 0 40 40" className="w-[58%] h-[58%] fill-current">
                  <text
                    x="20"
                    y="29"
                    textAnchor="middle"
                    fontSize="26"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {isPlayStation ? '△' : 'Y'}
                  </text>
                </svg>
              }
            />
          </div>

          {/* LEFT: X Button */}
          <div
            style={{
              left: `${-abxyOffsetX}px`,
              top: '0px',
              width: `${abxySize}px`,
              height: `${abxySize}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className="absolute"
          >
            <DomeButton
              textColor="#0ea5e9"
              glowColor="#0ea5e9"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('X', p)}
              label={
                <svg viewBox="0 0 40 40" className="w-[58%] h-[58%] fill-current">
                  <text
                    x="20"
                    y="29"
                    textAnchor="middle"
                    fontSize="26"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {isPlayStation ? '□' : 'X'}
                  </text>
                </svg>
              }
            />
          </div>

          {/* RIGHT: B Button */}
          <div
            style={{
              left: `${abxyOffsetX}px`,
              top: '0px',
              width: `${abxySize}px`,
              height: `${abxySize}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className="absolute"
          >
            <DomeButton
              textColor="#ef4444"
              glowColor="#ef4444"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('B', p)}
              label={
                <svg viewBox="0 0 40 40" className="w-[58%] h-[58%] fill-current">
                  <text
                    x="20"
                    y="29"
                    textAnchor="middle"
                    fontSize="26"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {isPlayStation ? '○' : 'B'}
                  </text>
                </svg>
              }
            />
          </div>

          {/* BOTTOM: A Button */}
          <div
            style={{
              left: '0px',
              top: `${abxyOffsetY}px`,
              width: `${abxySize}px`,
              height: `${abxySize}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className="absolute"
          >
            <DomeButton
              textColor="#22c55e"
              glowColor="#22c55e"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('A', p)}
              label={
                <svg viewBox="0 0 40 40" className="w-[58%] h-[58%] fill-current">
                  <text
                    x="20"
                    y="29"
                    textAnchor="middle"
                    fontSize="26"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    {isPlayStation ? '✕' : 'A'}
                  </text>
                </svg>
              }
            />
          </div>
        </div>

        {/* 10. LEFT & RIGHT ANALOG JOYSTICKS (Guaranteed inside phone vertical bounds) */}
        <div
          style={{
            left: '26%',
            top: '75.5%',
            width: `${joystickSize}px`,
            height: `${joystickSize}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute z-10"
        >
          <Joystick
            side="left"
            deadzone={profile.joystickDeadzone}
            sensitivity={profile.joystickSensitivity}
            stickRestOffset={profile.stickRestOffset}
            isRotated90={isPortraitViewport}
            rgbMode={profile.rgbMode}
            rgbIntensity={profile.rgbIntensity}
            customColor={profile.customColor}
            hapticsEnabled={profile.hapticsEnabled}
            onMove={(x, y) => onStickMove('left', x, y)}
          />
        </div>

        <div
          style={{
            left: '74%',
            top: '75.5%',
            width: `${joystickSize}px`,
            height: `${joystickSize}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute z-10"
        >
          <Joystick
            side="right"
            deadzone={profile.joystickDeadzone}
            sensitivity={profile.joystickSensitivity}
            stickRestOffset={profile.stickRestOffset}
            isRotated90={isPortraitViewport}
            rgbMode={profile.rgbMode}
            rgbIntensity={profile.rgbIntensity}
            customColor={profile.customColor}
            hapticsEnabled={profile.hapticsEnabled}
            onMove={(x, y) => onStickMove('right', x, y)}
          />
        </div>

        {/* 11. BOTTOM-CENTER CLUSTER: LTS · [^ QR] · RTS */}
        <div
          style={{
            left: '50.0%',
            top: '84.5%',
            transform: 'translate(-50%, -50%)',
            gap: `${Math.round(hUnit * 3.8)}px`,
          }}
          className="absolute flex items-center z-20"
        >
          {/* LTS Button */}
          <div style={{ width: `${ltsRtsSize}px`, height: `${ltsRtsSize}px` }}>
            <DomeButton
              textColor="#9ca3af"
              glowColor="#ec4899"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('L3', p)}
              label={
                <svg viewBox="0 0 50 50" className="w-[68%] h-[68%] fill-current">
                  <text
                    x="25"
                    y="30"
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="700"
                    letterSpacing="0.5"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    LTS
                  </text>
                </svg>
              }
            />
          </div>

          {/* Center Vertical Capsule (^ + QR Code Icon) */}
          <div
            style={{
              width: `${dockWidth}px`,
              height: `${dockHeight}px`,
              background: '#0a0b0e',
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.95), 0 1px 0 rgba(255,255,255,0.04)',
              border: '1px solid #16181e',
            }}
            className="rounded-2xl flex flex-col items-center justify-between py-[8%] px-[4%]"
          >
            <button
              type="button"
              onClick={() => onOpenModal('customize')}
              title="Open Gamepad Control Center & Customization"
              className="w-full h-[38%] flex items-center justify-center text-white hover:text-pink-400 active:scale-90 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 24 14" className="w-[56%] h-[56%]">
                <path
                  d="M4,11 L12,3 L20,11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => onOpenModal('qr_pair')}
              title="QR Code Pairing & Windows Receiver"
              className="w-full h-[54%] flex items-center justify-center text-white hover:text-pink-400 active:scale-90 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="w-[68%] h-[68%]">
                <path
                  d="M3,7 V3 H7 M17,3 H21 V7 M21,17 V21 H17 M7,21 H3 V17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x="6.5" y="6.5" width="4.5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <rect x="13" y="6.5" width="4.5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <rect x="6.5" y="13" width="4.5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <rect x="13" y="13" width="2" height="2" fill="currentColor" />
                <rect x="15.5" y="15.5" width="2" height="2" fill="currentColor" />
                <rect x="15.5" y="13" width="2" height="1.5" fill="currentColor" />
                <rect x="13" y="15.5" width="1.5" height="2" fill="currentColor" />
              </svg>
            </button>
          </div>

          {/* RTS Button */}
          <div style={{ width: `${ltsRtsSize}px`, height: `${ltsRtsSize}px` }}>
            <DomeButton
              textColor="#9ca3af"
              glowColor="#ec4899"
              hapticsEnabled={profile.hapticsEnabled}
              onPressChange={(p) => onButtonChange('R3', p)}
              label={
                <svg viewBox="0 0 50 50" className="w-[68%] h-[68%] fill-current">
                  <text
                    x="25"
                    y="30"
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="700"
                    letterSpacing="0.5"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                  >
                    RTS
                  </text>
                </svg>
              }
            />
          </div>
        </div>

        {/* 12. BOTTOM-LEFT & BOTTOM-RIGHT DIAGONAL NEON SLASH ACCENTS */}
        {profile.rgbMode !== 'off' && (
          <>
            <svg
              viewBox="0 0 140 70"
              style={{ left: '0%', bottom: '0%', width: '10.5%', height: '12%', opacity: profile.rgbIntensity }}
              className={`pointer-events-none absolute z-10 ${rgbClass}`}
            >
              <defs>
                <linearGradient id="leftCornerSlash" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#9333ea" />
                  <stop offset="60%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#581c87" stopOpacity="0.2" />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1="14"
                x2="112"
                y2="68"
                stroke="url(#leftCornerSlash)"
                strokeWidth="4.5"
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 8px #ec4899)' }}
              />
            </svg>

            <svg
              viewBox="0 0 140 70"
              style={{ right: '0%', bottom: '0%', width: '10.5%', height: '12%', opacity: profile.rgbIntensity }}
              className={`pointer-events-none absolute z-10 ${rgbClass}`}
            >
              <defs>
                <linearGradient id="rightCornerSlash" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ff007f" />
                  <stop offset="65%" stopColor="#9333ea" />
                  <stop offset="100%" stopColor="#3b0764" stopOpacity="0.2" />
                </linearGradient>
              </defs>
              <line
                x1="140"
                y1="14"
                x2="28"
                y2="68"
                stroke="url(#rightCornerSlash)"
                strokeWidth="4.5"
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 8px #ff007f)' }}
              />
            </svg>
          </>
        )}
      </div>
    </div>
  );
};
