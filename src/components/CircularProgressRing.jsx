import React, { memo } from 'react';

function CircularProgressRingInner({
  size = 46,
  strokeWidth = 3.5,
  progress = 0,
  status = 'normal',
  children,
  isActive = false
}) {
  const known = status !== 'unknown' && status !== 'expired' && progress != null;
  const safeProgress = known ? Math.min(100, Math.max(0, progress)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safeProgress / 100) * circumference;

  const getColor = () => {
    if (status === 'expired') return '#f59e0b';
    if (status === 'unknown' || !known) return '#52525b';
    if (safeProgress >= 80 || status === 'critical') return '#ef4444';
    if (safeProgress >= 50 || status === 'warning') return '#f59e0b';
    return '#10b981';
  };

  const ringColor = getColor();

  return (
    <div className="relative flex items-center justify-center cursor-pointer group">
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
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
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.4s ease',
            filter: known ? `drop-shadow(0 0 4px ${ringColor}66)` : 'none'
          }}
        />
      </svg>

      <div className={`absolute inset-[4px] rounded-full bg-[#18181b] flex items-center justify-center transition-colors duration-200 ${isActive ? 'ring-1 ring-white/30' : 'group-hover:bg-[#27272a]'}`}>
        <div style={{ color: ringColor }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export const CircularProgressRing = memo(CircularProgressRingInner);
