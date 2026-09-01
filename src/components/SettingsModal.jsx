import React, { useEffect, useState } from 'react';
import { X, Check, Sliders, Plus, Trash2 } from 'lucide-react';
import {
  ClaudeIcon,
  OpenAIClassicIcon,
  CursorIcon,
  GeminiIcon,
  OpenCodeIcon,
  GrokIcon,
  SparkIcon
} from './Icons';

const ICON_OPTIONS = [
  { id: 'spark', label: 'Spark', Icon: SparkIcon },
  { id: 'claude', label: 'Claude', Icon: ClaudeIcon },
  { id: 'codex', label: 'Codex', Icon: OpenAIClassicIcon },
  { id: 'gemini', label: 'Gemini', Icon: GeminiIcon },
  { id: 'cursor', label: 'Cursor', Icon: CursorIcon },
  { id: 'grok', label: 'Grok', Icon: GrokIcon },
  { id: 'opencode', label: 'OpenCode', Icon: OpenCodeIcon }
];

function emptyDraft() {
  return {
    name: '',
    icon: 'spark',
    quotaSource: 'unknown',
    sessionUsedPercent: '',
    weeklyUsedPercent: '',
    activityProcess: '',
    command: ''
  };
}

export function SettingsModal({ isOpen, onClose, config, allDetectedIds, onSaveConfig }) {
  const [enabledMap, setEnabledMap] = useState(config?.enabledModels || {
    codex: true,
    claude: true,
    gemini: true,
    cursor: true,
    opencode: true,
    grok: true
  });
  const [customAgents, setCustomAgents] = useState(Array.isArray(config?.customAgents) ? config.customAgents : []);
  const [reduceMotion, setReduceMotion] = useState(Boolean(config?.reduceMotion));
  const [notifyWhenTucked, setNotifyWhenTucked] = useState(config?.notifyWhenTucked !== false);
  const [alertThreshold, setAlertThreshold] = useState(String(Number(config?.alertThreshold) || 80));
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [probe, setProbe] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen || !window.agentNotchAPI?.suggestCustomClis) return;
    window.agentNotchAPI.suggestCustomClis().then((list) => {
      if (Array.isArray(list)) setSuggestions(list);
    }).catch(() => setSuggestions([]));
  }, [isOpen, customAgents]);

  useEffect(() => {
    if (!showAdd) {
      setProbe(null);
      return;
    }
    const cmd = draft.activityProcess.trim();
    if (!cmd || /\s/.test(cmd)) {
      setProbe(null);
      return;
    }
    const timer = setTimeout(() => {
      if (!window.agentNotchAPI?.probeCli) return;
      window.agentNotchAPI.probeCli(cmd).then(setProbe).catch(() => setProbe(null));
    }, 280);
    return () => clearTimeout(timer);
  }, [draft.activityProcess, showAdd]);

  if (!isOpen) return null;

  const availableModels = allDetectedIds && allDetectedIds.length > 0 ? allDetectedIds : [];

  const toggleModel = (id) => {
    setEnabledMap((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const normalizedThreshold = () => Math.max(50, Math.min(100, Number(alertThreshold) || 80));

  const persist = (nextCustom, nextEnabled) => {
    return onSaveConfig({
      ...config,
      enabledModels: nextEnabled || enabledMap,
      customAgents: nextCustom || customAgents,
      reduceMotion,
      notifyWhenTucked,
      alertThreshold: normalizedThreshold()
    });
  };

  const handleSave = async () => {
    setSaveError('');
    const result = await persist(customAgents, enabledMap);
    if (!result || result.success !== false) {
      onClose();
    } else {
      setSaveError(result.message || 'Could not save settings');
    }
  };

  const addAgent = (agent) => {
    const nextCustom = [...customAgents, agent];
    const nextEnabled = { ...enabledMap, [agent.id]: true };
    setCustomAgents(nextCustom);
    setEnabledMap(nextEnabled);
    persist(nextCustom, nextEnabled);
  };

  const addCustom = () => {
    const name = draft.name.trim();
    if (!name || (draft.quotaSource === 'command' && !draft.command.trim())) return;
    addAgent({
      id: item.id ? `custom_${item.id}` : `custom_${Date.now().toString(36)}`,
      name,
      modelName: '',
      provider: 'Custom',
      icon: draft.icon || 'spark',
      quotaSource: draft.quotaSource || 'unknown',
      sessionUsedPercent: draft.sessionUsedPercent === '' ? null : Number(draft.sessionUsedPercent),
      weeklyUsedPercent: draft.weeklyUsedPercent === '' ? null : Number(draft.weeklyUsedPercent),
      activityProcess: draft.activityProcess.trim(),
      command: draft.quotaSource === 'command' ? draft.command.trim() : ''
    });
    setDraft(emptyDraft());
    setShowAdd(false);
    setProbe(null);
  };

  const addFromSuggestion = (item) => {
    addAgent({
      id: `custom_${Date.now().toString(36)}`,
      name: item.name,
      modelName: '',
      provider: item.provider || 'Custom',
      icon: item.icon || 'spark',
      quotaSource: 'unknown',
      sessionUsedPercent: null,
      weeklyUsedPercent: null,
      activityProcess: item.activityProcess || item.command,
      command: ''
    });
  };

  const removeCustom = (id) => {
    const nextCustom = customAgents.filter((a) => a.id !== id);
    const nextEnabled = { ...enabledMap };
    delete nextEnabled[id];
    setCustomAgents(nextCustom);
    setEnabledMap(nextEnabled);
    persist(nextCustom, nextEnabled);
  };

  return (
    <div className="w-[300px] max-h-[460px] bg-[#0e0e12]/98 backdrop-blur-2xl border border-[#27272a] rounded-2xl p-3 text-white shadow-2xl shadow-black/90 flex flex-col">
      <div className="flex items-center justify-between pb-2 border-b border-[#27272a]/70 shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-sm">Notch</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="py-2 flex flex-col gap-1.5 overflow-y-auto pr-1 min-h-0 flex-1">
        <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
          Providers
        </span>
        <p className="text-[10px] text-neutral-500 leading-snug">
          Drag rings on the notch to reorder. First 4 stay in view; scroll for the rest.
        </p>

        {availableModels.map((m) => {
          const isEnabled = enabledMap[m.id] !== false;
          const isCustom = Boolean(m.custom) || String(m.id).startsWith('custom_');
          return (
            <div
              key={m.id}
              className="flex items-center justify-between p-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05]"
            >
              <div className="flex flex-col cursor-pointer flex-1 min-w-0" onClick={() => toggleModel(m.id)}>
                <span className="text-xs font-semibold text-neutral-200 truncate">{m.name}</span>
                <span className="text-[10px] text-neutral-400 truncate">{m.provider}</span>
              </div>
              <div className="flex items-center gap-1.5 ml-2">
                {isCustom && (
                  <button
                    onClick={() => removeCustom(m.id)}
                    className="p-1 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10"
                    title="Remove custom CLI"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <div
                  onClick={() => toggleModel(m.id)}
                  className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${
                    isEnabled ? 'bg-emerald-500 justify-end' : 'bg-neutral-700 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </div>
              </div>
            </div>
          );
        })}

        {suggestions.length > 0 && (
          <div className="mt-1">
            <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
              Found apps / CLIs — click to add
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((item) => (
                <button
                  key={item.id || item.command}
                  onClick={() => addFromSuggestion(item)}
                  title={item.path || item.command}
                  className="px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-[11px] text-neutral-200 hover:border-emerald-500/40 hover:text-white"
                >
                  + {item.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-neutral-500 leading-snug">
              Dash until a quota command exists. No fake live %. Unknown terminals are never registered silently.
            </p>
          </div>
        )}

        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="mt-1 w-full py-2 rounded-xl border border-dashed border-white/15 text-[11px] text-neutral-300 hover:text-white hover:border-emerald-500/40 hover:bg-emerald-500/5 flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add custom CLI
          </button>
        ) : (
          <div className="mt-1 p-2.5 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col gap-2">
            <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider">New CLI</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Display name (e.g. Aider)"
              className="w-full bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-emerald-500/50"
            />
            <input
              value={draft.activityProcess}
              onChange={(e) => setDraft({ ...draft, activityProcess: e.target.value })}
              placeholder="CLI process for glow (optional, e.g. aider)"
              className="w-full bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-emerald-500/50"
            />
            {probe && draft.activityProcess.trim() && (
              <p className={`text-[10px] ${probe.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                {probe.found ? `Found: ${probe.path}` : 'Not on PATH — you can still add it, quota stays unknown'}
              </p>
            )}

            <div className="flex flex-wrap gap-1">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.label}
                  onClick={() => setDraft({ ...draft, icon: opt.id })}
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                    draft.icon === opt.id ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-white/10 text-neutral-400 hover:text-white'
                  }`}
                >
                  <opt.Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            <select
              value={draft.quotaSource}
              onChange={(e) => setDraft({ ...draft, quotaSource: e.target.value })}
              className="w-full bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
            >
              <option value="unknown">Quota later (dash)</option>
              <option value="manual">Manual snapshot %</option>
              <option value="command">JSON quota command</option>
            </select>
            {draft.quotaSource === 'command' && (
              <div className="text-[10px] text-neutral-500 leading-snug">
                <input
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="Command that prints JSON percents"
                  className="mb-1.5 w-full bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-emerald-500/50"
                />
                <p className="font-mono">{'{"sessionUsedPercent":12,"weeklyUsedPercent":40}'}</p>
                <p className="mt-1 text-amber-400/80">Runs this local command when Notch refreshes. Only add commands you trust.</p>
              </div>
            )}
            {draft.quotaSource === 'manual' && (
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.sessionUsedPercent}
                  onChange={(e) => setDraft({ ...draft, sessionUsedPercent: e.target.value })}
                  placeholder="Session %"
                  className="w-1/2 bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.weeklyUsedPercent}
                  onChange={(e) => setDraft({ ...draft, weeklyUsedPercent: e.target.value })}
                  placeholder="Weekly %"
                  className="w-1/2 bg-[#18181b] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAdd(false); setDraft(emptyDraft()); setProbe(null); }}
                className="flex-1 py-1.5 rounded-lg text-[11px] text-neutral-400 hover:text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={addCustom}
                disabled={!draft.name.trim() || (draft.quotaSource === 'command' && !draft.command.trim())}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500 text-[#052e1c] disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-[#27272a]/70 shrink-0 flex flex-col gap-2">
        {saveError ? <p className="px-1 text-[10px] text-red-400">{saveError}</p> : null}
        <label className="flex items-center justify-between gap-3 px-1 text-[10px] text-neutral-400">
          <span>Critical alert at</span>
          <span className="flex items-center gap-1">
            <input
              type="number"
              min="50"
              max="100"
              value={alertThreshold}
              onChange={(event) => setAlertThreshold(event.target.value)}
              onBlur={() => setAlertThreshold(String(normalizedThreshold()))}
              className="w-12 rounded-md border border-white/10 bg-[#18181b] px-1.5 py-1 text-right font-mono text-neutral-200 outline-none focus:border-emerald-500/50"
            />
            <span>%</span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => {
            const next = !reduceMotion;
            setReduceMotion(next);
            onSaveConfig({
              ...config,
              enabledModels: enabledMap,
              customAgents,
              reduceMotion: next,
              notifyWhenTucked,
              alertThreshold: normalizedThreshold()
            });
          }}
          className="flex items-center justify-between px-1 py-0.5 text-[10px] text-neutral-400"
        >
          <span>Handoff animation</span>
          <span className={`px-1.5 py-0.5 rounded ${reduceMotion ? 'bg-white/10 text-neutral-500' : 'bg-emerald-500/20 text-emerald-300'}`}>
            {reduceMotion ? 'off' : 'on'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !notifyWhenTucked;
            setNotifyWhenTucked(next);
            onSaveConfig({
              ...config,
              enabledModels: enabledMap,
              customAgents,
              reduceMotion,
              notifyWhenTucked: next,
              alertThreshold: normalizedThreshold()
            });
          }}
          className="flex items-center justify-between px-1 py-0.5 text-[10px] text-neutral-400"
        >
          <span>Notify when tucked</span>
          <span className={`px-1.5 py-0.5 rounded ${notifyWhenTucked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-neutral-500'}`}>
            {notifyWhenTucked ? 'on' : 'off'}
          </span>
        </button>
        <button
          onClick={handleSave}
          className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-[#052e1c] font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-emerald-500/20"
        >
          <Check className="w-3.5 h-3.5" />
          Apply &amp; Save
        </button>
      </div>
    </div>
  );
}
