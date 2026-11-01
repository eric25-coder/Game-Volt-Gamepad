import React, { useRef, useState } from 'react';
import { RGBMode } from '../types';

interface JoystickProps {
  side: 'left' | 'right';
  deadzone: number;
  sensitivity: number;
  stickRestOffset: boolean;
  isRotated90?: boolean;
  rgbMode: RGBMode;
  rgbIntensity: number;
  customColor: string;
  hapticsEnabled: boolean;
  onMove: (x: number, y: number) => void;
  onStickPress?: (pressed: boolean) => void;
}

export const Joystick: React.FC<JoystickProps> = ({
  side,
  deadzone,
  sensitivity,
  isRotated90 = false,
  rgbMode,
  rgbIntensity,
  customColor,
  hapticsEnabled,
  onMove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const hitBoundaryRef = useRef(false);

  const applyDeadzoneAndSensitivity = (rawX: number, rawY: number) => {
    const mag = Math.sqrt(rawX * rawX + rawY * rawY);
    if (mag < deadzone) {
      return { x: 0, y: 0 };
    }
    const normalizedMag = Math.min(1, (mag - deadzone) / (1 - deadzone));
    const curvedMag = Math.min(1, Math.pow(normalizedMag, 1 / Math.max(0.5, sensitivity)));
    const angle = Math.atan2(rawY, rawX);
    return {
      x: Math.cos(angle) * curvedMag,
      y: Math.sin(angle) * curvedMag,
    };
  };

  const updateFromClientXY = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = Math.min(rect.width, rect.height) * 0.38;

    const screenDX = clientX - centerX;
    const screenDY = clientY - centerY;

    // Map screen coordinates to controller stage coordinates (handles auto-rotated portrait mode seamlessly)
    let dx = (isRotated90 ? screenDY : screenDX) / maxRadius;
    let dy = (isRotated90 ? -screenDX : screenDY) / maxRadius;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      dx /= dist;
      dy /= dist;
      if (!hitBoundaryRef.current && hapticsEnabled && navigator.vibrate) {
        navigator.vibrate(8);
        hitBoundaryRef.current = true;
      }
    } else {
      hitBoundaryRef.current = false;
    }

    setPos({ x: dx, y: dy });
    const processed = applyDeadzoneAndSensitivity(dx, dy);
    onMove(processed.x, processed.y);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    setIsActive(true);
    if (hapticsEnabled && navigator.vibrate) navigator.vibrate(10);
    updateFromClientXY(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    updateFromClientXY(e.clientX, e.clientY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    setIsActive(false);
    hitBoundaryRef.current = false;
    setPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const ringColor = rgbMode === 'static' ? customColor : '#ff007f';

  const glowFilter =
    rgbMode === 'off'
      ? 'none'
      : `drop-shadow(0 0 ${isActive ? 14 : 9}px ${ringColor})`;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      className="relative w-full h-full flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing"
    >
      {/* Glowing Neon Ring centered on the joystick assembly */}
      <svg
        viewBox="0 0 140 140"
        className={`w-full h-full absolute inset-0 m-auto pointer-events-none transition-transform duration-150 ${
          rgbMode === 'rainbow' ? 'animate-rgb-rainbow' : rgbMode === 'breathing' ? 'animate-rgb-breathe' : ''
        }`}
        style={{
          opacity: rgbMode === 'off' ? 0.2 : rgbIntensity,
          filter: glowFilter,
        }}
      >
        <defs>
          <linearGradient id={`stickRing-${side}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={rgbMode === 'static' ? customColor : '#ff007f'} />
            <stop offset="55%" stopColor={rgbMode === 'static' ? customColor : '#ec4899'} />
            <stop offset="100%" stopColor={rgbMode === 'static' ? customColor : '#a855f7'} />
          </linearGradient>
        </defs>
        {/* Dark Socket Well */}
        <circle cx="70" cy="70" r="61" fill="#08090b" />
        {/* Vivid Neon Pink/Magenta Ring */}
        <circle
          cx="70"
          cy="70"
          r="61"
          fill="none"
          stroke={`url(#stickRing-${side})`}
          strokeWidth={isActive ? '5.5' : '4.5'}
        />
      </svg>

      {/* 3D Textured Concave Thumbstick Cap centrally placed inside the neon ring */}
      <div
        className="w-[76%] h-[76%] rounded-full pointer-events-none relative flex items-center justify-center"
        style={{
          left: `${pos.x * 22}%`,
          top: `${pos.y * 22}%`,
          transform: `scale(${isActive ? 1.05 : 1})`,
          transition: isActive ? 'none' : 'left 130ms cubic-bezier(0.16,1,0.3,1), top 130ms cubic-bezier(0.16,1,0.3,1), transform 130ms ease',
          background:
            'radial-gradient(circle at 38% 30%, #484b52 0%, #2a2c32 45%, #17191d 85%, #0d0e11 100%)',
          boxShadow: isActive
            ? `0 10px 24px rgba(0,0,0,0.95), 0 0 16px rgba(255,0,127,0.45), inset 0 2px 3px rgba(255,255,255,0.22)`
            : `0 8px 20px rgba(0,0,0,0.92), inset 0 2px 3px rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.85)`,
        }}
      >
        {/* Outer Knurled Rubber Grip Texture Ring */}
        <div
          className="w-[82%] h-[82%] rounded-full flex items-center justify-center relative"
          style={{
            background:
              'radial-gradient(circle at 55% 60%, #25282e 0%, #16181c 70%, #0f1013 100%)',
            boxShadow:
              'inset 0 5px 10px rgba(0,0,0,0.85), inset 0 -1px 2px rgba(255,255,255,0.12), 0 1px 1px rgba(255,255,255,0.08)',
          }}
        >
          {/* 4 Crosshair Tick Marks inside the thumbstick dish */}
          <span className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[2px] h-[14%] bg-[#5a5e66] rounded-full opacity-85" />
          <span className="absolute bottom-[10%] left-1/2 -translate-x-1/2 w-[2px] h-[14%] bg-[#5a5e66] rounded-full opacity-85" />
          <span className="absolute left-[10%] top-1/2 -translate-y-1/2 h-[2px] w-[14%] bg-[#5a5e66] rounded-full opacity-85" />
          <span className="absolute right-[10%] top-1/2 -translate-y-1/2 h-[2px] w-[14%] bg-[#5a5e66] rounded-full opacity-85" />
        </div>
      </div>
    </div>
  );
};
