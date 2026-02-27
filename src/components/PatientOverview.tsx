import { Activity, Droplets, Gauge, Thermometer, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type PatientLike = {
  name?: string;
  age?: number | null;
  gender?: string | null;
  condition?: string | null;
  persona?: string | null;
};

type MemoryLike = { content: string; created_at?: string };
type ChatLike = { content: string; created_at?: string; role?: string };

type ValuePoint = { t: number; v: number };
type BloodPressurePoint = { t: number; sys: number; dia: number };

function parseLocalDateTimeMs(s?: string): number {
  if (!s) return Date.now();
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function Sparkline({
  values,
  width = 120,
  height = 36,
  strokeClassName = 'stroke-slate-600',
}: {
  values: number[];
  width?: number;
  height?: number;
  strokeClassName?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 2;
  const padY = 2;
  const w = Math.max(10, width);
  const h = Math.max(10, height);
  const pts = values.map((v, i) => {
    const x = padX + (i * (w - padX * 2)) / (values.length - 1);
    const y = padY + (1 - (v - min) / range) * (h - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <polyline fill="none" strokeWidth="2" className={cn('opacity-90', strokeClassName)} points={pts.join(' ')} />
    </svg>
  );
}

function DualSparkline({
  a,
  b,
  width = 120,
  height = 36,
  aClassName = 'stroke-emerald-600',
  bClassName = 'stroke-blue-600',
}: {
  a: number[];
  b: number[];
  width?: number;
  height?: number;
  aClassName?: string;
  bClassName?: string;
}) {
  if (a.length < 2 || b.length < 2) return null;
  const len = Math.min(a.length, b.length);
  const aa = a.slice(-len);
  const bb = b.slice(-len);
  const min = Math.min(...aa, ...bb);
  const max = Math.max(...aa, ...bb);
  const range = max - min || 1;
  const padX = 2;
  const padY = 2;
  const w = Math.max(10, width);
  const h = Math.max(10, height);

  const toPoints = (vals: number[]) =>
    vals.map((v, i) => {
      const x = padX + (i * (w - padX * 2)) / (len - 1);
      const y = padY + (1 - (v - min) / range) * (h - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

  const ptsA = toPoints(aa);
  const ptsB = toPoints(bb);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <polyline fill="none" strokeWidth="2" className={cn('opacity-90', bClassName)} points={ptsB.join(' ')} />
      <polyline fill="none" strokeWidth="2" className={cn('opacity-95', aClassName)} points={ptsA.join(' ')} />
    </svg>
  );
}

function extractMetrics(memories: MemoryLike[], chats: ChatLike[]) {
  const temp: ValuePoint[] = [];
  const glucose: ValuePoint[] = [];
  const pulse: ValuePoint[] = [];
  const bp: BloodPressurePoint[] = [];

  const addTemp = (t: number, v: number) => {
    if (v < 34 || v > 43) return;
    temp.push({ t, v: Math.round(v * 10) / 10 });
  };
  const addGlucose = (t: number, v: number) => {
    if (v < 1.5 || v > 35) return;
    glucose.push({ t, v: Math.round(v * 10) / 10 });
  };
  const addPulse = (t: number, v: number) => {
    if (v < 30 || v > 220) return;
    pulse.push({ t, v: Math.round(v) });
  };
  const addBp = (t: number, sys: number, dia: number) => {
    if (sys < 70 || sys > 260) return;
    if (dia < 40 || dia > 160) return;
    bp.push({ t, sys: Math.round(sys), dia: Math.round(dia) });
  };

  const scanText = (text: string, t: number) => {
    const raw = text.replace(/\s+/g, ' ').trim();

    const mTemp = raw.match(/(\d{2}(?:\.\d)?)\s*℃/);
    if (mTemp) addTemp(t, Number(mTemp[1]));
    if (!mTemp && raw.includes('体温')) {
      const m = raw.match(/体温[^\d]{0,6}(\d{2}(?:\.\d)?)/);
      if (m) addTemp(t, Number(m[1]));
    }

    const mBp = raw.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (mBp && (raw.includes('血压') || raw.includes('mmhg') || raw.includes('mmHg'))) {
      addBp(t, Number(mBp[1]), Number(mBp[2]));
    }
    if (!mBp && raw.includes('血压')) {
      const m = raw.match(/血压[^\d]{0,10}(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (m) addBp(t, Number(m[1]), Number(m[2]));
    }

    const mG = raw.match(/(\d+(?:\.\d+)?)\s*(mmol\/l|mmol|毫摩尔)/i);
    if (mG && raw.includes('血糖')) addGlucose(t, Number(mG[1]));
    if (!mG && raw.includes('血糖')) {
      const m = raw.match(/血糖[^\d]{0,10}(\d+(?:\.\d+)?)/);
      if (m) addGlucose(t, Number(m[1]));
    }

    const mP = raw.match(/(心率|脉搏)[^\d]{0,10}(\d{2,3})/);
    if (mP) addPulse(t, Number(mP[2]));
    const mP2 = raw.match(/(\d{2,3})\s*(次\/分|bpm)/i);
    if (mP2 && raw.includes('心')) addPulse(t, Number(mP2[1]));
  };

  for (const m of memories) {
    scanText(m.content, parseLocalDateTimeMs(m.created_at));
  }
  for (const c of chats) {
    scanText(c.content, parseLocalDateTimeMs(c.created_at));
  }

  const byTime = <T extends { t: number }>(arr: T[]) => arr.sort((a, b) => a.t - b.t);
  byTime(temp);
  byTime(glucose);
  byTime(pulse);
  byTime(bp);

  const latest = <T extends { t: number }>(arr: T[]) => (arr.length ? arr[arr.length - 1] : null);
  return {
    temp,
    glucose,
    pulse,
    bp,
    latestTemp: latest(temp),
    latestGlucose: latest(glucose),
    latestPulse: latest(pulse),
    latestBp: latest(bp),
  };
}

function riskFromMetrics(metrics: ReturnType<typeof extractMetrics>) {
  const t = metrics.latestTemp?.v ?? null;
  const g = metrics.latestGlucose?.v ?? null;
  const p = metrics.latestPulse?.v ?? null;
  const sys = metrics.latestBp?.sys ?? null;
  const dia = metrics.latestBp?.dia ?? null;

  const high =
    (t != null && t >= 39) ||
    (sys != null && sys >= 180) ||
    (dia != null && dia >= 110) ||
    (g != null && g >= 16.7) ||
    (p != null && p >= 120);
  const mid =
    (t != null && t >= 38.5) ||
    (sys != null && sys >= 160) ||
    (dia != null && dia >= 100) ||
    (g != null && g >= 11.1) ||
    (p != null && p >= 100);

  if (high) return { level: '高', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'text-rose-600' };
  if (mid) return { level: '中', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'text-amber-600' };
  return { level: '低', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'text-emerald-600' };
}

function MetricCard({
  title,
  icon,
  value,
  sub,
  chart,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  sub?: string;
  chart?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[120px] flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            {icon}
            <span className="truncate">{title}</span>
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
        </div>
        {chart ? <div className="ml-auto flex-shrink-0">{chart}</div> : null}
      </div>
    </div>
  );
}

export default function PatientOverview({
  patient,
  memories,
  chatHistory,
}: {
  patient: PatientLike;
  memories: MemoryLike[];
  chatHistory: ChatLike[];
}) {
  const metrics = extractMetrics(memories, chatHistory);
  const risk = riskFromMetrics(metrics);

  const tempValues = metrics.temp.slice(-12).map((x) => x.v);
  const glucoseValues = metrics.glucose.slice(-12).map((x) => x.v);
  const pulseValues = metrics.pulse.slice(-12).map((x) => x.v);
  const bpSys = metrics.bp.slice(-12).map((x) => x.sys);
  const bpDia = metrics.bp.slice(-12).map((x) => x.dia);

  const tempText = metrics.latestTemp ? `${metrics.latestTemp.v.toFixed(1)}℃` : '—';
  const glucoseText = metrics.latestGlucose ? `${metrics.latestGlucose.v.toFixed(1)} mmol/L` : '—';
  const pulseText = metrics.latestPulse ? `${Math.round(metrics.latestPulse.v)} bpm` : '—';
  const bpText = metrics.latestBp ? `${metrics.latestBp.sys}/${metrics.latestBp.dia}` : '—';

  const riskText =
    metrics.latestTemp || metrics.latestBp || metrics.latestGlucose || metrics.latestPulse
      ? `风险等级：${risk.level}`
      : '暂无可用指标';

  const completeness = clamp(
    [metrics.latestTemp, metrics.latestBp, metrics.latestGlucose, metrics.latestPulse].filter(Boolean).length / 4,
    0,
    1
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          title="体温"
          icon={<Thermometer size={14} className="text-rose-500" />}
          value={tempText}
          sub={metrics.temp.length ? `记录 ${metrics.temp.length} 条` : undefined}
          chart={<Sparkline values={tempValues} strokeClassName="stroke-rose-500" />}
        />
        <MetricCard
          title="血压"
          icon={<Gauge size={14} className="text-emerald-600" />}
          value={bpText}
          sub={metrics.bp.length ? `记录 ${metrics.bp.length} 条` : undefined}
          chart={<DualSparkline a={bpSys} b={bpDia} />}
        />
        <MetricCard
          title="血糖"
          icon={<Droplets size={14} className="text-sky-600" />}
          value={glucoseText}
          sub={metrics.glucose.length ? `记录 ${metrics.glucose.length} 条` : undefined}
          chart={<Sparkline values={glucoseValues} strokeClassName="stroke-sky-600" />}
        />
        <MetricCard
          title="心率"
          icon={<Activity size={14} className="text-violet-600" />}
          value={pulseText}
          sub={metrics.pulse.length ? `记录 ${metrics.pulse.length} 条` : undefined}
          chart={<Sparkline values={pulseValues} strokeClassName="stroke-violet-600" />}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-600">数据概览</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', risk.cls)}>
                <TriangleAlert size={12} className={risk.icon} />
                {riskText}
              </span>
              <span className="text-xs text-slate-500">
                采集完整度 {(completeness * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <div className="w-28">
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className={cn('h-2 rounded-full', completeness >= 0.75 ? 'bg-emerald-500' : completeness >= 0.5 ? 'bg-amber-500' : 'bg-slate-300')}
                style={{ width: `${(completeness * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div className="rounded bg-slate-50 p-2">
            <div className="text-slate-400">主诉/标签</div>
            <div className="mt-0.5 text-slate-700">{patient.condition || '—'}</div>
          </div>
          <div className="rounded bg-slate-50 p-2">
            <div className="text-slate-400">基本信息</div>
            <div className="mt-0.5 text-slate-700">
              {(patient.gender || '—') + ' · ' + (patient.age != null ? `${patient.age}岁` : '—')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
