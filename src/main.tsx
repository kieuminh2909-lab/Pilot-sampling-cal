import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Copy,
  Download,
  Play,
  Plus,
  X,
  AlertTriangle,
  Check,
} from 'lucide-react';

// =========================================================================
// TYPES & INTERFACES
// =========================================================================
export interface ClusterSamplingParams {
  N: number;
  M: number;
  m: number;
  E_target: number;
  z: number;
  rho_history: number;
  pilotDefectCounts: number[];
}

export type ReportRowType =
  | 'title'
  | 'meta'
  | 'spacer'
  | 'header-input'
  | 'row-input'
  | 'header-pilot'
  | 'row-pilot'
  | 'header-hist'
  | 'row-hist';

export interface ReportRow {
  type: ReportRowType;
  colA: string;
  colB: string;
  colC: string;
}

export interface ClusterSamplingResult {
  N: number;
  M: number;
  m: number;
  k: number;
  n: number;
  totalDefects: number;
  boxMeans: number[];
  p_hat: number;
  s_b2: number;
  s_w2: number;
  cov: number;
  rho_pilot: number;
  samplingStage: string;
  deff_history: number;
  k_required_history_alt: number;
  deff_pilot: number;
  n_eff_pilot: number;
  se_srs: number;
  se_cluster: number;
  marginOfError: number;
  k_required_pilot: number;
  additional_boxes_pilot: number;
  box_delta: number;
  outputData: ReportRow[];
}

// =========================================================================
// DEFAULT PARAMETERS (FROM GOOGLE APPS SCRIPT)
// =========================================================================
const DEFAULTS: ClusterSamplingParams = {
  N: 10000,
  M: 24,
  m: 3,
  E_target: 0.05,
  z: 1.96,
  rho_history: 0.55,
  pilotDefectCounts: [0, 2, 0, 3],
};

