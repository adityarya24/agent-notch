import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CircularProgressRing } from './components/CircularProgressRing';
import { ModelPopoverCard } from './components/ModelPopoverCard';
import { SettingsModal } from './components/SettingsModal';
import { ClaudeIcon, OpenAIClassicIcon, CursorIcon, GeminiIcon, OpenCodeIcon, GrokIcon, SparkIcon } from './components/Icons';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { moveId, sortModelsByOrder } from './modelOrder';

const VISIBLE_RINGS = 4;
const RING_LIST_MAX_H = VISIBLE_RINGS * 54 + (VISIBLE_RINGS - 1) * 12;

function jewelTone(model) {
  if (!model || model.quotaState !== 'known' || model.ringPercent == null) return '#34d399';
  if (model.status === 'critical' || Number(model.ringPercent) >= 80) return '#ef4444';
  if (model.status === 'warning' || Number(model.ringPercent) >= 50) return '#f59e0b';
  return '#10b981';
}

export default function App() {
  const [data, setData] = useState({
    activeModel: 'codex',
    models: [],
    allDetectedIds: [],
    config: null
  });

  const [hoveredModelId, setHoveredModelId] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 100);
  const [flash, setFlash] = useState(null);
  const scrollRef = useRef(null);
  const ignoringClicks = useRef(null);
  const playedHandoffs = useRef(new Set());
  const collapseInitialized = useRef(false);
  const dragRef = useRef({ id: null, startY: 0, active: false });
  const draftOrderRef = useRef(null);
  const configRef = useRef(null);
  const saveRef = useRef(null);
  const [draftOrder, setDraftOrder] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [quotaAlert, setQuotaAlert] = useState(null);
  const hoverTimer = useRef(null);

  useEffect(() => {
    if (window.agentNotchAPI?.getConfig) {
      window.agentNotchAPI.getConfig().then((config) => {
        if (config) setData((prev) => ({ ...prev, config }));
      });
    }
    if (window.agentNotchAPI?.getUsageData) {
      window.agentNotchAPI.getUsageData().then((res) => {
        if (res && res.models) setData(res);
      });
    }

    const unsubs = [];
    if (window.agentNotchAPI?.onUsageUpdated) {
      unsubs.push(window.agentNotchAPI.onUsageUpdated((newData) => {
        if (newData && newData.models) setData(newData);
      }));
    }
    if (window.agentNotchAPI?.onCollapsedChanged) {
      unsubs.push(window.agentNotchAPI.onCollapsedChanged((collapsed) => {
        collapseInitialized.current = true;
        setIsCollapsed(Boolean(collapsed));
        if (!collapsed) setQuotaAlert(null);
      }));
    }
    if (window.agentNotchAPI?.onQuotaAlert) {
      unsubs.push(window.agentNotchAPI.onQuotaAlert((events) => {
        if (Array.isArray(events) && events[0]) setQuotaAlert(events[0]);
      }));
    }
    return () => {
      unsubs.forEach((unsub) => unsub?.());
      clearTimeout(hoverTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!data.config || collapseInitialized.current) return;
    collapseInitialized.current = true;
    setIsCollapsed(Boolean(data.config.collapsed));
  }, [data.config]);

  useEffect(() => {
    const mode = isCollapsed ? 'collapsed' : (isSettingsOpen ? 'settings' : 'dock');
    window.agentNotchAPI?.setOverlayMode?.(mode);
  }, [isCollapsed, isSettingsOpen]);

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

  const handleSaveConfig = async (newCfg) => {
    try {
      if (window.agentNotchAPI?.saveConfig) {
        const result = await window.agentNotchAPI.saveConfig(newCfg);
        if (!result?.success) return result;
        newCfg = result.config || newCfg;
      }
      setData((prev) => ({ ...prev, config: { ...(prev.config || {}), ...newCfg }, reduceMotion: Boolean(newCfg.reduceMotion) }));
      return { success: true, config: newCfg };
    } catch (error) {
      return { success: false, message: error.message || 'Could not save settings' };
    }
  };

  const setCollapsed = async (next) => {
    const previous = isCollapsed;
    collapseInitialized.current = true;
    setHoveredModelId(null);
    setIsSettingsOpen(false);
    if (!next) setQuotaAlert(null);
    setIsCollapsed(next);
    const result = await handleSaveConfig({ ...(data.config || {}), collapsed: next });
    if (result?.success === false) setIsCollapsed(previous);
  };

  const job = data.jobActivity && data.jobActivity.jobStatus === 'running' ? data.jobActivity : null;
  const activeRings = useMemo(() => new Set([
    ...(data.activeRings || []),
    ...(job?.activeRing ? [job.activeRing] : [])
  ]), [data.activeRings, job?.activeRing]);
  const reduceMotion = Boolean(data.reduceMotion) || Boolean(data.config?.reduceMotion);
  configRef.current = data.config;
  saveRef.current = handleSaveConfig;
  const models = useMemo(
    () => sortModelsByOrder(data.models || [], draftOrder || data.config?.modelOrder),
    [data.models, data.config?.modelOrder, draftOrder]
  );

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

  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag.id) return;
      if (!drag.active && Math.abs(event.clientY - drag.startY) < 8) return;
      if (!drag.active) {
        drag.active = true;
        setDraggingId(drag.id);
        setHoveredModelId(null);
        setDraftOrder((prev) => {
          const next = prev || sortModelsByOrder(data.models || [], configRef.current?.modelOrder).map((model) => model.id);
          draftOrderRef.current = next;
          return next;
        });
      }
      const node = document.elementFromPoint(event.clientX, event.clientY);
      const row = node && typeof node.closest === 'function' ? node.closest('[data-model-id]') : null;
      const overId = row ? row.getAttribute('data-model-id') : null;
      if (overId && overId !== drag.id) {
        setDraftOrder((ids) => {
          const next = moveId(ids || [], drag.id, overId);
          draftOrderRef.current = next;
          return next;
        });
      }
      const scroller = scrollRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (event.clientY > rect.bottom - 20) scroller.scrollTop += 12;
        else if (event.clientY < rect.top + 20) scroller.scrollTop -= 12;
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      const order = draftOrderRef.current;
      dragRef.current = { id: null, startY: 0, active: false };
      setDraggingId(null);
      if (drag.active && order && order.length) {
        Promise.resolve(saveRef.current({ ...(configRef.current || {}), modelOrder: order })).finally(() => {
          draftOrderRef.current = null;
          setDraftOrder(null);
        });
        return;
      }
      draftOrderRef.current = null;
      setDraftOrder(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [data.models]);

  const hoveredModel = models.find((m) => m.id === hoveredModelId);
  const jewelModel = models.find((model) => activeRings.has(model.id))
    || [...models]
      .filter((model) => model.quotaState === 'known' && model.ringPercent != null)
      .sort((a, b) => Number(b.ringPercent) - Number(a.ringPercent))[0]
    || null;
  const jewelColor = jewelTone(jewelModel);
  const alertModel = quotaAlert ? models.find((model) => model.id === quotaAlert.id) : null;

  const scheduleHover = (id) => {
    if (isCollapsed || isSettingsOpen || draggingId) return;
    clearTimeout(hoverTimer.current);
    if (reduceMotion) {
      setHoveredModelId(id);
      return;
    }
    hoverTimer.current = setTimeout(() => setHoveredModelId(id), 120);
  };
  const scheduleLeave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredModelId(null), reduceMotion ? 0 : 80);
  };

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
      <div data-hud={isCollapsed ? undefined : true} className="flex items-center justify-end">
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
        ) : quotaAlert && isCollapsed ? (
          <button
            data-hud
            type="button"
            className="notch-toast"
            style={{ borderLeftColor: jewelTone(alertModel), boxShadow: `0 18px 40px rgba(0,0,0,.55), 0 0 18px ${jewelTone(alertModel)}33` }}
            onClick={() => setCollapsed(false)}
          >
            <div
              className="notch-toast-mini"
              style={{ color: jewelTone(alertModel), boxShadow: `inset 0 0 0 2px ${jewelTone(alertModel)}b3` }}
            >
              {getModelIcon(alertModel?.icon || 'spark')}
            </div>
            <div>
              <b>{quotaAlert.name} hit {quotaAlert.percent}%</b>
              <small>{quotaAlert.window} · click to reveal</small>
            </div>
          </button>
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
        className={`group/rail relative bg-[#09090b]/98 backdrop-blur-2xl border-l-2 border-t-2 border-b-2 py-3 px-2 rounded-l-[26px] z-40 overflow-hidden flex flex-col items-center justify-between gap-2 transition-[transform,border-color,opacity,box-shadow] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isCollapsed
            ? 'translate-x-[50px] opacity-100'
            : 'translate-x-0 border-[#27272a] hover:border-[#34d399]/35 opacity-100 shadow-2xl shadow-black/95'
        }`}
        style={{
          transitionDuration: reduceMotion ? '0ms' : '420ms',
          borderColor: isCollapsed ? jewelColor : undefined,
          boxShadow: isCollapsed
            ? `0 0 18px ${jewelColor}47, inset 1px 1px 0 rgba(255,255,255,.04)`
            : undefined
        }}
        onMouseLeave={scheduleLeave}
      >
        {isCollapsed ? (
          <div
            aria-hidden="true"
            className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full pointer-events-none"
            style={{ background: jewelColor }}
          />
        ) : null}
        <button
          data-hud
          type="button"
          onClick={() => setCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Reveal Agent Notch' : 'Tuck away Agent Notch'}
          aria-label={isCollapsed ? 'Reveal Agent Notch' : 'Tuck away Agent Notch'}
          aria-expanded={!isCollapsed}
          className={`absolute z-50 flex items-center justify-center top-1/2 -translate-y-1/2 focus:outline-none transition-[opacity,color] duration-200 ${
            isCollapsed
              ? 'left-0 w-4 h-10 hover:opacity-90'
              : `left-1 w-[18px] h-8 text-neutral-400 hover:text-emerald-300 ${
                  hoveredModel || isSettingsOpen
                    ? 'opacity-0 pointer-events-none'
                    : 'opacity-0 group-hover/rail:opacity-100'
                }`
          }`}
        >
          {isCollapsed ? (
            <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.4} style={{ color: jewelColor }} />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.4} />
          )}
        </button>

        <div
          aria-hidden={isCollapsed}
          className={`ml-auto flex flex-col items-center justify-between gap-2 transition-[opacity,filter] ${isCollapsed ? 'pointer-events-none opacity-0 blur-[1px]' : 'opacity-100 blur-0'}`}
          style={{ transitionDuration: reduceMotion ? '0ms' : '180ms' }}
        >
        {/* Scrollable Model Rings List */}
        <div
          ref={scrollRef}
          data-hud
          className="relative flex flex-col items-center gap-3 overflow-y-auto pr-0.5 scrollbar-none overscroll-contain"
          style={{ maxHeight: RING_LIST_MAX_H, scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          title={models.length > VISIBLE_RINGS ? 'Scroll for more · drag to reorder' : 'Drag to reorder'}
        >
          {models.length > 0 ? (
            models.map((m, index) => {
              const isWork = activeRings.has(m.id);
              const isFrom = Boolean(flash && flash.fromRing === m.id);
              const isTo = Boolean(flash && flash.toRing === m.id);
              return (
              <div
                key={m.id}
                data-hud
                data-model-id={m.id}
                className={`relative flex flex-col items-center gap-0.5 group cursor-grab transition-transform duration-200 ${
                  draggingId === m.id ? 'z-10 scale-105 cursor-grabbing drop-shadow-lg' : ''
                } ${isFrom && !reduceMotion ? 'opacity-40' : 'opacity-100'}`}
                onPointerDown={(event) => {
                  if (isCollapsed || isSettingsOpen || event.button !== 0) return;
                  dragRef.current = { id: m.id, startY: event.clientY, active: false };
                }}
                onMouseEnter={() => scheduleHover(m.id)}
              >
                <CircularProgressRing
                  size={38}
                  strokeWidth={3}
                  progress={m.ringPercent}
                  status={m.status || m.quotaState}
                  isActive={hoveredModelId === m.id}
                  isLive={isWork || isTo}
                  liveDelayMs={index * -170}
                  reduceMotion={reduceMotion}
                >
                  {getModelIcon(m.icon)}
                </CircularProgressRing>
                {isTo && flash && !reduceMotion && (
                  <div className="absolute -left-3 top-3 text-[9px] text-emerald-300 font-mono">→</div>
                )}

                <span className={`text-[10px] font-mono font-bold transition-colors duration-200 ${
                  m.quotaState === 'expired' ? 'text-amber-400' :
                  m.quotaState !== 'known' || m.ringPercent == null ? 'text-neutral-500' :
                  m.status === 'critical' ? 'text-red-400' :
                  m.status === 'warning' ? 'text-amber-400' :
                  'text-emerald-500'
                }`}>
                  {m.quotaState === 'expired' ? 'login' :
                    m.quotaState !== 'known' || m.ringPercent == null ? '—' :
                    `${m.stale ? '~' : ''}${m.ringPercent}%`}
                </span>
              </div>
            );
            })
          ) : (
            <div className="text-[10px] text-neutral-500 font-mono py-2">No models active</div>
          )}
        </div>
        {models.length > VISIBLE_RINGS && !isCollapsed && (
          <div className="pointer-events-none h-3 -mt-3 w-full bg-gradient-to-t from-[#09090b] to-transparent" />
        )}

        {flash && (flash.fromRing || flash.toRing) && (
          <div className="w-full px-0.5 text-center text-[9px] font-mono text-emerald-300 leading-tight" title={flash.routingHint || flash.line}>
            {flash.line}
          </div>
        )}
        <div className="pt-1.5 border-t border-[#27272a]/60 w-full flex justify-center">
          <button
            tabIndex={isCollapsed ? -1 : 0}
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
    </div>
  );
}
