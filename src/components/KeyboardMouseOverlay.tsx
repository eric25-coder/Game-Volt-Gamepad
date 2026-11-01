import React, { useRef, useState } from 'react';
import { X, Keyboard as KeyboardIcon, MousePointer, CornerDownLeft, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

interface KeyboardMouseOverlayProps {
  mode: 'keyboard' | 'mouse';
  onClose: () => void;
  onSwitchMode: (mode: 'keyboard' | 'mouse') => void;
  onSendKey: (key: string, action: 'down' | 'up' | 'press') => void;
  onSendMouse: (dx: number, dy: number, button?: 'left' | 'right' | 'middle', pressed?: boolean) => void;
}

const KEYBOARD_ROWS = [
  ['ESC', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'BACKSPACE'],
  ['TAB', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'],
  ['CAPS', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'ENTER'],
  ['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'UP', 'CTRL'],
  ['WIN', 'ALT', 'SPACE', 'LEFT', 'DOWN', 'RIGHT'],
];

export const KeyboardMouseOverlay: React.FC<KeyboardMouseOverlayProps> = ({
  mode,
  onClose,
  onSwitchMode,
  onSendKey,
  onSendMouse,
}) => {
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({});
  const trackpadRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const [cursorRipple, setCursorRipple] = useState<{ x: number; y: number } | null>(null);

  const handleKeyDown = (key: string, e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveKeys((prev) => ({ ...prev, [key]: true }));
    onSendKey(key, 'down');
    if (navigator.vibrate) navigator.vibrate(12);
  };

  const handleKeyUp = (key: string) => {
    setActiveKeys((prev) => ({ ...prev, [key]: false }));
    onSendKey(key, 'up');
  };

  const handleTrackpadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    trackpadRef.current = { lastX: e.clientX, lastY: e.clientY };
    setCursorRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleTrackpadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackpadRef.current) return;
    const dx = (e.clientX - trackpadRef.current.lastX) * 1.8;
    const dy = (e.clientY - trackpadRef.current.lastY) * 1.8;
    trackpadRef.current = { lastX: e.clientX, lastY: e.clientY };

    const rect = e.currentTarget.getBoundingClientRect();
    setCursorRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
      onSendMouse(dx, dy);
    }
  };

  const handleTrackpadUp = () => {
    trackpadRef.current = null;
    setCursorRipple(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-[#0b0c10]/95 backdrop-blur-xl border-t border-pink-500/30 p-3 shadow-[0_-10px_40px_rgba(0,0,0,0.9)]">
      <div className="max-w-5xl mx-auto">
        {/* Header Bar */}
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSwitchMode('keyboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                mode === 'keyboard'
                  ? 'bg-pink-600 text-white shadow-[0_0_12px_rgba(236,72,153,0.6)]'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              <KeyboardIcon className="w-3.5 h-3.5" />
              PC Gaming Keyboard
            </button>
            <button
              onClick={() => onSwitchMode('mouse')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                mode === 'mouse'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.6)]'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              Virtual Trackpad & Mouse
            </button>
          </div>

          <button
            onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-800 whitespace-nowrap shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            Return to Gamepad
          </button>
        </div>

        {mode === 'keyboard' ? (
          <div className="flex flex-col gap-1.5 select-none">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="flex justify-center gap-1.5">
                {row.map((key) => {
                  const isPressed = !!activeKeys[key];
                  const isWASD = ['W', 'A', 'S', 'D'].includes(key);
                  const isWide =
                    key === 'SPACE'
                      ? 'flex-[3.5] max-w-[260px]'
                      : ['BACKSPACE', 'ENTER', 'SHIFT', 'CAPS', 'TAB'].includes(key)
                      ? 'flex-[1.5] px-2'
                      : 'flex-1';

                  return (
                    <button
                      key={key}
                      onPointerDown={(e) => handleKeyDown(key, e)}
                      onPointerUp={() => handleKeyUp(key)}
                      onPointerCancel={() => handleKeyUp(key)}
                      className={`h-9 sm:h-10 rounded-lg font-mono-tabular text-[11px] sm:text-xs font-semibold flex items-center justify-center border transition-all ${isWide} ${
                        isPressed
                          ? 'bg-pink-600 text-white border-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.8)] scale-95'
                          : isWASD
                          ? 'bg-zinc-800/90 text-pink-400 border-pink-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                          : 'bg-[#15171c] text-zinc-200 border-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      }`}
                    >
                      {key === 'ENTER' ? (
                        <CornerDownLeft className="w-3.5 h-3.5" />
                      ) : key === 'UP' ? (
                        <ArrowUp className="w-3.5 h-3.5" />
                      ) : key === 'DOWN' ? (
                        <ArrowDown className="w-3.5 h-3.5" />
                      ) : key === 'LEFT' ? (
                        <ArrowLeft className="w-3.5 h-3.5" />
                      ) : key === 'RIGHT' ? (
                        <ArrowRight className="w-3.5 h-3.5" />
                      ) : (
                        key
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-3 h-48">
            {/* Multi-Touch Precision Trackpad */}
            <div
              onPointerDown={handleTrackpadDown}
              onPointerMove={handleTrackpadMove}
              onPointerUp={handleTrackpadUp}
              onPointerCancel={handleTrackpadUp}
              onClick={() => onSendMouse(0, 0, 'left', true)}
              className="col-span-9 relative rounded-xl bg-gradient-to-br from-[#13151a] to-[#090a0d] border border-purple-500/30 overflow-hidden flex items-center justify-center cursor-crosshair"
            >
              <div className="text-center pointer-events-none">
                <MousePointer className="w-6 h-6 text-purple-400/40 mx-auto mb-1" />
                <p className="text-xs text-zinc-500 font-medium">
                  Slide finger to move PC cursor · Tap to Left Click
                </p>
              </div>
              {cursorRipple && (
                <div
                  className="w-10 h-10 rounded-full bg-pink-500/30 border border-pink-400 pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 shadow-[0_0_20px_rgba(236,72,153,0.8)]"
                  style={{ left: cursorRipple.x, top: cursorRipple.y }}
                />
              )}
            </div>

            {/* Dedicated Left / Middle / Right Mouse Buttons */}
            <div className="col-span-3 flex flex-col gap-2">
              <button
                onPointerDown={() => onSendMouse(0, 0, 'left', true)}
                onPointerUp={() => onSendMouse(0, 0, 'left', false)}
                className="flex-1 rounded-xl bg-[#16181f] active:bg-pink-600/30 border border-zinc-800 active:border-pink-500 text-xs font-semibold text-zinc-200 flex items-center justify-center transition-all"
              >
                Left Click (LMB)
              </button>
              <button
                onPointerDown={() => onSendMouse(0, 0, 'middle', true)}
                onPointerUp={() => onSendMouse(0, 0, 'middle', false)}
                className="h-10 rounded-xl bg-[#16181f] active:bg-purple-600/30 border border-zinc-800 active:border-purple-500 text-xs font-semibold text-zinc-400 flex items-center justify-center transition-all"
              >
                Middle (MMB)
              </button>
              <button
                onPointerDown={() => onSendMouse(0, 0, 'right', true)}
                onPointerUp={() => onSendMouse(0, 0, 'right', false)}
                className="flex-1 rounded-xl bg-[#16181f] active:bg-blue-600/30 border border-zinc-800 active:border-blue-500 text-xs font-semibold text-zinc-200 flex items-center justify-center transition-all"
              >
                Right Click (RMB)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