// =========================================================================
// STATISTICAL CALCULATIONS ENGINE
// =========================================================================
function computeClusterSamplingAnalysis(
  params: ClusterSamplingParams,
  timestamp: Date
): ClusterSamplingResult {
  const N = Math.max(1, Math.floor(Number(params.N) || 1));
  const M = Math.max(1, Math.floor(Number(params.M) || 1));
  const m = Math.max(1, Math.floor(Number(params.m) || 1));
  const E_target = Math.max(0.000001, Number(params.E_target) || 0.05);
  const z = Math.max(0.001, Number(params.z) || 1.96);
  const rho_history = Math.min(1, Math.max(0, Number(params.rho_history) || 0));
  const pilotDefectCounts =
    params.pilotDefectCounts.length > 0 ? params.pilotDefectCounts : [0];

  // 1. Pilot-Based Statistical Calculations
  const k = pilotDefectCounts.length;
  const boxMeans: number[] = [];
  let totalDefects = 0;
  const n = k * m;

  for (let i = 0; i < k; i++) {
    const mean = pilotDefectCounts[i] / m;
    boxMeans.push(mean);
    totalDefects += pilotDefectCounts[i];
  }

  // Overall defect rate estimate (p_hat)
  const p_hat = totalDefects / n;

  // Between-Box Variance (s_b^2)
  let sumSqDevBetween = 0;
  for (let i = 0; i < k; i++) {
    sumSqDevBetween += Math.pow(boxMeans[i] - p_hat, 2);
  }
  const s_b2 = k > 1 ? sumSqDevBetween / (k - 1) : 0;

  // Within-Box Variance (s_w^2): Pooled within-box binary variance across all k * (m - 1) df
  let sumWithinSq = 0;
  for (let i = 0; i < k; i++) {
    sumWithinSq += m * boxMeans[i] * (1 - boxMeans[i]);
  }
  const s_w2 = k > 0 && m > 1 ? sumWithinSq / (k * (m - 1)) : 0;

  // Pairwise Covariance within the same box (Pilot)
  const cov = m > 1 ? (s_b2 - s_w2 / m) * (m / (m - 1)) : s_b2;

  // Intraclass Correlation Coefficient (Pilot rho)
  const totalVar = s_b2 + s_w2;
  const rho_pilot = totalVar > 0 ? Math.max(0, cov / totalVar) : 0;

  // Method Detection
  const samplingStage =
    m >= M ? '1-Stage Cluster Sampling' : '2-Stage Cluster Sampling';

  // 2. Historical Rho-Based Statistical Calculations
  const deff_history =
    m >= M ? 1 + (M - 1) * rho_history : 1 + (m - 1) * rho_history;
  const k_required_history_alt = Math.ceil(
    (deff_history * Math.pow(z, 2) * p_hat * (1 - p_hat)) /
      (Math.pow(E_target, 2) * m)
  );

  // 3. Pilot Final Outputs
  const deff_pilot =
    m >= M ? 1 + (M - 1) * rho_pilot : 1 + (m - 1) * rho_pilot;
  const n_eff_pilot = n / deff_pilot;

  const f1 = k / N;
  const f2 = m / M;

  const var_p_hat =
    m >= M
      ? ((1 - f1) / k) * s_b2
      : ((1 - f1) / k) * s_b2 + ((1 - f2) / (k * m)) * s_w2;

  const se_cluster = Math.sqrt(Math.max(0, var_p_hat));
  const var_srs = (p_hat * (1 - p_hat)) / n;
  const se_srs = Math.sqrt(Math.max(0, var_srs));
  const marginOfError = z * se_cluster;

  const var_box = s_b2 + (1 - f2) * (s_w2 / m);
  const k_required_pilot =
    var_box > 0
      ? Math.ceil((Math.pow(z, 2) * var_box) / Math.pow(E_target, 2))
      : k;

  const additional_boxes_pilot = Math.max(0, k_required_pilot - k);
  const box_delta = k_required_history_alt - k_required_pilot;

  let ciLabel = '95% CI';
  if (Math.abs(z - 1.645) < 0.005) ciLabel = '90% CI';
  else if (Math.abs(z - 1.96) < 0.005) ciLabel = '95% CI';
  else if (Math.abs(z - 2.576) < 0.005) ciLabel = '99% CI';
  else ciLabel = `z=${z} CI`;

  // 4. Exact 32-Row Sheet Data ("AQL SCRIPT PUSH")
  const outputData: ReportRow[] = [
    {
      type: 'title',
      colA: 'AQL CLUSTER SAMPLING ANALYSIS & RHO HISTORY REPORT',
      colB: '',
      colC: '',
    },
    {
      type: 'meta',
      colA: 'Sampling Method Detected',
      colB: samplingStage,
      colC: 'Auto-detected based on m vs M (m=M -> 1-Stage, m<M -> 2-Stage)',
    },
    {
      type: 'meta',
      colA: 'Timestamp',
      colB: timestamp.toLocaleString(),
      colC: 'Time of calculation',
    },
    { type: 'spacer', colA: '', colB: '', colC: '' },
    {
      type: 'header-input',
      colA: 'INPUT PARAMETERS',
      colB: 'VALUE',
      colC: 'DESCRIPTION',
    },
    {
      type: 'row-input',
      colA: 'Total Lot Size (N boxes)',
      colB: String(N),
      colC: 'Total primary boxes in the warehouse lot',
    },
    {
      type: 'row-input',
      colA: 'Pcs per Box (M)',
      colB: String(M),
      colC: 'Total units packaged inside each box',
    },
    {
      type: 'row-input',
      colA: 'Pcs Picked per Box (m)',
      colB: String(m),
      colC: 'Units inspected per box in this sampling phase',
    },
    {
      type: 'row-input',
      colA: 'Pilot Boxes Sampled (k)',
      colB: String(k),
      colC: 'Number of primary boxes inspected in the pilot',
    },
    {
      type: 'row-input',
      colA: 'Total Physical Units Inspected (n)',
      colB: String(n),
      colC: 'Total individual pieces physically evaluated (k * m)',
    },
    {
      type: 'row-input',
      colA: 'Pilot Defect Counts per Box',
      colB: pilotDefectCounts.join(', '),
      colC: 'Defects found per sampled box',
    },
    {
      type: 'row-input',
      colA: 'Target Margin of Error (E)',
      colB: `${E_target * 100}%`,
      colC: 'Desired statistical precision for final decision',
    },
    {
      type: 'row-input',
      colA: 'Historical Intraclass Correlation (rho_history)',
      colB: String(rho_history),
      colC: 'NEW INPUT: Benchmark clustering rate from past historical batches',
    },
    { type: 'spacer', colA: '', colB: '', colC: '' },
    {
      type: 'header-pilot',
      colA: 'PILOT-BASED STATISTICAL OUTPUTS',
      colB: 'VALUE',
      colC: 'OPERATIONAL MEANING',
    },
    {
      type: 'row-pilot',
      colA: 'Estimated Defect Rate (p_hat)',
      colB: `${(p_hat * 100).toFixed(2)}%`,
      colC: 'Overall average defect percentage across pilot samples',
    },
    {
      type: 'row-pilot',
      colA: 'Between-Box Variance (s_b^2)',
      colB: s_b2.toFixed(6),
      colC: 'Box-to-box defect variation from current pilot; high value = non-uniform lot',
    },
    {
      type: 'row-pilot',
      colA: 'Within-Box Variance (s_w^2)',
      colB: s_w2.toFixed(6),
      colC: 'Item-to-item variation inside pilot boxes',
    },
    {
      type: 'row-pilot',
      colA: 'Pairwise Covariance Cov()',
      colB: cov.toFixed(6),
      colC: ">0 means items in the same box share defect states ('guilty by association')",
    },
    {
      type: 'row-pilot',
      colA: 'Pilot Intraclass Correlation (rho_pilot)',
      colB: rho_pilot.toFixed(4),
      colC: 'Clustering degree calculated directly from current pilot data (0 to 1)',
    },
    {
      type: 'row-pilot',
      colA: 'Pilot Design Effect (Deff_pilot)',
      colB: deff_pilot.toFixed(4),
      colC: 'Variance penalty multiplier based on pilot data relative to random sampling',
    },
    {
      type: 'row-pilot',
      colA: 'Pilot Effective Sample Size (n_eff)',
      colB: n_eff_pilot.toFixed(2),
      colC: 'Equivalent number of truly independent random pieces your pilot data is worth',
    },
    {
      type: 'row-pilot',
      colA: 'SRS Standard Error SE_srs(p_hat)',
      colB: `${(se_srs * 100).toFixed(2)}%`,
      colC: 'Standard Error assuming pure random sampling (ignores clustering)',
    },
    {
      type: 'row-pilot',
      colA: 'Cluster Standard Error SE(p_hat)',
      colB: `${(se_cluster * 100).toFixed(2)}%`,
      colC: 'Actual Standard Error accounting for current box clustering',
    },
    {
      type: 'row-pilot',
      colA: `Pilot Margin of Error (${ciLabel})`,
      colB: `±${(marginOfError * 100).toFixed(2)}%`,
      colC: 'Current uncertainty range of the pilot estimate',
    },
    {
      type: 'row-pilot',
      colA: 'Required Total Boxes (Pilot k_req)',
      colB: `${k_required_pilot} boxes`,
      colC: 'Total boxes needed based purely on pilot variances to reach target error',
    },
    {
      type: 'row-pilot',
      colA: 'Additional Boxes to Sample (Pilot)',
      colB: `${additional_boxes_pilot} boxes`,
      colC: 'Extra boxes to draw beyond the initial pilot phase',
    },
    { type: 'spacer', colA: '', colB: '', colC: '' },
    {
      type: 'header-hist',
      colA: 'HISTORICAL RHO-BASED OUTPUTS',
      colB: 'VALUE',
      colC: 'OPERATIONAL MEANING',
    },
    {
      type: 'row-hist',
      colA: 'Historical Design Effect (Deff_history)',
      colB: deff_history.toFixed(4),
      colC: 'Design Effect computed using your input rho_history benchmark',
    },
    {
      type: 'row-hist',
      colA: 'Historical Required Boxes (k_req_hist)',
      colB: `${k_required_history_alt} boxes`,
      colC: 'Required box count stabilized by historical baseline clustering',
    },
    {
      type: 'row-hist',
      colA: 'Historical vs Pilot Box Delta',
      colB: `${box_delta} boxes`,
      colC: 'Difference in sample requirement when substituting history for pilot noise',
    },
  ];

  return {
    N,
    M,
    m,
    k,
    n,
    totalDefects,
    boxMeans,
    p_hat,
    s_b2,
    s_w2,
    cov,
    rho_pilot,
    samplingStage,
    deff_history,
    k_required_history_alt,
    deff_pilot,
    n_eff_pilot,
    se_srs,
    se_cluster,
    marginOfError,
    k_required_pilot,
    additional_boxes_pilot,
    box_delta,
    outputData,
  };
}

