import React from 'react';
import { ArrowRight } from 'lucide-react';

function barColor(percent, state, stale, alertThreshold) {
  if (state === 'expired') return '#f59e0b';
  if (state !== 'known' || percent == null) return '#52525b';
  if (stale) return '#a1a1aa';
  const critical = Math.max(50, Math.min(100, Number(alertThreshold) || 80));
  if (percent >= critical) return '#ef4444';
  if (percent >= Math.max(0, critical - 30)) return '#f59e0b';
  return '#10b981';
}

function QuotaRow({ label, percent, resetText, state, authState, stale, alertThreshold }) {
  const known = state === 'known' && percent != null;
  const color = barColor(percent, state, stale, alertThreshold);
  const width = known ? Math.min(100, percent) : 0;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[11.5px] text-neutral-400 mb-1.5 font-medium">
        <span>{label}</span>
        <span className="font-mono text-neutral-300 text-[11px]">{resetText}</span>
      </div>
      <div className="h-1.5 w-full bg-[#27272a] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-[var(--notch-slow)]"
          style={{
            width: `${width}%`,
            backgroundColor: color,
            boxShadow: known ? `0 0 8px ${color}88` : 'none'
          }}
        />
      </div>
      <div className="flex justify-between items-center mt-1 text-[11px] font-mono">
        <span style={{ color }} className="font-semibold">
          {known ? `${stale ? '~' : ''}${percent}% Used` :
            state === 'expired' ? 'Sign in required' :
              authState === 'signed_in' ? 'Signed in · usage unavailable' : 'Quota unknown'}
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

export function ModelPopoverCard({ model, jobActivity, proTip = 'off', onGetPro, onMouseEnter, onMouseLeave }) {
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
    <div
      data-hud
      className="w-[280px] notch-glass rounded-2xl p-4 text-white notch-enter"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm tracking-tight text-white">{model.name}</span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-neutral-400">
          {model.provider}
        </span>
      </div>

      <QuotaRow
        label={model.sessionLabel || 'Current session'}
        percent={model.sessionUsedPercent}
        resetText={model.sessionResetText}
        state={state}
        authState={model.authState}
        stale={model.stale}
        alertThreshold={model.alertThreshold}
      />
      <QuotaRow
        label={model.weeklyLabel || 'All models (Weekly)'}
        percent={model.weeklyUsedPercent}
        resetText={model.weeklyResetText}
        state={state}
        authState={model.authState}
        stale={model.stale}
        alertThreshold={model.alertThreshold}
      />

      {model.stale ? (
        <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] text-neutral-400">
          Showing the last successful reading; refresh failed.
        </div>
      ) : null}

      {state !== 'known' && String(model.id || '').startsWith('custom_') ? (
        <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] text-neutral-400 leading-snug">
          Glow tracks the process. Usage % needs a JSON quota command in Settings
          {' '}(<span className="font-mono text-neutral-300">sessionUsedPercent</span>
          {' / '}
          <span className="font-mono text-neutral-300">weeklyUsedPercent</span>).
        </div>
      ) : null}

      {routingLine ? (
        <div className="w-full mt-2 py-1.5 px-3 bg-emerald-500/10 border border-emerald-500/25 rounded-lg flex items-center gap-2 text-[11px] text-emerald-300 font-medium leading-snug">
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          <span>{routingLine}</span>
        </div>
      ) : null}

      {proTip !== 'off' ? (
        // The free build has no click-to-jump, so a click on a ring is the moment a
        // user shows they want it. Say so there, once, instead of nagging elsewhere.
        <div
          className={`mt-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[10.5px] leading-snug ${
            proTip === 'clicked'
              ? 'border border-amber-400/30 bg-amber-400/10 text-amber-200'
              : 'text-neutral-500'
          }`}
        >
          <span>
            {proTip === 'clicked'
              ? 'Click to jump to this terminal is in Pro.'
              : 'Pro: click a ring to jump to its terminal.'}
          </span>
          <button
            data-hud
            type="button"
            onClick={onGetPro}
            className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-semibold text-neutral-200 hover:bg-white/20"
          >
            Get Pro
          </button>
        </div>
      ) : null}
    </div>
  );
}
