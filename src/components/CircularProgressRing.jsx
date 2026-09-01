import React, { memo } from 'react';

function CircularProgressRingInner({
  size = 46,
  strokeWidth = 3.5,
  progress = 0,
  status = 'normal',
  children,
  isActive = false,
  isLive = false,
  liveDelayMs = 0,
  reduceMotion = false
}) {
  const known = status !== 'unknown' && status !== 'expired' && progress != null;
  const safeProgress = known ? Math.min(100, Math.max(0, progress)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safeProgress / 100) * circumference;

  const getColor = () => {
    if (status === 'expired') return '#f59e0b';
    if (status === 'unknown' || !known) return '#52525b';
    if (status === 'critical') return '#ef4444';
    if (status === 'warning') return '#f59e0b';
    return '#10b981';
  };

  const ringColor = getColor();

  const idleBloom = known
    ? `drop-shadow(0 0 2px ${ringColor}aa) drop-shadow(0 0 6px ${ringColor}40)`
    : 'none';
  const liveBloom = `drop-shadow(0 0 3px ${ringColor}) drop-shadow(0 0 7px ${ringColor}cc)`;

  return (
    <div className="relative flex items-center justify-center cursor-pointer group">
      {/* A halo that hugs the ring rather than a blurred disc behind it. Rows sit
          65px apart, so a filled bloom that grew past ~26px from the centre spilled
          onto the neighbouring icons and washed out this ring's own percentage. */}
      {isLive && (
        <div
          className={`absolute inset-0 rounded-full pointer-events-none ${reduceMotion ? '' : 'notch-live-halo'}`}
          style={{
            boxShadow: `0 0 6px 1px ${ringColor}, inset 0 0 5px ${ringColor}`,
            opacity: reduceMotion ? 0.5 : undefined,
            animationDelay: reduceMotion ? undefined : `${liveDelayMs}ms`
          }}
        />
      )}
      <svg
        width={size}
        height={size}
        className="relative z-[1] transform -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#27272a"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={known ? circumference : `${circumference * 0.08} ${circumference * 0.12}`}
          strokeDashoffset={known ? strokeDashoffset : 0}
          strokeLinecap="round"
          fill="transparent"
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.4s ease, filter 0.3s ease',
            filter: isLive ? liveBloom : idleBloom
          }}
        />
      </svg>

      <div className={`absolute inset-[4px] z-[2] rounded-full bg-[#18181b] flex items-center justify-center transition-colors duration-200 ${isActive ? 'ring-1 ring-white/30' : 'group-hover:bg-[#27272a]'}`}>
        <div className="w-4 h-4 flex items-center justify-center leading-none scale-90" style={{ color: ringColor }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export const CircularProgressRing = memo(CircularProgressRingInner);
