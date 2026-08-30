import React from 'react';
import { ArrowRight } from 'lucide-react';

function barColor(percent, state) {
  if (state === 'expired') return '#f59e0b';
  if (state !== 'known' || percent == null) return '#52525b';
  if (percent >= 80) return '#ef4444';
  if (percent >= 50) return '#f59e0b';
  return '#10b981';
}

function QuotaRow({ label, percent, resetText, state }) {
  const known = state === 'known' && percent != null;
  const color = barColor(percent, state);
  const width = known ? Math.min(100, percent) : 0;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[11.5px] text-neutral-400 mb-1.5 font-medium">
        <span>{label}</span>
        <span className="font-mono text-neutral-300 text-[11px]">{resetText}</span>
      </div>
      <div className="h-1.5 w-full bg-[#27272a] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${width}%`,
            backgroundColor: color,
            boxShadow: known ? `0 0 8px ${color}88` : 'none'
          }}
        />
      </div>
      <div className="flex justify-between items-center mt-1 text-[11px] font-mono">
        <span style={{ color }} className="font-semibold">
          {known ? `${percent}% Used` : state === 'expired' ? 'Sign in required' : 'Quota unknown'}
        </span>
        {known && (
          <span className="text-neutral-500">
            {Math.max(0, 100 - percent)}% Left
          </span>
        )}
      </div>
    </div>
  );
}

export function ModelPopoverCard({ model, jobActivity }) {
  if (!model) return null;

  const state = model.quotaState || (model.quotaKnown ? 'known' : 'unknown');
  const isActiveWork = Boolean(
    jobActivity &&
      jobActivity.jobStatus === 'running' &&
      jobActivity.activeRing === model.id
  );
  const routingLine = isActiveWork
    ? (jobActivity.routingReason || jobActivity.handoff?.routingHint || '')
    : '';

  return (
    <div className="w-[280px] bg-[#111114]/95 backdrop-blur-xl border border-[#27272a] rounded-2xl p-4 text-white shadow-2xl shadow-black/80 relative animate-in fade-in zoom-in-95 duration-200">
      <div className="absolute right-[-7px] top-[24px] w-3.5 h-3.5 bg-[#111114] border-t border-r border-[#27272a] transform rotate-45" />

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm tracking-tight text-white">{model.name}</span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-neutral-400">
          {model.provider}
        </span>
      </div>

      <QuotaRow
        label="Current session"
        percent={model.sessionUsedPercent}
        resetText={model.sessionResetText}
        state={state}
      />
      <QuotaRow
        label="All models (Weekly)"
        percent={model.weeklyUsedPercent}
        resetText={model.weeklyResetText}
        state={state}
      />

      {routingLine ? (
        <div className="w-full mt-2 py-1.5 px-3 bg-emerald-500/10 border border-emerald-500/25 rounded-lg flex items-center gap-2 text-[11px] text-emerald-300 font-medium leading-snug">
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          <span>{routingLine}</span>
        </div>
      ) : null}
    </div>
  );
}
