import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  FileJson,
  FlaskConical,
  Gauge,
  GitBranch,
  HardDrive,
  LayoutGrid,
  Library,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Power,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import type { EngineConfig, VehicleConfig, SimControls, SimState, DynoPoint } from './sim/types';
import { defaultVehicle, displacement, generateDyno, validateConfig } from './sim';
import { defaultConfig, presets } from './data/presets';
import { EngineAudio } from './audio/EngineAudio';
import { useSimulation } from './hooks/useSimulation';
import { downloadFile, importConfig, readLocal, writeLocal } from './storage';
import EngineEditor from './components/EngineEditor';
import EngineVisual from './components/EngineVisual';
import { Tachometer, LineChart, Waveform, type ChartSeries } from './components/Charts';
import { Field, Range, SelectField, Toggle } from './components/Controls';

type Tab = 'Simulation' | 'Engine' | 'Drivetrain' | 'Dyno' | 'Analysis' | 'Settings';
type Modal = 'library' | 'save' | 'model' | 'shortcuts' | null;
const tabs: { name: Tab; icon: typeof Gauge }[] = [
  { name: 'Simulation', icon: Gauge },
  { name: 'Engine', icon: SlidersHorizontal },
  { name: 'Drivetrain', icon: GitBranch },
  { name: 'Dyno', icon: Activity },
  { name: 'Analysis', icon: AudioLines },
  { name: 'Settings', icon: Settings2 },
];
const orange = '#f58a52',
  mint = '#7dc8a3',
  blue = '#69b5c6';
