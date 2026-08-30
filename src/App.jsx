import React, { useState, useEffect, useRef } from 'react';
import { CircularProgressRing } from './components/CircularProgressRing';
import { ModelPopoverCard } from './components/ModelPopoverCard';
import { SettingsModal } from './components/SettingsModal';
import { ClaudeIcon, OpenAIClassicIcon, CursorIcon, GeminiIcon, OpenCodeIcon, GrokIcon, SparkIcon } from './components/Icons';
import { Settings } from 'lucide-react';

export default function App() {
  const [data, setData] = useState({
    activeModel: 'codex',
    models: [],
    allDetectedIds: [],
    config: null
  });

  const [hoveredModelId, setHoveredModelId] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const scrollRef = useRef(null);
  const ignoringClicks = useRef(null);
  const playedHandoffs = useRef(new Set());

  useEffect(() => {
    if (window.agentNotchAPI?.getUsageData) {
      window.agentNotchAPI.getUsageData().then((res) => {
        if (res && res.models) setData(res);
      });
    }

    if (window.agentNotchAPI?.onUsageUpdated) {
      const unsub = window.agentNotchAPI.onUsageUpdated((newData) => {
        if (newData && newData.models) setData(newData);
      });
      return () => unsub?.();
    }
  }, []);

  useEffect(() => {
    window.agentNotchAPI?.setOverlayMode?.(isSettingsOpen ? 'settings' : 'dock');
  }, [isSettingsOpen]);

  useEffect(() => {
    const api = window.agentNotchAPI;
    if (!api?.setIgnoreMouseEvents) return;

    const apply = (ignore) => {
      if (ignoringClicks.current === ignore) return;
      ignoringClicks.current = ignore;
      if (ignore) api.setIgnoreMouseEvents(true, { forward: true });
      else api.setIgnoreMouseEvents(false);
    };

    apply(true);

    const onMove = (event) => {
      const node = event.target;
      const overHud = Boolean(node && typeof node.closest === 'function' && node.closest('[data-hud]'));
      apply(!overHud);
    };
    const onLeaveWindow = () => apply(true);

    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeaveWindow);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeaveWindow);
      apply(true);
    };
  }, []);

  const handleSaveConfig = (newCfg) => {
    if (window.agentNotchAPI?.saveConfig) {
      window.agentNotchAPI.saveConfig(newCfg);
    }
    setData((prev) => ({ ...prev, config: { ...(prev.config || {}), ...newCfg }, reduceMotion: Boolean(newCfg.reduceMotion) }));
  };

  const job = data.jobActivity && data.jobActivity.jobStatus === 'running' ? data.jobActivity : null;
  const reduceMotion = Boolean(data.reduceMotion) || Boolean(data.config?.reduceMotion);

  useEffect(() => {
    const event = data.jobActivity && data.jobActivity.handoff;
    if (!event || !event.at || !event.from || !event.to) return;
    if (playedHandoffs.current.has(event.at)) return;
    playedHandoffs.current.add(event.at);
    const parsed = Date.parse(event.at);
    const ageMs = Number.isNaN(parsed) ? 0 : Date.now() - parsed;
    if (ageMs > 8000) return;
    if (!event.fromRing && !event.toRing) return;
    setFlash(event);
    const hold = reduceMotion ? 1200 : 2500;
    const timer = setTimeout(() => setFlash(null), hold);
    return () => clearTimeout(timer);
  }, [data.jobActivity, reduceMotion]);

  const hoveredModel = data.models?.find((m) => m.id === hoveredModelId);

  const getModelIcon = (iconName) => {
    switch (iconName) {
      case 'claude':
        return <ClaudeIcon className="w-4 h-4" />;
      case 'codex':
        return <OpenAIClassicIcon className="w-4 h-4" />;
      case 'cursor':
        return <CursorIcon className="w-4 h-4" />;
      case 'opencode':
        return <OpenCodeIcon className="w-4 h-4" />;
      case 'grok':
        return <GrokIcon className="w-3.5 h-3.5" />;
      case 'spark':
        return <SparkIcon className="w-4 h-4" />;
      case 'gemini':
        return <GeminiIcon className="w-4 h-4" />;
      default:
        return <SparkIcon className="w-4 h-4" />;
    }
  };

  return (
    <div className={`w-full h-full flex items-center justify-end pr-0 select-none font-sans ${isSettingsOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
      <div data-hud className="flex items-center justify-end">
      {/* Popover / Settings Area on the Left */}
      <div className="mr-2 transition-all duration-200 z-50">
        {isSettingsOpen ? (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            config={data.config}
            allDetectedIds={data.allDetectedIds}
            onSaveConfig={handleSaveConfig}
          />
        ) : (
          hoveredModel && (
            <ModelPopoverCard
              model={hoveredModel}
              jobActivity={job}
            />
          )
        )}
      </div>

      {/* Side Notch Dock Body with Smooth Scrolling & Settings Gear */}
      <div
        className="relative bg-[#09090b]/98 backdrop-blur-2xl border-l-2 border-t-2 border-b-2 border-[#27272a] shadow-2xl shadow-black/95 py-3 px-2 rounded-l-[26px] z-40 transition-all duration-200 hover:border-[#34d399]/60 max-h-[440px] flex flex-col items-center justify-between gap-2"
        onMouseLeave={() => setHoveredModelId(null)}
      >
        {/* Scrollable Model Rings List */}
        <div
          ref={scrollRef}
          className="flex flex-col items-center gap-3 overflow-y-auto max-h-[360px] pr-0.5 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {data.models && data.models.length > 0 ? (
            data.models.map((m) => {
              const isWork = Boolean(job && job.activeRing === m.id);
              const isFrom = Boolean(flash && flash.fromRing === m.id);
              const isTo = Boolean(flash && flash.toRing === m.id);
              return (
              <div
                key={m.id}
                className={`relative flex flex-col items-center gap-0.5 group cursor-pointer ${isFrom && !reduceMotion ? 'opacity-40' : 'opacity-100'}`}
                onMouseEnter={() => {
                  if (!isSettingsOpen) setHoveredModelId(m.id);
                }}
              >
                {(isWork || isTo) && (
                  <div
                    className={`absolute -inset-1 rounded-full pointer-events-none ${
                      isTo && !reduceMotion ? 'bg-emerald-400/25' : 'bg-emerald-400/15'
                    }`}
                    style={{ filter: 'blur(5px)' }}
                  />
                )}
                <CircularProgressRing
                  size={38}
                  strokeWidth={3}
                  progress={m.ringPercent}
                  status={m.status || m.quotaState}
                  isActive={hoveredModelId === m.id}
                >
                  {getModelIcon(m.icon)}
                </CircularProgressRing>
                {(isWork || isTo) && (
                  <div className="absolute top-7 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#09090b] z-10" />
                )}
                {isTo && flash && !reduceMotion && (
                  <div className="absolute -left-3 top-3 text-[9px] text-emerald-300 font-mono">→</div>
                )}

                <span className={`text-[10px] font-mono font-bold transition-colors duration-200 ${
                  m.quotaState === 'expired' ? 'text-amber-400' :
                  m.quotaState !== 'known' || m.ringPercent == null ? 'text-neutral-500' :
                  m.ringPercent >= 80 ? 'text-red-400' :
                  m.ringPercent >= 50 ? 'text-amber-400' :
                  'text-neutral-400 group-hover:text-emerald-400'
                }`}>
                  {m.quotaState === 'expired' ? 'login' :
                    m.quotaState !== 'known' || m.ringPercent == null ? '—' :
                    `${m.ringPercent}%`}
                </span>
              </div>
            );
            })
          ) : (
            <div className="text-[10px] text-neutral-500 font-mono py-2">No models active</div>
          )}
        </div>

        {flash && (flash.fromRing || flash.toRing) && (
          <div className="w-full px-0.5 text-center text-[9px] font-mono text-emerald-300 leading-tight" title={flash.routingHint || flash.line}>
            {flash.line}
          </div>
        )}
        <div className="pt-1.5 border-t border-[#27272a]/60 w-full flex justify-center">
          <button
            onClick={() => {
              setHoveredModelId(null);
              setIsSettingsOpen(!isSettingsOpen);
            }}
            title="Customize Visible Models"
            className={`p-1.5 rounded-full transition-all duration-200 ${
              isSettingsOpen ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40' : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