// =========================================================================
// MAIN REACT COMPONENT
// =========================================================================
export default function App() {
  const [N, setN] = useState<number>(DEFAULTS.N);
  const [M, setM] = useState<number>(DEFAULTS.M);
  const [m, setm] = useState<number>(DEFAULTS.m);
  const [eTarget, setETarget] = useState<number>(DEFAULTS.E_target);
  const [eInputMode, setEInputMode] = useState<'decimal' | 'percent'>('decimal');
  const [eInputDisplay, setEInputDisplay] = useState<string>(
    String(DEFAULTS.E_target)
  );
  const [z, setZ] = useState<number>(DEFAULTS.z);
  const [rhoHistory, setRhoHistory] = useState<number>(DEFAULTS.rho_history);
  const [pilotDefectCounts, setPilotDefectCounts] = useState<number[]>([
    ...DEFAULTS.pilotDefectCounts,
  ]);
  const [defectsCsvText, setDefectsCsvText] = useState<string>(
    DEFAULTS.pilotDefectCounts.join(', ')
  );
  const [tableSearch, setTableSearch] = useState<string>('');
  const [timestamp, setTimestamp] = useState<Date>(() => new Date());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  // Recalculate whenever parameters or timestamp update
  const analysis = useMemo(
    () =>
      computeClusterSamplingAnalysis(
        {
          N,
          M,
          m,
          E_target: eTarget,
          z,
          rho_history: rhoHistory,
          pilotDefectCounts,
        },
        timestamp
      ),
    [N, M, m, eTarget, z, rhoHistory, pilotDefectCounts, timestamp]
  );

  // Validation warnings
  const warnings = useMemo(() => {
    const list: string[] = [];
    if (analysis.m > analysis.M) {
      list.push(
        `Picked units per box (m=${analysis.m}) exceeds total pcs per box (M=${analysis.M}). Method defaults to 1-Stage Cluster Sampling.`
      );
    }
    const maxDefectInBox = Math.max(...pilotDefectCounts);
    if (maxDefectInBox > analysis.m) {
      list.push(
        `A sampled box has ${maxDefectInBox} defects, which exceeds m=${analysis.m} inspected units per box (p_hat > 100%).`
      );
    }
    return list;
  }, [analysis.m, analysis.M, pilotDefectCounts]);

  // Filtered table rows
  const filteredRows = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return analysis.outputData.map((r, i) => ({ row: r, num: i + 1 }));
    return analysis.outputData
      .map((r, i) => ({ row: r, num: i + 1 }))
      .filter(({ row }) =>
        `${row.colA} ${row.colB} ${row.colC}`.toLowerCase().includes(query)
      );
  }, [analysis.outputData, tableSearch]);

  // Handlers
  const handleToggleEMode = (mode: 'decimal' | 'percent') => {
    if (mode === eInputMode) return;
    setEInputMode(mode);
    if (mode === 'decimal') {
      setEInputDisplay(String(Number(eTarget.toFixed(6))));
    } else {
      setEInputDisplay(String(Number((eTarget * 100).toFixed(4))));
    }
  };

  const handleEChange = (valStr: string) => {
    setEInputDisplay(valStr);
    const parsed = Number(valStr);
    if (!isNaN(parsed) && parsed > 0) {
      setETarget(eInputMode === 'percent' ? parsed / 100 : parsed);
    }
  };

  const handleCsvChange = (val: string) => {
    setDefectsCsvText(val);
    const parsed = val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => Math.max(0, Math.floor(Number(s) || 0)));

    if (parsed.length > 0) {
      setPilotDefectCounts(parsed);
    }
  };

  const updateBoxDefect = (index: number, nextVal: number) => {
    const clamped = Math.max(0, Math.floor(nextVal));
    const updated = [...pilotDefectCounts];
    updated[index] = clamped;
    setPilotDefectCounts(updated);
    setDefectsCsvText(updated.join(', '));
  };

  const removeBox = (index: number) => {
    if (pilotDefectCounts.length <= 1) return;
    const updated = pilotDefectCounts.filter((_, i) => i !== index);
    setPilotDefectCounts(updated);
    setDefectsCsvText(updated.join(', '));
  };

  const addBox = () => {
    const updated = [...pilotDefectCounts, 0];
    setPilotDefectCounts(updated);
    setDefectsCsvText(updated.join(', '));
  };

  const handleResetDefaults = () => {
    setN(DEFAULTS.N);
    setM(DEFAULTS.M);
    setm(DEFAULTS.m);
    setETarget(DEFAULTS.E_target);
    setEInputMode('decimal');
    setEInputDisplay(String(DEFAULTS.E_target));
    setZ(DEFAULTS.z);
    setRhoHistory(DEFAULTS.rho_history);
    setPilotDefectCounts([...DEFAULTS.pilotDefectCounts]);
    setDefectsCsvText(DEFAULTS.pilotDefectCounts.join(', '));
    setTableSearch('');
    setTimestamp(new Date());
    showToast('All inputs reset to Google Apps Script defaults.');
  };

  const handleCopySheets = () => {
    const tsv = analysis.outputData
      .map((r) => `${r.colA}\t${r.colB}\t${r.colC}`)
      .join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(tsv)
        .then(() => showToast('Report table copied to clipboard!'))
        .catch(() => showToast('Unable to copy automatically. Please use Export CSV.'));
    } else {
      showToast('Unable to copy automatically. Please use Export CSV.');
    }
  };

  const handleExportCsv = () => {
    const escapeCsv = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const csvContent = analysis.outputData
      .map((r) => [escapeCsv(r.colA), escapeCsv(r.colB), escapeCsv(r.colC)].join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'AQL_Cluster_Sampling_Report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Downloaded AQL_Cluster_Sampling_Report.csv');
  };

  // Chart calculations
  const maxBoxRate = Math.max(0.05, analysis.p_hat * 1.25, ...analysis.boxMeans);
  const phatLineBottomPct = Math.min(
    100,
    Math.round((analysis.p_hat / maxBoxRate) * 100)
  );
  const maxBoxes = Math.max(
    1,
    analysis.k_required_pilot,
    analysis.k_required_history_alt,
    analysis.k
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-blue-100 selection:text-blue-900">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 transition-all duration-300">
          <div className="bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 text-sm font-medium border border-slate-700">
            <Check className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{toastMsg}</span>
          </div>
        </div>
      )}

      {/* Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#4a86e8] flex items-center justify-center text-white shadow-sm shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                  Pilot Sampling
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Sheet: AQL SCRIPT PUSH
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                1-Stage &amp; 2-Stage Cluster Sampling Analysis &amp; Rho History Report
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
            >
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={handleCopySheets}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer"
              title="Copy tab-separated report table for Google Sheets"
            >
              <Copy className="w-4 h-4 text-emerald-600" />
              Copy for Google Sheets
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-600" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setTimestamp(new Date());
                showToast('Analysis recalculated & timestamp updated!');
              }}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#4a86e8] hover:bg-blue-600 active:bg-blue-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              Run Analysis
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: INPUT PARAMETERS */}
          <section className="lg:col-span-4 space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="bg-emerald-50/90 px-5 py-3.5 border-b border-emerald-200/80 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    1. Input Parameters
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Live updates &amp; standard baseline defaults
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/90 text-slate-800 border border-emerald-300 shadow-2xs">
                  {analysis.m >= analysis.M ? '1-Stage' : '2-Stage'}
                </span>
              </div>

              <div className="p-5 space-y-4">
                {/* N: Total Lot Size */}
                <div>
                  <label
                    htmlFor="inputN"
                    className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1"
                  >
                    <span>
                      Total Lot Size (<code className="font-mono text-blue-700">N</code> boxes)
                    </span>
                    <span className="text-slate-400 font-normal">Primary boxes in lot</span>
                  </label>
                  <input
                    id="inputN"
                    type="number"
                    min={1}
                    step={1}
                    value={N}
                    onChange={(e) => setN(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                </div>

                {/* M & m Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="inputM"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Pcs per Box (<code className="font-mono text-blue-700">M</code>)
                    </label>
                    <input
                      id="inputM"
                      type="number"
                      min={1}
                      step={1}
                      value={M}
                      onChange={(e) => setM(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="inputm"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Pcs Picked (<code className="font-mono text-blue-700">m</code>)
                    </label>
                    <input
                      id="inputm"
                      type="number"
                      min={1}
                      step={1}
                      value={m}
                      onChange={(e) => setm(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 -mt-2">
                  Rule: <code className="font-mono">m = M</code> &rarr; 1-Stage;{' '}
                  <code className="font-mono">m &lt; M</code> &rarr; 2-Stage Cluster Sampling.
                </p>

                {/* E_target: Target Margin of Error */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="inputE" className="text-xs font-semibold text-slate-700">
                      Target Margin of Error (
                      <code className="font-mono text-blue-700">E_target</code>)
                    </label>
                    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[11px]">
                      <button
                        type="button"
                        onClick={() => handleToggleEMode('decimal')}
                        className={`px-2 py-0.5 rounded-md font-medium cursor-pointer ${
                          eInputMode === 'decimal'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Decimal (0.05)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleEMode('percent')}
                        className={`px-2 py-0.5 rounded-md font-medium cursor-pointer ${
                          eInputMode === 'percent'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Percent (5%)
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      id="inputE"
                      type="number"
                      min={0.0001}
                      max={eInputMode === 'percent' ? 100 : 1}
                      step={eInputMode === 'percent' ? 0.5 : 0.005}
                      value={eInputDisplay}
                      onChange={(e) => handleEChange(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-medium text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-md">
                      = {(eTarget * 100).toFixed(2).replace(/\.00$/, '')}%
                    </span>
                  </div>
                </div>

                {/* z: Z-score */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="inputZ" className="text-xs font-semibold text-slate-700">
                      Z-score (<code className="font-mono text-blue-700">z</code>) Confidence Level
                    </label>
                    <div className="flex gap-1">
                      {[
                        { label: '90%', val: 1.645 },
                        { label: '95%', val: 1.96 },
                        { label: '99%', val: 2.576 },
                      ].map((preset) => {
                        const isActive = Math.abs(preset.val - z) < 0.001;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setZ(preset.val)}
                            className={`px-2 py-0.5 text-[11px] font-mono rounded-md border transition cursor-pointer ${
                              isActive
                                ? 'bg-blue-100 text-blue-800 border-blue-300 font-semibold'
                                : 'bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border-slate-200 text-slate-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    id="inputZ"
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.001}
                    value={z}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (!isNaN(val) && val > 0) setZ(val);
                    }}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                </div>

                {/* rho_history */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="inputRho" className="text-xs font-semibold text-slate-700">
                      Historical Rho (<code className="font-mono text-blue-700">rho_history</code>)
                    </label>
                    <span className="text-[11px] text-slate-500">Range: 0.00 – 1.00</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      id="inputRho"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={rhoHistory}
                      onChange={(e) => {
                        const val = Math.min(1, Math.max(0, Number(e.target.value) || 0));
                        setRhoHistory(val);
                      }}
                      className="w-28 px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={rhoHistory}
                      onChange={(e) => setRhoHistory(Number(e.target.value))}
                      className="flex-1 accent-[#4a86e8] cursor-pointer"
                    />
                  </div>
                </div>

                <hr className="border-slate-200" />

                {/* Pilot Defect Counts per Box */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="inputDefectsCsv"
                      className="text-xs font-semibold text-slate-700"
                    >
                      Pilot Defect Counts per Box
                    </label>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                        k = {analysis.k}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
                        n = {analysis.n}
                      </span>
                    </div>
                  </div>

                  <input
                    id="inputDefectsCsv"
                    type="text"
                    value={defectsCsvText}
                    onChange={(e) => handleCsvChange(e.target.value)}
                    placeholder="e.g. 0, 2, 0, 3"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Edit comma-separated list above or adjust individual box chips below:
                  </p>

                  {/* Interactive Box Chips */}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {pilotDefectCounts.map((count, idx) => {
                      const exceedsM = count > M || count > m;
                      return (
                        <div
                          key={idx}
                          className={`inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs border ${
                            exceedsM
                              ? 'bg-amber-50 border-amber-400'
                              : 'bg-slate-100 border-slate-300'
                          }`}
                        >
                          <span className="font-semibold text-slate-600 select-none pr-0.5">
                            B{idx + 1}:
                          </span>
                          <button
                            type="button"
                            onClick={() => updateBoxDefect(idx, count - 1)}
                            title={`Decrease defects in Box #${idx + 1}`}
                            className="w-5 h-5 flex items-center justify-center rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={count}
                            onChange={(e) =>
                              updateBoxDefect(idx, Number(e.target.value) || 0)
                            }
                            className="w-10 px-1 py-0.5 text-center font-mono font-semibold bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => updateBoxDefect(idx, count + 1)}
                            title={`Increase defects in Box #${idx + 1}`}
                            className="w-5 h-5 flex items-center justify-center rounded bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                          >
                            +
                          </button>
                          {pilotDefectCounts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeBox(idx)}
                              title={`Remove Box #${idx + 1}`}
                              className="text-slate-400 hover:text-rose-600 p-0.5 ml-0.5 rounded transition cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add Box Button */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addBox}
                      className="w-full py-2 px-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 text-xs font-semibold text-slate-700 hover:text-blue-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Add Sampled Box (k + 1)
                    </button>
                  </div>
                </div>

                {/* Validation Warning Box */}
                {warnings.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{warnings.join(' ')}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN: KPI CARDS, CHARTS & SPREADSHEET REPORT */}
          <section className="lg:col-span-8 space-y-6">
            {/* Top Executive KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Defect Rate (<code className="font-mono">p_hat</code>)
                </p>
                <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {(analysis.p_hat * 100).toFixed(2)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {analysis.totalDefects} defects / {analysis.n} units
                </p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Pilot Rho (<code className="font-mono">rho_pilot</code>)
                </p>
                <p className="text-2xl font-bold font-mono text-amber-600 mt-1">
                  {analysis.rho_pilot.toFixed(4)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Deff_pilot: {analysis.deff_pilot.toFixed(4)}
                </p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Pilot Req. Boxes
                </p>
                <p className="text-2xl font-bold font-mono text-blue-700 mt-1">
                  {analysis.k_required_pilot} boxes
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  +{analysis.additional_boxes_pilot} additional
                </p>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Hist. Req. Boxes
                </p>
                <p className="text-2xl font-bold font-mono text-orange-600 mt-1">
                  {analysis.k_required_history_alt} boxes
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Delta: {analysis.box_delta > 0 ? '+' : ''}
                  {analysis.box_delta} boxes
                </p>
              </div>
            </div>

            {/* Visual Analytics Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Chart 1: Box-by-Box Defect Rate vs Overall p_hat */}
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Pilot Box Defect Rates (<code className="font-mono text-xs">boxMeans</code>)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Per-box defect % vs. overall <code className="font-mono">p_hat</code> benchmark
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg">
                    <span className="w-2.5 h-0.5 bg-blue-600 inline-block" /> p_hat
                  </span>
                </div>

                <div className="w-full h-48">
                  <div className="relative h-full flex flex-col justify-end pt-2">
                    <div className="relative flex items-end gap-2 h-40 px-2 border-b border-slate-200">
                      {/* Overall p_hat reference line */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-blue-600 pointer-events-none z-10 flex justify-end"
                        style={{
                          bottom: `calc(22px + ${(phatLineBottomPct / 100) * 128}px)`,
                        }}
                      >
                        <span className="bg-blue-600 text-white text-[10px] font-mono px-1.5 py-0.5 rounded -mt-4 shadow-2xs">
                          p_hat {(analysis.p_hat * 100).toFixed(1)}%
                        </span>
                      </div>

                      {analysis.boxMeans.map((mean, idx) => {
                        const pct = (mean * 100).toFixed(1);
                        const heightPct = Math.min(
                          100,
                          Math.round((mean / maxBoxRate) * 100)
                        );
                        const defects = pilotDefectCounts[idx];
                        const isAboveAvg = mean > analysis.p_hat;
                        return (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col items-center justify-end h-full min-w-[36px] group"
                          >
                            <span
                              className={`text-[10px] font-mono font-semibold mb-1 ${
                                isAboveAvg ? 'text-rose-600' : 'text-slate-600'
                              }`}
                            >
                              {pct}%
                            </span>
                            <div
                              className="w-full max-w-[38px] bg-slate-100 rounded-t-lg h-32 flex items-end overflow-hidden border border-slate-200/80 relative"
                              title={`Box #${idx + 1}: ${defects}/${analysis.m} defects (${pct}%)`}
                            >
                              <div
                                className={`w-full rounded-t-md transition-all duration-300 ${
                                  isAboveAvg ? 'bg-rose-500/85' : 'bg-emerald-500/85'
                                }`}
                                style={{ height: `${Math.max(4, heightPct)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-medium text-slate-600 mt-1.5">
                              B{idx + 1}{' '}
                              <span className="text-[10px] text-slate-400">
                                ({defects})
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart 2: Sample Size Comparison (Pilot vs Historical Rho) */}
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Required Boxes: Pilot vs. Historical
                    </h3>
                    <p className="text-xs text-slate-500">
                      Impact of <code className="font-mono">rho_history</code> vs{' '}
                      <code className="font-mono">rho_pilot</code> on sample size
                    </p>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-200">
                    Delta: {analysis.box_delta > 0 ? '+' : ''}
                    {analysis.box_delta} boxes
                  </span>
                </div>

                <div className="w-full h-48">
                  <div className="h-full flex flex-col justify-center space-y-3.5 py-1">
                    {/* Current Pilot Sampled */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-600">
                          Current Pilot Sampled (<code className="font-mono">k</code>)
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {analysis.k} boxes
                        </span>
                      </div>
                      <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              2,
                              Math.round((analysis.k / maxBoxes) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Pilot Required Boxes */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">
                          Pilot Required (<code className="font-mono">k_req</code>, rho=
                          {analysis.rho_pilot.toFixed(2)})
                        </span>
                        <span className="font-mono font-bold text-blue-700">
                          {analysis.k_required_pilot} boxes
                        </span>
                      </div>
                      <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className="h-full bg-[#4a86e8] rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              4,
                              Math.round((analysis.k_required_pilot / maxBoxes) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Historical Rho Required Boxes */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-700">
                          Historical Required (<code className="font-mono">k_req_hist</code>, rho=
                          {rhoHistory.toFixed(2)})
                        </span>
                        <span className="font-mono font-bold text-orange-600">
                          {analysis.k_required_history_alt} boxes
                        </span>
                      </div>
                      <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                        <div
                          className="h-full bg-orange-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              4,
                              Math.round(
                                (analysis.k_required_history_alt / maxBoxes) * 100
                              )
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ANALYTICAL REPORT TABLE VIEW */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="bg-slate-100/90 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white text-xs font-bold text-slate-800 border border-slate-300 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    AQL SCRIPT PUSH
                  </span>
                  <span className="text-xs text-slate-500 hidden sm:inline">
                    Exact 32-Row Spreadsheet Output &amp; Color Formatting
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Filter metrics..."
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-40 sm:w-48"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase text-slate-500">
                      <th className="py-2.5 px-4 border-r border-slate-200 w-10 text-center">
                        #
                      </th>
                      <th className="py-2.5 px-4 border-r border-slate-200">
                        Metric / Parameter
                      </th>
                      <th className="py-2.5 px-4 border-r border-slate-200">Value</th>
                      <th className="py-2.5 px-4">
                        Description / Operational Meaning
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredRows.map(({ row, num }) => {
                      if (row.type === 'title') {
                        return (
                          <tr key={num} className="bg-[#4a86e8] text-white font-bold">
                            <td className="py-2.5 px-4 border-r border-blue-400/50 text-center font-mono text-xs opacity-90">
                              {num}
                            </td>
                            <td className="py-2.5 px-4" colSpan={3}>
                              {row.colA}
                            </td>
                          </tr>
                        );
                      }

                      if (row.type === 'spacer') {
                        return (
                          <tr key={num} className="bg-slate-50/70 h-3">
                            <td className="py-1 px-4 border-r border-slate-200 text-center font-mono text-[10px] text-slate-400">
                              {num}
                            </td>
                            <td className="py-1 px-4 border-r border-slate-200" />
                            <td className="py-1 px-4 border-r border-slate-200" />
                            <td className="py-1 px-4" />
                          </tr>
                        );
                      }

                      if (row.type === 'header-input') {
                        return (
                          <tr
                            key={num}
                            className="bg-[#d9ead3] text-slate-900 font-bold text-xs tracking-wide"
                          >
                            <td className="py-2.5 px-4 border-r border-emerald-300/70 text-center font-mono text-slate-600">
                              {num}
                            </td>
                            <td className="py-2.5 px-4 border-r border-emerald-300/70">
                              {row.colA}
                            </td>
                            <td className="py-2.5 px-4 border-r border-emerald-300/70">
                              {row.colB}
                            </td>
                            <td className="py-2.5 px-4">{row.colC}</td>
                          </tr>
                        );
                      }

                      if (row.type === 'header-pilot') {
                        return (
                          <tr
                            key={num}
                            className="bg-[#fff2cc] text-slate-900 font-bold text-xs tracking-wide"
                          >
                            <td className="py-2.5 px-4 border-r border-amber-300/70 text-center font-mono text-slate-600">
                              {num}
                            </td>
                            <td className="py-2.5 px-4 border-r border-amber-300/70">
                              {row.colA}
                            </td>
                            <td className="py-2.5 px-4 border-r border-amber-300/70">
                              {row.colB}
                            </td>
                            <td className="py-2.5 px-4">{row.colC}</td>
                          </tr>
                        );
                      }

                      if (row.type === 'header-hist') {
                        return (
                          <tr
                            key={num}
                            className="bg-[#fce5cd] text-slate-900 font-bold text-xs tracking-wide"
                          >
                            <td className="py-2.5 px-4 border-r border-orange-300/70 text-center font-mono text-slate-600">
                              {num}
                            </td>
                            <td className="py-2.5 px-4 border-r border-orange-300/70">
                              {row.colA}
                            </td>
                            <td className="py-2.5 px-4 border-r border-orange-300/70">
                              {row.colB}
                            </td>
                            <td className="py-2.5 px-4">{row.colC}</td>
                          </tr>
                        );
                      }

                      let valueHighlight = 'text-slate-900 font-semibold';
                      if (row.type === 'row-pilot')
                        valueHighlight = 'text-blue-900 font-semibold';
                      if (row.type === 'row-hist')
                        valueHighlight = 'text-orange-900 font-semibold';
                      if (row.type === 'meta')
                        valueHighlight = 'text-indigo-700 font-semibold';

                      return (
                        <tr
                          key={num}
                          className="hover:bg-slate-50/90 transition-colors"
                        >
                          <td className="py-2.5 px-4 border-r border-slate-200 text-center font-mono text-xs text-slate-400 select-none">
                            {num}
                          </td>
                          <td className="py-2.5 px-4 border-r border-slate-200 font-medium text-slate-800">
                            {row.colA}
                          </td>
                          <td
                            className={`py-2.5 px-4 border-r border-slate-200 font-mono text-xs sm:text-sm ${valueHighlight} whitespace-nowrap`}
                          >
                            {row.colB}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600 leading-relaxed">
                            {row.colC}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