const initialControls: SimControls = {
  throttle: 0,
  brake: 0,
  clutch: 1,
  gear: 0,
  ignition: false,
  starter: false,
  protective: true,
  vehicleMode: false,
};
const hp = (kw: number) => kw * 1.34102209;
const pretty = (n: number, digits = 0) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : '—';
function Panel({
  title,
  icon: Icon,
  aside,
  children,
  className = '',
}: {
  title: string;
  icon?: typeof Gauge;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>
          {Icon && <Icon size={14} />} {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Stat({
  label,
  value,
  unit,
  accent = false,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={'stat ' + (accent ? 'accent' : '')}>
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        {unit && <small>{unit}</small>}
      </div>
      {children}
    </div>
  );
}
function ModalShell({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,a[href],[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={'modal ' + (wide ? 'modal-wide' : '')}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [tab, setTab] = useState<Tab>('Simulation');
  const [config, setConfig] = useState<EngineConfig>(() => {
    try {
      return importConfig(JSON.stringify(readLocal('engine-lab-active', defaultConfig)), true);
    } catch {
      return structuredClone(defaultConfig);
    }
  });
  const [vehicle, setVehicle] = useState<VehicleConfig>(structuredClone(defaultVehicle));
  const [controls, setControls] = useState(initialControls);
  const [imperial, setImperial] = useState(false),
    [hz, setHz] = useState(1000),
    [speed, setSpeed] = useState(1),
    [paused, setPaused] = useState(false),
    [phases, setPhases] = useState(false);
  const [volume, setVolume] = useState(0.35),
    [audioOn, setAudioOn] = useState(false),
    [audioBusy, setAudioBusy] = useState(false),
    [audioQuality, setAudioQuality] = useState<'economy' | 'high'>('high');
  const audio = useRef<EngineAudio | null>(null);
  const configRef = useRef(config);
  if (!validateConfig(config).some((p) => p.level === 'error')) configRef.current = config;
  const [history, setHistory] = useState<SimState[]>([]),
    [recording, setRecording] = useState(true);
  const lastHistory = useRef(0);
  const [saved, setSaved] = useState<EngineConfig[]>(() => {
    const items = readLocal<unknown[]>('engine-lab-library', []);
    return Array.isArray(items)
      ? items.flatMap((x) => {
          try {
            return [importConfig(JSON.stringify(x), true)];
          } catch {
            return [];
          }
        })
      : [];
  });
  const [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(''),
    [saveName, setSaveName] = useState(''),
    [libraryFilter, setLibraryFilter] = useState('');
  const [dyno, setDyno] = useState<DynoPoint[]>([]),
    [dynoRunning, setDynoRunning] = useState(false),
    [dynoProgress, setDynoProgress] = useState(0),
    [dynoConfig, setDynoConfig] = useState<EngineConfig | null>(null),
    [dynoMetric, setDynoMetric] = useState('output');
  const [chartMin, setChartMin] = useState(0),
    [chartMax, setChartMax] = useState(config.redline),
    [showTorque, setShowTorque] = useState(true),
    [showPower, setShowPower] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null),
    starterTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    sweepTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const heldKeys = useRef(new Set<string>());
  const sim = useSimulation(config, vehicle, controls, hz, speed, paused, (s) =>
    audio.current?.update(s, configRef.current),
  );
  const s = sim.state,
    running = s.status === 'running' || s.status === 'limiter';
  const torqueUnit = imperial ? 'lb·ft' : 'N·m',
    torqueFactor = imperial ? 0.737562 : 1;
  const speedUnit = imperial ? 'mph' : 'km/h',
    speedFactor = imperial ? 2.23694 : 3.6;
  const errors = validateConfig(config).filter((x) => x.level === 'error');
  useEffect(() => {
    writeLocal('engine-lab-active', config);
  }, [config]);
  useEffect(() => {
    if (recording && s.time - lastHistory.current >= 0.1) {
      lastHistory.current = s.time;
      setHistory((h) => [...h.slice(-199), { ...s, firingEvents: [] }]);
    }
    if (s.time < lastHistory.current) {
      lastHistory.current = 0;
      setHistory([]);
    }
  }, [s, recording]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4800);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    audio.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    audio.current?.setQuality(audioQuality);
  }, [audioQuality]);
  useEffect(() => {
    audio.current?.setMuted(!audioOn || paused || speed !== 1);
  }, [audioOn, paused, speed]);
  useEffect(
    () => () => {
      audio.current?.dispose();
      if (starterTimer.current) clearTimeout(starterTimer.current);
      if (sweepTimer.current) clearInterval(sweepTimer.current);
    },
    [],
  );
  async function toggleAudio() {
    if (audioOn) {
      setAudioOn(false);
      return;
    }
    setAudioBusy(true);
    try {
      if (!audio.current) audio.current = new EngineAudio();
      await audio.current.enable();
      audio.current.setVolume(volume);
      audio.current.setQuality(audioQuality);
      audio.current.setMuted(paused || speed !== 1);
      setAudioOn(true);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Audio could not start.');
    } finally {
      setAudioBusy(false);
    }
  }
  function startStop() {
    if (controls.ignition) {
      setControls((c) => ({ ...c, ignition: false, starter: false, throttle: 0 }));
      return;
    }
    if (errors.length) {
      setToast(errors[0].message);
      return;
    }
    if (s.status === 'failed') {
      setToast('Reset the simulation to replace the damaged engine.');
      return;
    }
    setPaused(false);
    setControls((c) => ({ ...c, ignition: true, starter: true }));
    if (starterTimer.current) clearTimeout(starterTimer.current);
    starterTimer.current = setTimeout(() => setControls((c) => ({ ...c, starter: false })), 1300);
  }
  function resetSimulation() {
    setControls({
      ...initialControls,
      protective: controls.protective,
      vehicleMode: controls.vehicleMode,
    });
    sim.reset();
    setHistory([]);
    lastHistory.current = 0;
    setToast('Simulation reset. Damage and telemetry cleared.');
  }
  function shift(delta: number) {
    setControls((c) => ({
      ...c,
      gear: Math.max(0, Math.min(vehicle.gearRatios.length, s.gear + delta)),
      gearRequest: (c.gearRequest ?? 0) + 1,
    }));
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        modal ||
        (e.target as HTMLElement)?.closest('input,select,textarea,[contenteditable=true]') ||
        e.repeat
      )
        return;
      const key = e.key.toLowerCase();
      if (key === ' ' && (e.target as HTMLElement)?.closest('button')) return;
      if (['w', 's', 'arrowup', 'arrowdown'].includes(key)) heldKeys.current.add(key);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key))
        e.preventDefault();
      if (key === ' ') startStop();
      if (key === 'w' || key === 'arrowup') setControls((c) => ({ ...c, throttle: 1 }));
      if (key === 's' || key === 'arrowdown') setControls((c) => ({ ...c, brake: 1 }));
      if (key === 'arrowright' || key === 'd') shift(1);
      if (key === 'arrowleft' || key === 'a') shift(-1);
      if (key === 'n')
        setControls((c) => ({ ...c, gear: 0, gearRequest: (c.gearRequest ?? 0) + 1 }));
      if (key === 'p') setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!heldKeys.current.delete(key)) return;
      if (key === 'w' || key === 'arrowup') setControls((c) => ({ ...c, throttle: 0 }));
      if (key === 's' || key === 'arrowdown') setControls((c) => ({ ...c, brake: 0 }));
    };
    const blur = () => {
      heldKeys.current.clear();
      setControls((c) => ({ ...c, throttle: 0, brake: 0 }));
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [controls.ignition, s.status, s.gear, vehicle.gearRatios.length, modal, errors.length]);
  function loadEngine(c: EngineConfig) {
    if (sweepTimer.current) clearInterval(sweepTimer.current);
    setDynoRunning(false);
    setDynoProgress(0);
    setConfig(structuredClone(c));
    setControls({ ...initialControls, protective: controls.protective });
    sim.reset();
    setDyno([]);
    setDynoConfig(null);
    setChartMax(c.redline);
    setModal(null);
    setToast(`${c.name} loaded. Ready to start.`);
  }
  function newEngine() {
    const c = structuredClone(presets.find((p) => p.id === 'i4') ?? defaultConfig);
    c.id = `custom-${Date.now()}`;
    c.name = 'Untitled engine';
    c.notes =
      'Custom engine, initialized from the generic inline-four. All component values are estimates.';
    loadEngine(c);
    setTab('Engine');
  }
  function saveEngine() {
    const c = { ...config, id: `saved-${Date.now()}`, name: saveName.trim() || config.name };
    const next = [...saved, c];
    if (!writeLocal('engine-lab-library', next)) {
      setToast('Browser storage is full or unavailable. Export JSON to keep this configuration.');
      return;
    }
    setSaved(next);
    setConfig(c);
    setModal(null);
    setToast('Engine saved to your local library.');
  }
  async function handleImport(file: File) {
    try {
      if (file.size > 150000)
        throw new Error('Configuration is too large. Maximum size is 150 KB.');
      loadEngine(importConfig(await file.text()));
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not import that file.');
    }
  }
  function runDyno() {
    if (dynoRunning) {
      if (sweepTimer.current) clearInterval(sweepTimer.current);
      setDynoRunning(false);
      setToast('Sweep stopped. Partial results retained.');
      return;
    }
    if (errors.length) {
      setToast(errors[0].message);
      return;
    }
    const points = generateDyno(config);
    setDynoConfig(structuredClone(config));
    setDyno([]);
    setDynoProgress(0);
    setDynoRunning(true);
    let i = 0;
    sweepTimer.current = setInterval(() => {
      i += 2;
      setDyno(points.slice(0, i));
      setDynoProgress(Math.min(100, (i / points.length) * 100));
      if (i >= points.length) {
        if (sweepTimer.current) clearInterval(sweepTimer.current);
        setDynoRunning(false);
        setToast('Steady-state sweep complete. Results ready to inspect or export.');
      }
    }, 65);
  }
  function exportCsv() {
    if (!dyno.length) return;
    const lines = [
      '# Engine Lab estimated steady-state full-throttle sweep',
      '# Engine: ' + (dynoConfig?.name ?? config.name),
      '# Ambient_C: ' + (dynoConfig?.ambientTemp ?? config.ambientTemp),
      '# Not validated against measured engine data',
      'rpm,torque_Nm,power_kW,power_hp,boost_bar,afr,manifold_kPa,stress_ratio',
      ...dyno.map((p) =>
        [p.rpm, p.torque, p.power, hp(p.power), p.boost, p.afr, p.manifoldPressure, p.stress]
          .map((n) => n.toFixed(3))
          .join(','),
      ),
    ];
    downloadFile('engine-lab-dyno.csv', lines.join('\n'), 'text/csv');
  }
  const dynoSeries = useMemo<ChartSeries[]>(() => {
    const make = (key: keyof DynoPoint, name: string, color: string, unit: string, factor = 1) => ({
      name,
      color,
      unit,
      values: dyno.map((p) => ({ x: p.rpm, y: (p[key] as number) * factor })),
    });
    if (dynoMetric === 'boost') return [make('boost', 'Boost', blue, 'bar')];
    if (dynoMetric === 'afr') return [make('afr', 'Air–fuel ratio', mint, ':1')];
    if (dynoMetric === 'map') return [make('manifoldPressure', 'Manifold pressure', blue, 'kPa')];
    if (dynoMetric === 'stress') return [make('stress', 'Stress envelope', orange, '%', 100)];
    return [
      ...(showTorque ? [make('torque', 'Torque', orange, torqueUnit, torqueFactor)] : []),
      ...(showPower ? [make('power', 'Power', mint, 'hp', 1.34102209)] : []),
    ];
  }, [dyno, dynoMetric, showTorque, showPower, imperial]);
  const peakTorque = dyno.length ? dyno.reduce((a, b) => (a.torque > b.torque ? a : b)) : null,
    peakPower = dyno.length ? dyno.reduce((a, b) => (a.power > b.power ? a : b)) : null;
  const performanceSeries: ChartSeries[] = [
    {
      name: 'Torque',
      color: orange,
      unit: torqueUnit,
      values: history.map((p) => ({ x: p.time, y: p.torque * torqueFactor })),
    },
    {
      name: 'Power',
      color: mint,
      unit: 'hp',
      values: history.map((p) => ({ x: p.time, y: hp(p.power) })),
    },
  ];
  const pageDescription: Record<Tab, string> = {
    Simulation: 'Build. Run. Understand your engine.',
    Engine: 'Every component changes the conversation.',
    Drivetrain: 'Connect the crankshaft to the road.',
    Dyno: 'A repeatable sweep. A clearer picture.',
    Analysis: 'Look closer at what the engine is telling you.',
    Settings: 'Tune your workspace to your machine.',
  };
  const engineLabel = `${config.layout === 'v' ? 'V' : config.layout === 'boxer' ? 'F' : config.layout === 'single' ? 'S' : 'I'}${config.cylinders}`;
  const temp = imperial ? s.temperature * 1.8 + 32 : s.temperature;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('Simulation');
          }}
          aria-label="Engine Lab home"
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            ENGINE<span className="brand-light">LAB</span>
            <small>VIRTUAL ENGINEERING</small>
          </span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Workspace">
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? 'nav-item active' : 'nav-item'}
              aria-current={tab === name ? 'page' : undefined}
              onClick={() => setTab(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === tab && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-project">
          <div className="project-icon">
            <FlaskConical size={18} />
          </div>
          <span>
            Personal workspace<small>Saved on this device</small>
          </span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal('model')}>
            <BookOpen size={16} /> Model & assumptions <ArrowUpRight size={13} />
          </button>
          <button onClick={() => setModal('shortcuts')}>
            <CircleHelp size={16} /> Help & shortcuts
          </button>
          <div className="version">
            <span className="status-dot" /> SYSTEM ONLINE <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <HardDrive size={12} /> LOCAL SESSION
            </span>
            <span className={'engine-status ' + (running ? 'is-running' : '')}>
              <span className="status-dot" />
              {paused ? 'PAUSED' : s.status.toUpperCase()}
            </span>
            <button
              className="avatar"
              title="Personal local workspace"
              onClick={() => setModal('library')}
            >
              EL
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ENGINE DEVELOPMENT ENVIRONMENT</div>
              <h1>
                {tab === 'Simulation'
                  ? 'Simulation workspace'
                  : tab === 'Engine'
                    ? 'Engine builder'
                    : tab === 'Dyno'
                      ? 'Dynamometer'
                      : tab === 'Analysis'
                        ? 'Engine analysis'
                        : tab === 'Settings'
                          ? 'Workspace settings'
                          : 'Drivetrain & vehicle'}
              </h1>
              <p>{pageDescription[tab]}</p>
            </div>
            <div className="page-actions">
              <button className="button" onClick={() => setModal('library')}>
                <Library size={15} /> Engine library{' '}
                <span className="button-key">{presets.length}</span>
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setSaveName(config.name);
                  setModal('save');
                }}
              >
                <Save size={14} /> Save engine
              </button>
            </div>
          </div>
          <div className="engine-ribbon">
            <div className="engine-ribbon-main">
              <span className="engine-ribbon-icon">
                <LayoutGrid size={18} />
              </span>
              <div>
                <span className="overline">ACTIVE ENGINE</span>
                <button onClick={() => setModal('library')}>
                  {config.name}
                  <ChevronDown size={13} />
                </button>
              </div>
              <span className="tag">{engineLabel}</span>
              <span className="tag subtle">
                {config.aspiration === 'natural'
                  ? 'Naturally aspirated'
                  : config.aspiration === 'turbo'
                    ? 'Turbocharged'
                    : 'Supercharged'}
              </span>
            </div>
            <div className="ribbon-specs">
              <span>
                {displacement(config).toFixed(2)} <small>L</small>
              </span>
              <i />
              <span>
                {config.compression.toFixed(1)}
                <small> : 1</small>
              </span>
              <i />
              <span>
                {pretty(config.redline)} <small>RPM LIMIT</small>
              </span>
              <button
                className="icon-button"
                title="Export engine JSON"
                aria-label="Export engine JSON"
                onClick={() =>
                  downloadFile(
                    'engine-lab-config.json',
                    JSON.stringify({ schemaVersion: 1, engine: config }, null, 2),
                  )
                }
              >
                <Download size={15} />
              </button>
            </div>
          </div>
          {sim.error && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              {sim.error}
            </div>
          )}
          {errors.length > 0 && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              <span>
                {errors.map((e) => e.message).join(' ')} Simulation retains the last valid
                configuration until these inputs are corrected.
              </span>
            </div>
          )}
          {(tab === 'Simulation' || tab === 'Engine') && (
            <div className={'simulation-grid ' + (tab === 'Engine' ? 'builder-view' : '')}>
              <Panel
                title="Engine configuration"
                icon={SlidersHorizontal}
                className="configuration-panel"
                aside={
                  <button className="tiny-button" onClick={newEngine}>
                    <Plus size={12} /> New
                  </button>
                }
              >
                <EngineEditor
                  config={config}
                  onChange={setConfig}
                  imperial={imperial}
                  advanced={tab === 'Engine'}
                />
                <div className="config-actions">
                  <button
                    onClick={() => {
                      setConfig({
                        ...config,
                        id: `custom-${Date.now()}`,
                        name: config.name + ' · copy',
                      });
                      setToast('Configuration duplicated. Edit and save your new engine.');
                    }}
                  >
                    <Copy size={12} /> Duplicate
                  </button>
                  <button onClick={() => fileInput.current?.click()}>
                    <Upload size={12} /> Import JSON
                  </button>
                </div>
              </Panel>
              <div className="simulation-center">
                <Panel
                  title="Engine overview"
                  icon={LayoutGrid}
                  className="overview-panel"
                  aside={
                    <span className="panel-chip">
                      <span className="status-dot" /> LIVE SIMULATION
                    </span>
                  }
                >
                  <div className="view-toolbar">
                    <div className="segmented">
                      <button
                        className={!phases ? 'selected' : ''}
                        onClick={() => setPhases(false)}
                      >
                        Top view
                      </button>
                      <button
                        className={phases ? 'selected' : ''}
                        onClick={() => setPhases((p) => !p)}
                      >
                        Cycle phases
                      </button>
                    </div>
                    <div className="view-speed">
                      <span>Playback</span>
                      <select
                        aria-label="Playback speed"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                      >
                        <option value="1">1× real-time</option>
                        <option value="0.1">0.1× slow motion</option>
                        <option value="0.025">0.025× inspection</option>
                      </select>
                    </div>
                    <button
                      className={'tiny-button ignition-quick ' + (running ? 'running' : '')}
                      aria-label="Toggle ignition"
                      title="Start or stop engine"
                      onClick={startStop}
                      disabled={errors.length > 0}
                    >
                      <Power size={11} />
                      {controls.ignition ? 'Stop' : 'Start'}
                    </button>
                  </div>
                  <EngineVisual config={config} state={s} phases={phases} />
                  <div className="visual-footnote">
                    <span className="legend-dot orange" /> Combustion event{' '}
                    <span className="legend-dot neutral" /> Inactive cylinder{' '}
                    <span className="push-right">
                      {s.rpm > 1500 ? '48 ms event persistence' : 'Crank-synchronized'}
                      <span title="Each actual firing event remains visible for 48 ms of simulation time. At high RPM this shows activity, not an instantaneous photograph.">
                        <CircleHelp size={11} />
                      </span>
                    </span>
                  </div>
                </Panel>
                <Panel
                  title="Live instruments"
                  icon={Gauge}
                  className="instruments-panel"
                  aside={<span className="small-label">ESTIMATED OUTPUT</span>}
                >
                  <div className="instrument-layout">
                    <div className="tach-wrap">
                      <Tachometer rpm={s.rpm} redline={config.redline} running={running} />
                    </div>
                    <div className="instrument-stats">
                      <Stat
                        label="VEHICLE SPEED"
                        value={pretty(s.speed * speedFactor)}
                        unit={speedUnit}
                      />
                      <Stat
                        label="CURRENT GEAR"
                        value={s.gear === 0 ? 'N' : String(s.gear)}
                        unit={vehicle.mode === 'automatic' ? 'AUTO' : 'MANUAL'}
                      />
                      <Stat
                        label="BRAKE TORQUE"
                        value={pretty(s.torque * torqueFactor)}
                        unit={torqueUnit}
                        accent
                      />
                      <Stat label="ENGINE POWER" value={pretty(hp(s.power))} unit="hp" />
                      <Stat
                        label={
                          config.aspiration === 'natural' ? 'MANIFOLD PRESSURE' : 'BOOST PRESSURE'
                        }
                        value={
                          config.aspiration === 'natural'
                            ? pretty(s.manifoldPressure)
                            : s.boost.toFixed(2)
                        }
                        unit={config.aspiration === 'natural' ? 'kPa' : 'bar'}
                      />
                      <Stat
                        label="COOLANT TEMP."
                        value={pretty(temp)}
                        unit={imperial ? '°F' : '°C'}
                      />
                    </div>
                  </div>
                  <div className="instrument-bottom">
                    <span>
                      CRANK ANGLE <b>{s.crankAngle.toFixed(1)}°</b>
                    </span>
                    <span>
                      FIRING INTERVAL <b>{pretty(720 / config.cylinders, 0)}° avg.</b>
                    </span>
                    <span>
                      DISPLACEMENT <b>{displacement(config).toFixed(2)} L</b>
                    </span>
                  </div>
                </Panel>
                <Panel
                  title="Simulation controls"
                  icon={SlidersHorizontal}
                  className="controls-panel"
                  aside={
                    <button className="text-button" onClick={() => setModal('shortcuts')}>
                      Keyboard controls <span className="keyboard-symbol">⌘</span>
                    </button>
                  }
                >
                  <div className="transport-controls">
                    <button
                      className={
                        'button start-button ' + (controls.ignition ? 'stop-button' : 'primary')
                      }
                      onClick={startStop}
                      disabled={errors.length > 0}
                    >
                      <Power size={16} />
                      {controls.ignition ? 'Stop engine' : 'Start engine'}
                      <kbd>SPACE</kbd>
                    </button>
                    <button
                      className="button square-button"
                      onClick={() => setPaused((p) => !p)}
                      aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
                      title={paused ? 'Resume simulation' : 'Pause simulation'}
                    >
                      {paused ? <Play size={16} /> : <Pause size={16} />}
                    </button>
                    <button
                      className="button square-button"
                      onClick={resetSimulation}
                      title="Reset simulation"
                      aria-label="Reset simulation"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <div className="mode-switch">
                      <button
                        className={!controls.vehicleMode ? 'selected' : ''}
                        onClick={() => setControls((c) => ({ ...c, vehicleMode: false }))}
                      >
                        Free rev
                      </button>
                      <button
                        className={controls.vehicleMode ? 'selected' : ''}
                        onClick={() => setControls((c) => ({ ...c, vehicleMode: true }))}
                      >
                        Vehicle
                      </button>
                    </div>
                  </div>
                  <Range
                    label="Throttle"
                    value={controls.throttle}
                    onChange={(v) => setControls((c) => ({ ...c, throttle: v }))}
                    display={`${Math.round(controls.throttle * 100)}%`}
                  />
                  <div className="range-end-labels">
                    <span>CLOSED</span>
                    <span>W / ↑ TO REV</span>
                    <span>WIDE OPEN</span>
                  </div>
                  {controls.vehicleMode && (
                    <div className="vehicle-controls">
                      <Range
                        label="Brake"
                        value={controls.brake}
                        onChange={(v) => setControls((c) => ({ ...c, brake: v }))}
                        display={`${Math.round(controls.brake * 100)}%`}
                      />
                      <div className="gear-controls">
                        <span>GEAR</span>
                        <button
                          className="button square-button"
                          onClick={() => shift(-1)}
                          disabled={s.gear === 0}
                          aria-label="Shift down"
                        >
                          <ArrowDown size={15} />
                        </button>
                        <strong>{s.gear || 'N'}</strong>
                        <button
                          className="button square-button"
                          onClick={() => shift(1)}
                          disabled={s.gear >= vehicle.gearRatios.length}
                          aria-label="Shift up"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="tiny-button"
                          onClick={() =>
                            setControls((c) => ({
                              ...c,
                              gear: 0,
                              gearRequest: (c.gearRequest ?? 0) + 1,
                            }))
                          }
                        >
                          Neutral
                        </button>
                      </div>
                      {vehicle.mode === 'manual' && (
                        <>
                          <Range
                            label="Clutch engagement"
                            value={controls.clutch}
                            onChange={(v) => setControls((c) => ({ ...c, clutch: v }))}
                            display={`${Math.round(controls.clutch * 100)}%`}
                          />
                          <p className="field-note">
                            Release clutch to 0% before selecting first gear; engage gradually with
                            throttle to launch.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="protective-row">
                    <ShieldCheck size={15} />
                    <span>
                      Engine protection{' '}
                      <small>
                        {controls.protective
                          ? 'Limits operation near mechanical & thermal bounds'
                          : 'Experimental · damage and failure enabled'}
                      </small>
                    </span>
                    <Toggle
                      label="Protective mode"
                      checked={controls.protective}
                      onChange={(v) => setControls((c) => ({ ...c, protective: v }))}
                    />
                  </div>
                </Panel>
              </div>
              <div className="diagnostics-column">
                <Panel
                  title="Live performance"
                  icon={Activity}
                  aside={
                    <button
                      className="icon-button"
                      title="Open dyno workspace"
                      aria-label="Open dyno workspace"
                      onClick={() => setTab('Dyno')}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <div className="performance-values">
                    <div>
                      <span>TORQUE</span>
                      <strong>
                        {pretty(s.torque * torqueFactor)}
                        <small>{torqueUnit}</small>
                      </strong>
                    </div>
                    <div>
                      <span>POWER</span>
                      <strong>
                        {pretty(hp(s.power))}
                        <small>hp</small>
                      </strong>
                    </div>
                  </div>
                  <div className="mini-chart">
                    <LineChart
                      series={performanceSeries}
                      xLabel="Time (s)"
                      yLabel="Estimated output"
                      width={350}
                      height={210}
                      emptyMessage="Start engine to record output"
                    />
                  </div>
                  <div className="chart-panel-footer">
                    <span className="status-dot" /> Rolling{' '}
                    {history.length ? Math.min(20, history.length / 10).toFixed(0) : '20'} s window{' '}
                    <button
                      onClick={() => setRecording((r) => !r)}
                      aria-label={recording ? 'Freeze telemetry' : 'Resume telemetry'}
                    >
                      {recording ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                  </div>
                </Panel>
                <Panel
                  title="Engine health"
                  icon={ShieldCheck}
                  aside={
                    <span className={'health-badge ' + (s.stress >= 1 ? 'warning' : '')}>
                      {s.status === 'failed' ? 'FAILED' : s.stress >= 1 ? 'AT LIMIT' : 'NOMINAL'}
                    </span>
                  }
                >
                  <div className="health-content">
                    <div className="health-label">
                      <span>Limit utilization</span>
                      <strong>
                        {pretty(s.stress * 100)}
                        <small>%</small>
                      </strong>
                    </div>
                    <div className="meter">
                      <span
                        style={{
                          width: `${Math.min(100, s.stress * 100)}%`,
                          background: s.stress >= 1 ? '#e7786e' : mint,
                        }}
                      />
                    </div>
                    <div className="health-scale">
                      <span>LOW</span>
                      <span>LIMIT</span>
                    </div>
                    <div className="health-data">
                      <span>
                        Mean piston speed
                        <strong>
                          {s.pistonSpeed.toFixed(1)} <small>m/s</small>
                        </strong>
                      </span>
                      <span>
                        Rod load envelope
                        <strong>
                          {s.rodForce.toFixed(1)} <small>kN</small>
                        </strong>
                      </span>
                      <span>
                        Accumulated damage
                        <strong>
                          {(s.damage * 100).toFixed(2)} <small>%</small>
                        </strong>
                      </span>
                      <span>
                        Air–fuel ratio
                        <strong>
                          {s.afr.toFixed(1)} <small>: 1</small>
                        </strong>
                      </span>
                    </div>
                    {s.warnings.length > 0 ? (
                      <div className="health-warnings">
                        {s.warnings.map((w) => (
                          <p key={w}>
                            <AlertTriangle size={12} />
                            {w}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <div className="nominal-note">
                        <Check size={12} /> Within configured limits
                      </div>
                    )}
                    <p className="estimate-note">
                      Simplified stress estimates. Not a certified engineering calculation.
                    </p>
                  </div>
                </Panel>
                <Panel
                  title="Audio output"
                  icon={AudioLines}
                  aside={<span className="small-label">SYNTHESIZED</span>}
                >
                  <div className="audio-controls">
                    <button
                      className={'audio-toggle ' + (audioOn ? 'enabled' : '')}
                      onClick={toggleAudio}
                      disabled={audioBusy}
                    >
                      {audioBusy ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : audioOn ? (
                        <Volume2 size={18} />
                      ) : (
                        <VolumeX size={18} />
                      )}
                      <span>
                        {audioOn ? 'Audio enabled' : 'Enable engine audio'}
                        <small>
                          {paused || speed !== 1
                            ? 'Muted during pause / slow motion'
                            : 'Headphones recommended'}
                        </small>
                      </span>
                      <span className="audio-state">{audioOn ? 'ON' : 'OFF'}</span>
                    </button>
                    <Range
                      label="Output volume"
                      value={volume}
                      onChange={setVolume}
                      display={`${Math.round(volume * 100)}%`}
                    />
                    <Waveform
                      analyser={audio.current?.getAnalyser() ?? null}
                      active={audioOn && !paused && running && speed === 1}
                      kind="waveform"
                    />
                  </div>
                </Panel>
              </div>
            </div>
          )}
          {tab === 'Drivetrain' && (
            <div className="two-column-page">
              <div>
                <Panel title="Transmission" icon={GitBranch}>
                  <div className="settings-content">
                    <div className="form-grid">
                      {' '}
                      <SelectField
                        label="Transmission mode"
                        value={vehicle.mode}
                        onChange={(v) =>
                          setVehicle((p) => ({ ...p, mode: v as VehicleConfig['mode'] }))
                        }
                        options={[
                          { value: 'manual', label: 'Manual clutch' },
                          { value: 'automatic', label: 'Automatic / slipping launch' },
                        ]}
                      />
                      <Field
                        label="Final drive"
                        value={vehicle.finalDrive}
                        min={1}
                        max={8}
                        step={0.01}
                        unit=": 1"
                        onChange={(v) => setVehicle((p) => ({ ...p, finalDrive: v }))}
                      />
                      <Field
                        label="Drivetrain efficiency"
                        value={vehicle.efficiency * 100}
                        min={50}
                        max={100}
                        step={1}
                        unit="%"
                        onChange={(v) => setVehicle((p) => ({ ...p, efficiency: v / 100 }))}
                      />
                      <Field
                        label="Automatic upshift"
                        value={vehicle.shiftRpm}
                        min={2000}
                        max={14000}
                        step={100}
                        unit="rpm"
                        onChange={(v) => setVehicle((p) => ({ ...p, shiftRpm: v }))}
                      />
                    </div>
                    <div className="subsection-label">Forward gear ratios</div>
                    <div className="gear-ratios">
                      {vehicle.gearRatios.map((g, i) => (
                        <Field
                          key={i}
                          label={`Gear ${i + 1}`}
                          value={g}
                          min={0.1}
                          max={8}
                          step={0.01}
                          unit=":1"
                          onChange={(v) =>
                            setVehicle((p) => ({
                              ...p,
                              gearRatios: p.gearRatios.map((r, j) => (i === j ? v : r)),
                            }))
                          }
                        />
                      ))}
                    </div>
                    <p className="field-note">
                      Automatic mode includes an approximate torque-converter launch and shifts at
                      the configured RPM. Manual mode couples the engine through a slipping clutch.
                      Reverse and synchronizer dynamics are not modeled.
                    </p>
                  </div>
                </Panel>
                <Panel title="Vehicle & road load" icon={Car}>
                  <div className="settings-content form-grid">
                    <Field
                      label="Vehicle mass"
                      value={vehicle.mass * (imperial ? 2.20462 : 1)}
                      onChange={(v) =>
                        setVehicle((p) => ({ ...p, mass: v / (imperial ? 2.20462 : 1) }))
                      }
                      unit={imperial ? 'lb' : 'kg'}
                      min={imperial ? 220 : 100}
                      max={imperial ? 22046 : 10000}
                      step={10}
                    />
                    <Field
                      label="Loaded tire radius"
                      value={vehicle.tireRadius * (imperial ? 39.3701 : 1000)}
                      onChange={(v) =>
                        setVehicle((p) => ({ ...p, tireRadius: v / (imperial ? 39.3701 : 1000) }))
                      }
                      unit={imperial ? 'in' : 'mm'}
                      min={imperial ? 4 : 100}
                      max={imperial ? 40 : 1000}
                    />
                    <Field
                      label="Drag coefficient"
                      value={vehicle.dragCoefficient}
                      min={0.1}
                      max={2}
                      step={0.01}
                      unit="Cd"
                      onChange={(v) => setVehicle((p) => ({ ...p, dragCoefficient: v }))}
                    />
                    <Field
                      label="Frontal area"
                      value={vehicle.frontalArea}
                      min={0.3}
                      max={10}
                      step={0.1}
                      unit="m²"
                      onChange={(v) => setVehicle((p) => ({ ...p, frontalArea: v }))}
                    />
                    <Field
                      label="Rolling resistance"
                      value={vehicle.rollingResistance}
                      min={0.001}
                      max={0.1}
                      step={0.001}
                      unit="Crr"
                      onChange={(v) => setVehicle((p) => ({ ...p, rollingResistance: v }))}
                    />
                  </div>
                </Panel>
              </div>
              <div>
                <Panel title="Power flow" icon={Zap}>
                  <div className="power-flow">
                    <div>
                      <Gauge size={25} />
                      <span>CRANKSHAFT</span>
                      <strong>
                        {pretty(s.rpm)} <small>rpm</small>
                      </strong>
                    </div>
                    <ChevronDown size={20} />
                    <div>
                      <GitBranch size={25} />
                      <span>{s.gear ? 'GEAR ' + s.gear : 'NEUTRAL'}</span>
                      <strong>
                        {s.gear ? vehicle.gearRatios[s.gear - 1].toFixed(2) : '—'}{' '}
                        <small>: 1</small>
                      </strong>
                    </div>
                    <ChevronDown size={20} />
                    <div>
                      <Car size={25} />
                      <span>ROAD SPEED</span>
                      <strong>
                        {pretty(s.speed * speedFactor, 1)} <small>{speedUnit}</small>
                      </strong>
                    </div>
                  </div>
                  <div className="settings-content">
                    <Toggle
                      label="Vehicle load"
                      checked={controls.vehicleMode}
                      onChange={(v) => setControls((c) => ({ ...c, vehicleMode: v }))}
                      hint="Connect engine to transmission and road load."
                    />
                    <button className="button full-width" onClick={() => setTab('Simulation')}>
                      Open simulation controls
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </Panel>
                <div className="info-card">
                  <InfoIcon />
                  <p>
                    Gearing changes reflected engine load, wheel torque and road speed. Tire slip,
                    gradients, differential behavior and suspension are outside this model.
                  </p>
                </div>
              </div>
            </div>
          )}
          {tab === 'Dyno' && (
            <div className="dyno-page">
              <Panel
                title="Steady-state dynamometer"
                icon={Activity}
                aside={<span className="tag">SIMULATED ESTIMATES</span>}
              >
                <div className="dyno-toolbar">
                  <div>
                    <strong>{dynoConfig?.name ?? config.name}</strong>
                    <p>
                      Wide-open throttle · equilibrium boost ·{' '}
                      {dynoConfig?.ambientTemp ?? config.ambientTemp} °C ambient · brake output
                    </p>
                  </div>
                  <div className="button-group">
                    <button className="button" disabled={!dyno.length} onClick={exportCsv}>
                      <ArrowDownToLine size={14} />
                      Export CSV
                    </button>
                    <button
                      className={'button ' + (dynoRunning ? '' : 'primary')}
                      onClick={runDyno}
                    >
                      {dynoRunning ? <Square size={13} /> : <Play size={14} />}{' '}
                      {dynoRunning ? 'Stop sweep' : 'Run dyno sweep'}
                    </button>
                  </div>
                </div>
                <div className="dyno-progress">
                  <span style={{ width: `${dynoProgress}%` }} />
                </div>
                <div className="dyno-tabs segmented">
                  {[
                    { id: 'output', name: 'Torque & power' },
                    { id: 'boost', name: 'Boost' },
                    { id: 'afr', name: 'Air–fuel ratio' },
                    { id: 'map', name: 'Manifold pressure' },
                    { id: 'stress', name: 'Stress' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={dynoMetric === t.id ? 'selected' : ''}
                      onClick={() => setDynoMetric(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <div className="large-chart">
                  <LineChart
                    series={dynoSeries}
                    markPeaks
                    xLabel="Engine speed (rpm)"
                    yLabel={
                      dynoMetric === 'output'
                        ? `Torque (${torqueUnit}) / Power (hp)`
                        : dynoMetric === 'boost'
                          ? 'Boost (bar gauge)'
                          : dynoMetric === 'afr'
                            ? 'AFR (:1)'
                            : dynoMetric === 'map'
                              ? 'Intake pressure (kPa)'
                              : 'Limit utilization (%)'
                    }
                    height={300}
                    xMin={chartMin}
                    xMax={chartMax}
                    redline={dynoConfig?.redline ?? config.redline}
                    emptyMessage="Run a sweep to calculate this engine’s output curve."
                  />
                </div>
                <div className="graph-options">
                  <div>
                    <Field
                      label="Minimum RPM"
                      value={chartMin}
                      min={0}
                      max={chartMax - 100}
                      step={100}
                      onChange={setChartMin}
                    />
                    <Field
                      label="Maximum RPM"
                      value={chartMax}
                      min={chartMin + 100}
                      max={16000}
                      step={100}
                      onChange={setChartMax}
                    />
                  </div>
                  {dynoMetric === 'output' && (
                    <div className="graph-checkboxes">
                      <label>
                        <input
                          type="checkbox"
                          checked={showTorque}
                          onChange={(e) => setShowTorque(e.target.checked)}
                        />
                        Torque
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={showPower}
                          onChange={(e) => setShowPower(e.target.checked)}
                        />
                        Power
                      </label>
                    </div>
                  )}
                  <span className="small-label">
                    {dynoRunning
                      ? `SWEEPING · ${pretty(dynoProgress)}%`
                      : dyno.length
                        ? `${dyno.length} SAMPLES · HOVER TO INSPECT`
                        : 'AWAITING SWEEP'}
                  </span>
                </div>
              </Panel>
              <div className="dyno-summary">
                <Panel title="Peak torque">
                  <Stat
                    label={peakTorque ? `AT ${pretty(peakTorque.rpm)} RPM` : 'NO SWEEP DATA'}
                    value={peakTorque ? pretty(peakTorque.torque * torqueFactor) : '—'}
                    unit={torqueUnit}
                    accent
                  />
                </Panel>
                <Panel title="Peak power">
                  <Stat
                    label={peakPower ? `AT ${pretty(peakPower.rpm)} RPM` : 'NO SWEEP DATA'}
                    value={peakPower ? pretty(hp(peakPower.power)) : '—'}
                    unit="hp"
                  />
                </Panel>
                <Panel title="Test conditions">
                  <div className="test-conditions">
                    <span>
                      Throttle<strong>100%</strong>
                    </span>
                    <span>
                      Boost<strong>Equilibrium envelope</strong>
                    </span>
                    <span>
                      State
                      <strong>
                        {dynoRunning ? 'Calculating' : dyno.length ? 'Sweep retained' : 'Ready'}
                      </strong>
                    </span>
                  </div>
                </Panel>
              </div>
              <div className="info-card">
                <InfoIcon />
                <p>
                  This repeatable analytical sweep uses the same brake-torque, airflow and stress
                  functions as the live simulation. It assumes equilibrium boost and holds each RPM
                  independently; turbo lag, transient heating and inertia are excluded.{' '}
                  {dynoConfig && JSON.stringify(dynoConfig) !== JSON.stringify(config) && (
                    <strong>Engine settings changed. Run another sweep to update results.</strong>
                  )}
                </p>
              </div>
            </div>
          )}
          {tab === 'Analysis' && (
            <div className="analysis-page">
              <div className="analysis-toolbar">
                <span>
                  <span className="status-dot" />
                  {recording
                    ? 'Recording live engine telemetry'
                    : 'Telemetry frozen for inspection'}
                </span>
                <button className="button" onClick={() => setRecording((r) => !r)}>
                  {recording ? <Pause size={14} /> : <Play size={14} />}{' '}
                  {recording ? 'Freeze telemetry' : 'Resume telemetry'}
                </button>
              </div>
              <div className="analysis-grid">
                <Panel title="Throttle & engine load" icon={SlidersHorizontal}>
                  <div className="analysis-chart">
                    <LineChart
                      series={[
                        {
                          name: 'Throttle',
                          color: orange,
                          unit: '%',
                          values: history.map((p) => ({ x: p.time, y: p.throttle * 100 })),
                        },
                        {
                          name: 'Load',
                          color: blue,
                          unit: '%',
                          values: history.map((p) => ({ x: p.time, y: p.load * 100 })),
                        },
                      ]}
                      xLabel="Time (s)"
                      yLabel="Utilization (%)"
                      yMax={100}
                    />
                  </div>
                </Panel>
                <Panel title="Mechanical & thermal limits" icon={ShieldCheck}>
                  <div className="analysis-chart">
                    <LineChart
                      series={[
                        {
                          name: 'Stress',
                          color: orange,
                          unit: '%',
                          values: history.map((p) => ({ x: p.time, y: p.stress * 100 })),
                        },
                        {
                          name: 'Thermal limit',
                          color: mint,
                          unit: '%',
                          values: history.map((p) => ({
                            x: p.time,
                            y:
                              ((p.temperature - config.ambientTemp) /
                                (config.maxTemp - config.ambientTemp)) *
                              100,
                          })),
                        },
                      ]}
                      xLabel="Time (s)"
                      yLabel="Limit utilization (%)"
                    />
                  </div>
                </Panel>
                <Panel title="Audio waveform" icon={Waves}>
                  <div className="analysis-audio">
                    <Waveform
                      analyser={audio.current?.getAnalyser() ?? null}
                      active={audioOn && running && !paused && speed === 1}
                      kind="waveform"
                    />
                    <p className="field-note">
                      Actual post-limiter output samples. Enable audio in the simulation or
                      settings.
                    </p>
                  </div>
                </Panel>
                <Panel title="Frequency spectrum" icon={AudioLines}>
                  <div className="analysis-audio">
                    <Waveform
                      analyser={audio.current?.getAnalyser() ?? null}
                      active={audioOn && running && !paused && speed === 1}
                      kind="spectrum"
                    />
                    <p className="field-note">
                      FFT of the synthesized output. Frequency response is illustrative, not
                      measured.
                    </p>
                  </div>
                </Panel>
                <Panel title="Manifold & boost dynamics" icon={Activity}>
                  <div className="analysis-chart">
                    <LineChart
                      series={[
                        {
                          name: 'Intake absolute',
                          color: blue,
                          unit: 'kPa',
                          values: history.map((p) => ({ x: p.time, y: p.manifoldPressure })),
                        },
                      ]}
                      xLabel="Time (s)"
                      yLabel="Manifold pressure (kPa)"
                    />
                  </div>
                </Panel>
                <Panel title="Piston & rod envelope" icon={Gauge}>
                  <div className="analysis-metrics">
                    <Stat label="MEAN PISTON SPEED" value={s.pistonSpeed.toFixed(1)} unit="m/s" />
                    <Stat label="ROD FORCE ESTIMATE" value={s.rodForce.toFixed(1)} unit="kN" />
                    <Stat label="ACCUMULATED DAMAGE" value={(s.damage * 100).toFixed(3)} unit="%" />
                    <Stat
                      label="FIRING FREQUENCY"
                      value={pretty((s.rpm / 120) * config.cylinders, 1)}
                      unit="Hz"
                    />
                  </div>
                  <p className="estimate-note padded">
                    Rod force estimates peak inertial load. Peak cylinder pressure and fatigue are
                    not resolved.
                  </p>
                </Panel>
              </div>
            </div>
          )}
          {tab === 'Settings' && (
            <div className="settings-page">
              <Panel title="Simulation & display" icon={Settings2}>
                <div className="settings-content">
                  <SelectField
                    label="Simulation frequency"
                    value={String(hz)}
                    onChange={(v) => setHz(Number(v))}
                    options={[
                      { value: '500', label: '500 Hz · economy' },
                      { value: '1000', label: '1,000 Hz · balanced' },
                      { value: '2000', label: '2,000 Hz · high detail' },
                    ]}
                  />
                  <p className="field-note">
                    Fixed-step integration runs in a Web Worker. Firing events are resolved by angle
                    crossings, including events between integration steps. Catch-up is bounded to
                    100 ms per worker tick.
                  </p>
                  <SelectField
                    label="Display units"
                    value={imperial ? 'imperial' : 'metric'}
                    onChange={(v) => setImperial(v === 'imperial')}
                    options={[
                      { value: 'metric', label: 'Metric · N·m / km/h / mm / °C' },
                      { value: 'imperial', label: 'Imperial · lb·ft / mph / in / °F' },
                    ]}
                  />
                  <Toggle
                    label="Cycle phase indicators"
                    checked={phases}
                    onChange={setPhases}
                    hint="Label intake, compression, power and exhaust."
                  />
                  <Toggle
                    label="Record live telemetry"
                    checked={recording}
                    onChange={setRecording}
                    hint="Retain the most recent 200 samples in memory."
                  />
                  <div className="settings-metrics">
                    <span>
                      Measured integration<strong>{sim.metrics.hz} Hz</strong>
                    </span>
                    <span>
                      Worker compute duty<strong>{sim.metrics.cpu.toFixed(1)}%</strong>
                    </span>
                    <span>
                      Discarded wall time<strong>{sim.metrics.dropped.toFixed(2)} s</strong>
                    </span>
                  </div>
                  {sim.metrics.cpu > 65 && (
                    <p className="warning-inline">
                      Selected quality is approaching this device’s budget. Choose a lower
                      simulation frequency.
                    </p>
                  )}
                </div>
              </Panel>
              <Panel title="Sound & acoustics" icon={Volume2}>
                <div className="settings-content">
                  <Toggle
                    label="Engine audio"
                    checked={audioOn}
                    onChange={() => toggleAudio()}
                    hint="Enable playback with this user gesture."
                  />
                  <Range
                    label="Output volume"
                    value={volume}
                    onChange={setVolume}
                    display={`${Math.round(volume * 100)}%`}
                  />
                  <SelectField
                    label="Audio quality"
                    value={audioQuality}
                    onChange={(v) => setAudioQuality(v as 'economy' | 'high')}
                    options={[
                      { value: 'high', label: 'High · additional acoustic reflections' },
                      { value: 'economy', label: 'Economy · reduced reflections' },
                    ]}
                  />
                  <p className="field-note">
                    Web Audio worklet; cylinder firing events drive pulse excitation. Engine,
                    intake, mechanical and forced-induction layers share the live state. Soft
                    saturation protects the output. Start with a low volume.
                  </p>
                  <div className="info-card">
                    <InfoIcon />
                    <p>
                      Audio is muted while paused or inspecting slow motion. The normal playback
                      rate is always real time.
                    </p>
                  </div>
                </div>
              </Panel>
              <Panel title="Local data" icon={HardDrive}>
                <div className="settings-content">
                  <p className="field-note">
                    The current engine and saved library live in this browser’s local storage.
                    Export JSON to move an engine between devices. There is no account or cloud
                    synchronization.
                  </p>
                  <div className="button-group">
                    <button className="button" onClick={() => fileInput.current?.click()}>
                      <Upload size={14} />
                      Import JSON
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        downloadFile(
                          'engine-lab-config.json',
                          JSON.stringify({ schemaVersion: 1, engine: config }, null, 2),
                        )
                      }
                    >
                      <FileJson size={14} />
                      Export engine
                    </button>
                  </div>
                </div>
              </Panel>
            </div>
          )}
          <div className="workspace-note">
            <FlaskConical size={13} />
            <span>
              Physics-based exploration. All performance, sound and stress outputs are unvalidated
              estimates.
            </span>
            <button onClick={() => setModal('model')}>
              Read model assumptions <ArrowUpRight size={12} />
            </button>
          </div>
        </main>
        <footer className="statusbar">
          <span>
            <span className="status-dot" /> {paused ? 'PAUSED' : 'SIMULATION WORKER ACTIVE'}
          </span>
          <span>
            {hz.toLocaleString()} Hz fixed step <i /> {sim.metrics.cpu.toFixed(1)}% compute <i />{' '}
            Web Audio {audioOn ? 'enabled' : 'standby'}
          </span>
          <span>
            <ShieldCheck size={11} />
            {controls.protective ? 'Protective mode' : 'Experimental mode'}
            <span className="status-time">t + {s.time.toFixed(1)} s</span>
          </span>
        </footer>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        className="sr-only"
        ref={fileInput}
        aria-label="Import engine configuration"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = '';
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <InfoIcon />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal === 'library' && (
        <ModalShell title="Engine library" onClose={closeModal} wide>
          <div className="library-intro">
            <p>
              A starting point for your next experiment.
              <br />
              <span>Generic engine archetypes · illustrative specifications</span>
            </p>
            <button className="button primary" onClick={newEngine}>
              <Plus size={14} />
              Build new engine
            </button>
          </div>
          <input
            className="library-search"
            placeholder="Filter engines by name or layout…"
            aria-label="Filter engine library"
            value={libraryFilter}
            onChange={(e) => setLibraryFilter(e.target.value)}
          />
          <div className="library-grid">
            {[...presets, ...saved]
              .filter((c) =>
                (c.name + ' ' + c.layout + ' ' + c.aspiration)
                  .toLowerCase()
                  .includes(libraryFilter.toLowerCase()),
              )
              .map((c, i) => (
                <div
                  className={'preset-card ' + (c.id === config.id ? 'selected' : '')}
                  key={c.id + '-' + i}
                >
                  <button onClick={() => loadEngine(c)}>
                    <span className="preset-glyph">
                      {c.layout === 'v'
                        ? 'V'
                        : c.layout === 'boxer'
                          ? 'F'
                          : c.layout === 'single'
                            ? 'S'
                            : 'I'}
                      <b>{c.cylinders}</b>
                    </span>
                    <span className="preset-info">
                      <strong>{c.name}</strong>
                      <small>
                        {displacement(c).toFixed(2)} L <i />{' '}
                        {c.aspiration === 'natural'
                          ? 'NA'
                          : c.aspiration === 'turbo'
                            ? 'TURBO'
                            : 'S/C'}{' '}
                        <i /> {pretty(c.redline)} rpm
                      </small>
                      <span>
                        {i >= presets.length ? 'LOCAL CONFIGURATION' : 'GENERIC · ESTIMATED'}
                      </span>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  {i >= presets.length && (
                    <button
                      className="remove-preset"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => {
                        const next = saved.filter((p) => p.id !== c.id);
                        if (writeLocal('engine-lab-library', next)) setSaved(next);
                        else setToast('Local storage unavailable; engine was not deleted.');
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
          </div>
          <div className="modal-footer">
            <span>
              <HardDrive size={13} /> Your library stays on this device.
            </span>
            <button className="button" onClick={() => fileInput.current?.click()}>
              <Upload size={13} />
              Import JSON
            </button>
          </div>
        </ModalShell>
      )}
      {modal === 'save' && (
        <ModalShell title="Save engine configuration" onClose={closeModal}>
          <div className="modal-content">
            <p>Save a copy to this browser’s engine library.</p>
            <label className="text-label" htmlFor="save-name">
              Configuration name
            </label>
            <input
              id="save-name"
              value={saveName}
              maxLength={64}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) saveEngine();
              }}
              autoFocus
            />
            <div className="save-summary">
              <span>{engineLabel}</span>
              <span>{displacement(config).toFixed(2)} L</span>
              <span>{pretty(config.redline)} rpm</span>
            </div>
            <div className="button-group justify-end">
              <button className="button" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!saveName.trim() || errors.length > 0}
                onClick={saveEngine}
              >
                <Save size={14} />
                Save configuration
              </button>
            </div>
          </div>
        </ModalShell>
      )}
      {modal === 'shortcuts' && (
        <ModalShell title="Workspace shortcuts" onClose={closeModal}>
          <div className="modal-content shortcuts">
            {[
              ['Space', 'Start / stop engine'],
              ['W / ↑', 'Hold to open throttle'],
              ['S / ↓', 'Hold to apply brakes'],
              ['D / →', 'Shift up'],
              ['A / ←', 'Shift down'],
              ['N', 'Select neutral'],
              ['P', 'Pause / resume simulation'],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{v}</span>
                <kbd>{k}</kbd>
              </div>
            ))}
            <p className="field-note">
              Shortcuts are inactive while editing a field. On touch devices use the throttle,
              brake, gear and clutch controls in the Simulation panel. Manual launches require
              clutch control.
            </p>
          </div>
        </ModalShell>
      )}
      {modal === 'model' && (
        <ModalShell title="Model & assumptions" onClose={closeModal} wide>
          <div className="modal-content model-content">
            <div className="model-warning">
              <FlaskConical size={20} />
              <span>
                An exploration tool, with honest limits.
                <small>
                  Engine Lab has not been validated against measured engine, dyno or acoustic data.
                </small>
              </span>
            </div>
            <h3>One state, many ways to understand it</h3>
            <p>
              A fixed-step worker integrates crankshaft speed, crank angle, vehicle motion, manifold
              filling, boost and temperature. Angle crossings create the firing events used by both
              cylinder illumination and the AudioWorklet. Events between integration steps are
              retained.
            </p>
            <h3>Torque, airflow & dynamics</h3>
            <p>
              Displacement = π/4 × bore² × stroke × cylinders. A mean-effective-pressure model
              estimates brake torque from displacement, volumetric efficiency, pressure ratio and
              throttle, minus friction and pumping losses. Cam lift, duration, overlap, intake
              geometry, compression, AFR and ignition advance modify that envelope. This is not a
              crank-resolved combustion pressure solver.
            </p>
            <p>
              Power (kW) = torque (N·m) × RPM / 9549.3. Crank acceleration follows net torque /
              inertia. Vehicle acceleration follows wheel torque / tire radius minus drag, rolling
              resistance and braking, divided by vehicle mass. Clutch slip supplies the coupling
              torque.
            </p>
            <h3>Acoustics & induction</h3>
            <p>
              Actual combustion events excite damped pressure pulses, exhaust resonances and
              reflections. Mechanical, intake and turbo layers use the same RPM, load and pressure
              state. Turbo response is a first-order spool approximation with a boost-target cap;
              compressor maps, surge, knock and multi-turbo interactions are not modeled. Exhaust
              hardware is represented by one equivalent pipe and damping parameter. This is
              synthesized audio, not a recording.
            </p>
            <h3>Stress, heat & failure</h3>
            <p>
              Mean piston speed = 2 × stroke × RPM / 60. Rod loading is an inertial envelope using
              reciprocating mass and slider-crank geometry. A combined piston-speed, rod-load,
              valve-speed and temperature envelope drives protective limits or accumulated
              experimental damage. Temperatures use a lumped heat-balance estimate. Material
              fatigue, detailed pressure loading, oil films, component deformation and certified
              safety factors are not resolved.
            </p>
            <h3>What affects confidence most</h3>
            <p>
              Measured airflow/BMEP curves, cylinder-pressure traces, ignition and fueling maps,
              component fatigue data, cooling maps, calibrated exhaust transfer functions and
              compressor/turbine maps would be required to validate the model. Current presets are
              generic archetypes with explicitly estimated values; their source links document
              underlying concepts.
            </p>
            <h3>Numerical behavior</h3>
            <p>
              Choose 500–2,000 Hz integration. A bounded catch-up loop discards excess wall time
              after long stalls; the simulation does not jump through a hidden tab. Visual firing
              uses 48 ms of persistence at high RPM. Slow motion changes simulation time and mutes
              audio. Dyno results are independent equilibrium, full-throttle samples; they exclude
              transient lag and heating.
            </p>
            <button className="button" onClick={closeModal}>
              Back to workspace <ArrowRight size={14} />
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
function InfoIcon() {
  return <CircleHelp size={15} className="info-icon" />;
}
