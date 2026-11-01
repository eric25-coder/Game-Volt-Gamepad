import React, { useRef, useState } from 'react';

interface DomeButtonProps {
  label?: React.ReactNode;
  textColor?: string;
  glowColor: string;
  sizeClass?: string;
  showNeonRing?: boolean;
  neonRingColor?: string;
  hapticsEnabled?: boolean;
  onPressChange: (pressed: boolean) => void;
}

export const DomeButton: React.FC<DomeButtonProps> = ({
  label,
  textColor = '#9ca3af',
  glowColor,
  sizeClass = 'w-full h-full',
  showNeonRing = false,
  neonRingColor = '#ff007f',
  hapticsEnabled = true,
  onPressChange,
}) => {
  const [pressed, setPressed] = useState(false);
  const pointerIdRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    setPressed(true);
    onPressChange(true);
    if (hapticsEnabled && navigator.vibrate) navigator.vibrate(12);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    setPressed(false);
    onPressChange(false);
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      className={`relative rounded-full flex items-center justify-center select-none touch-none transition-transform duration-75 ${sizeClass} ${
        pressed ? 'scale-[0.93]' : 'scale-100'
      }`}
      style={{
        background: '#08090c',
        boxShadow: pressed
          ? `0 0 22px 4px ${glowColor}, inset 0 0 10px ${glowColor}`
          : showNeonRing
          ? `0 0 16px 2px ${neonRingColor}, inset 0 0 4px ${neonRingColor}`
          : '0 6px 14px rgba(0,0,0,0.92), inset 0 1px 1px rgba(255,255,255,0.14)',
        border: pressed
          ? `2px solid ${glowColor}`
          : showNeonRing
          ? `2.5px solid ${neonRingColor}`
          : '2px solid #262930',
      }}
    >
      {/* Inner 3D Convex Glossy Dome */}
      <div
        className="w-[86%] h-[86%] rounded-full flex items-center justify-center relative overflow-hidden pointer-events-none"
        style={{
          background: pressed
            ? 'radial-gradient(circle at 50% 50%, #252830 0%, #101216 70%, #07080a 100%)'
            : 'radial-gradient(circle at 38% 28%, #343842 0%, #15171c 55%, #090a0d 100%)',
          boxShadow: 'inset 0 -3px 6px rgba(0,0,0,0.9)',
        }}
      >
        {/* Top-left Specular Crescent Reflection Arc */}
        <div
          className="absolute top-[6%] left-[14%] w-[68%] h-[38%] rounded-full pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.04) 65%, transparent 100%)',
            transform: 'rotate(-12deg)',
          }}
        />

        {/* Subtle Bottom Rim Specular Arc */}
        <div
          className="absolute bottom-[5%] left-[22%] w-[56%] h-[14%] rounded-full pointer-events-none"
          style={{
            background:
              'linear-gradient(0deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
          }}
        />

        {/* Button Symbol / Text rendered via scalable SVG or proportional container */}
        <span
          className="relative z-10 w-full h-full flex items-center justify-center font-bold tracking-tight"
          style={{
            color: textColor,
            textShadow: pressed
              ? `0 0 14px ${glowColor}, 0 0 6px ${textColor}`
              : `0 0 6px ${glowColor}55`,
          }}
        >
          {label}
        </span>
      </div>
    </button>
  );
};
