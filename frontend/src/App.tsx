import { useState, useEffect } from 'react';
import MSAViewer from './components/MSAViewer';
import QueryViewer from './components/QueryViewer';
import BlastResults from './components/BlastResults';

type Step = 'input' | 'blasting' | 'aligning' | 'done';

interface BlastHit {
  accession: string;
  description: string;
  evalue: number;
  identity: number;
  query_cover: number;
}

function App() {
  const [input, setInput] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [blastHits, setBlastHits] = useState<BlastHit[]>([]);
  const [blastMeta, setBlastMeta] = useState<{ rid: string; rtoe: number; query_len: number } | null>(null);
  const [alignment, setAlignment] = useState('');
  const [selectedSequence, setSelectedSequence] = useState<{ id: string; seq: string; start: number; end: number } | null>(null);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ncbi_api_key') || '');
  const [idtClientId, setIdtClientId] = useState(() => localStorage.getItem('idt_client_id') || '');
  const [idtClientSecret, setIdtClientSecret] = useState(() => localStorage.getItem('idt_client_secret') || '');
  const [idtUsername, setIdtUsername] = useState(() => localStorage.getItem('idt_username') || '');
  const [idtPassword, setIdtPassword] = useState(() => localStorage.getItem('idt_password') || '');
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('ncbi_api_key'));
  const [maxHitsPreset, setMaxHitsPreset] = useState(() => localStorage.getItem('max_hits_preset') || '50');
  const [customHits, setCustomHits] = useState(() => localStorage.getItem('custom_hits') || '');
  const [organism, setOrganism] = useState(() => localStorage.getItem('organism') || '');
  const [eValue, setEValue] = useState(() => localStorage.getItem('e_value') || '0.05');
  const [percIdentity, setPercIdentity] = useState(() => localStorage.getItem('perc_identity') || '0');

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [jobName, setJobName] = useState(() => localStorage.getItem('job_name') || 'Query');
  const [selectedPrimers, setSelectedPrimers] = useState<{ p1: { start: number, end: number }, p2: { start: number, end: number } } | null>(null);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Persistence hooks
  useEffect(() => { localStorage.setItem('organism', organism); }, [organism]);
  useEffect(() => { localStorage.setItem('e_value', eValue); }, [eValue]);
  useEffect(() => { localStorage.setItem('perc_identity', percIdentity); }, [percIdentity]);
  useEffect(() => { localStorage.setItem('max_hits_preset', maxHitsPreset); }, [maxHitsPreset]);
  useEffect(() => { localStorage.setItem('custom_hits', customHits); }, [customHits]);
  useEffect(() => { localStorage.setItem('job_name', jobName); }, [jobName]);

  const maxHits = maxHitsPreset === 'custom'
    ? parseInt(customHits, 10) || 50
    : maxHitsPreset === 'all' ? 5000 : parseInt(maxHitsPreset, 10);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (val.trim()) {
      localStorage.setItem('ncbi_api_key', val.trim());
    } else {
      localStorage.removeItem('ncbi_api_key');
    }
  };

  const handleIdtIdChange = (val: string) => {
    setIdtClientId(val);
    if (val.trim()) {
      localStorage.setItem('idt_client_id', val.trim());
    } else {
      localStorage.removeItem('idt_client_id');
    }
  };

  const handleIdtSecretChange = (val: string) => {
    setIdtClientSecret(val);
    if (val.trim()) {
      localStorage.setItem('idt_client_secret', val.trim());
    } else {
      localStorage.removeItem('idt_client_secret');
    }
  };

  const handleIdtUsernameChange = (val: string) => {
    setIdtUsername(val);
    if (val.trim()) {
      localStorage.setItem('idt_username', val.trim());
    } else {
      localStorage.removeItem('idt_username');
    }
  };

  const handleIdtPasswordChange = (val: string) => {
    setIdtPassword(val);
    if (val.trim()) {
      localStorage.setItem('idt_password', val.trim());
    } else {
      localStorage.removeItem('idt_password');
    }
  };

  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Input Sequence' },
    { key: 'blasting', label: 'BLAST Search' },
    { key: 'aligning', label: 'MSA Alignment' },
    { key: 'done', label: 'Results' },
  ];

  const stepOrder = ['input', 'blasting', 'aligning', 'done'];

  const handleSearch = async () => {
    setStep('blasting');
    setError('');
    setBlastHits([]);
    setBlastMeta(null);
    setAlignment('');
    setSelectedSequence(null);

    try {
      // Parse: if it's FASTA, extract the sequence; otherwise use raw text
      let sequence = input.trim();
      if (!sequence) {
        throw new Error('Please enter a sequence.');
      }

      const response = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence,
          max_hits: maxHits,
          api_key: apiKey.trim(),
          organism: organism.trim() || undefined,
          e_value: parseFloat(eValue) || undefined,
          perc_identity: parseFloat(percIdentity) || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Search failed');
      }

      const data = await response.json();
      setBlastHits(data.blast_hits);
      setBlastMeta(data.blast_meta);
      setStep('aligning');

      // Small delay so the user sees the step change
      await new Promise((r) => setTimeout(r, 300));
      setAlignment(data.alignment);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('input');
    }
  };

  const handleReset = () => {
    setStep('input');
    setBlastHits([]);
    setBlastMeta(null);
    setAlignment('');
    setSelectedSequence(null);
    setError('');
    setInput('');
  };

  const isStepActive = (s: Step) => stepOrder.indexOf(s) <= stepOrder.indexOf(step);
  const isStepCurrent = (s: Step) => s === step;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-900 dark:to-slate-950 py-8 px-4 sm:px-6 lg:px-8 transition-colors duration-200">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
              Oligool
            </h1>
            <p className="mt-1 text-slate-500 dark:text-slate-400">BLAST Search → Multiple Sequence Alignment</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Theme Toggle Button (Primerool style) */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              aria-label="Toggle Dark Mode"
              className="relative inline-flex h-8 w-16 items-center rounded-full transition-colors duration-300 focus:outline-none bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
            >
              <span className="sr-only">Toggle Dark Mode</span>
              {/* Track Icons */}
              <div className="absolute inset-0 flex items-center justify-between px-2">
                {/* Sun (Left) */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                {/* Moon (Right) */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              </div>
              {/* Thumb */}
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-300 ease-in-out ${isDarkMode ? 'translate-x-8' : 'translate-x-1'}`}
              >
                <span className="flex items-center justify-center w-full h-full">
                  {/* Sun in Thumb (Light Mode) */}
                  {!isDarkMode && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                  {/* Moon in Thumb (Dark Mode) */}
                  {isDarkMode && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                </span>
              </span>
            </button>

            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`mt-0.5 p-2 rounded-lg border transition-colors ${showSettings
                ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400'
                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500 dark:hover:text-slate-400'
                }`}
              title="NCBI Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </header>

        {/* NCBI API Key Settings */}
        {showSettings && (
          <div className="mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    NCBI Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="NCBI API key"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Increases BLAST rate limit (3 → 10 req/s). Get from <a href="https://www.ncbi.nlm.nih.gov/account/settings/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">NCBI Settings</a>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    IDT Client ID
                  </label>
                  <input
                    type="password"
                    value={idtClientId}
                    onChange={(e) => handleIdtIdChange(e.target.value)}
                    placeholder="OligoAnalyzer Client ID"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    IDT Secret
                  </label>
                  <input
                    type="password"
                    value={idtClientSecret}
                    onChange={(e) => handleIdtSecretChange(e.target.value)}
                    placeholder="OligoAnalyzer Client Secret"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    IDT User
                  </label>
                  <input
                    type="text"
                    value={idtUsername}
                    onChange={(e) => handleIdtUsernameChange(e.target.value)}
                    placeholder="IDT Username"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    IDT Pass
                  </label>
                  <input
                    type="password"
                    value={idtPassword}
                    onChange={(e) => handleIdtPasswordChange(e.target.value)}
                    placeholder="IDT Account Password"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Required for IDT OligoAnalyzer features. Obtain from <a href="https://www.idtdna.com/pages/scitools/plus-api" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">IDT SciTools Plus API</a>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Progress Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between max-w-2xl relative">
            {steps.map((s, idx) => (
              <div key={s.key} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${isStepCurrent(s.key)
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 dark:ring-indigo-900/40'
                      : isStepActive(s.key)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                  >
                    {isStepActive(s.key) && !isStepCurrent(s.key) ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`mt-1.5 text-xs font-medium ${isStepActive(s.key) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'
                      }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 transition-colors duration-300 ${stepOrder.indexOf(step) > idx ? 'bg-indigo-400 dark:bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                  />
                )}
              </div>
            ))}

            {/* Logo positioned to the right of the "Results" bubble */}
            <img
              src="/rabbit_oligool.png"
              alt="Oligool Logo"
              className={`absolute h-68 w-auto object-contain z-10 pointer-events-none hidden lg:block opacity-90 transition-all duration-500 xl:left-[calc(100%+60px)] lg:left-[calc(100%+60px)] ${step === 'done'
                ? 'top-[-135px]'
                : 'top-[-135px]'
                }`}
            />
          </div>
        </div>

        <main>
          {/* Input Area */}
          <div className={`bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-6 transition-all duration-300 ${step === 'done' ? 'hidden' : 'block'}`}>

            {/* Job Name Input */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Job Name
              </label>
              <input
                type="text"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. My Gene Analysis"
                className="w-full sm:w-1/2 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm px-3 py-2 border"
              />
            </div>

            <label htmlFor="sequence" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Query Sequence
              <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">(FASTA or raw sequence)</span>
            </label>
            {/* ... textarea ... */}
            <textarea
              id="sequence"
              rows={8}
              disabled={step !== 'input'}
              className="w-full rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm p-3 border disabled:opacity-50 disabled:bg-slate-50 dark:disabled:bg-slate-800"
              placeholder={">my_sequence\nATCGATCGATCGATCGATCGATCGATCG..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            {/* ... filters ... */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 dark:border-slate-700 pt-4">
              {/* Organism Filter */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Organism (Optional)</label>
                <input
                  type="text"
                  value={organism}
                  onChange={(e) => setOrganism(e.target.value)}
                  disabled={step !== 'input'}
                  placeholder="e.g. human, mouse, txid9606"
                  className="w-full rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 placeholder-slate-400 dark:placeholder-slate-500 border"
                />
              </div>

              {/* E-value Threshold */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">E-value Threshold</label>
                <input
                  type="number"
                  step="1e-10"
                  min="0"
                  value={eValue}
                  onChange={(e) => setEValue(e.target.value)}
                  disabled={step !== 'input'}
                  className="w-full rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 border"
                />
              </div>

              {/* % Identity Threshold */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">% Identity Threshold</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={percIdentity}
                  onChange={(e) => setPercIdentity(e.target.value)}
                  disabled={step !== 'input'}
                  className="w-full rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 border"
                />
              </div>
            </div>
            {/* ... buttons ... */}
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Max hits:</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                  {[
                    { value: 'all', label: 'All' },
                    { value: '1000', label: '1000' },
                    { value: '500', label: '500' },
                    { value: '100', label: '100' },
                    { value: '50', label: '50' },
                    { value: '10', label: '10' },
                    { value: 'custom', label: '#' },
                  ].map((opt, i) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMaxHitsPreset(opt.value)}
                      disabled={step !== 'input'}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${i > 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''
                        } ${maxHitsPreset === opt.value
                          ? 'bg-indigo-500 text-white'
                          : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                        }`}
                      title={opt.value === 'custom' ? 'Custom number' : opt.value === 'all' ? 'Up to 5000' : `Top ${opt.label}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out flex items-center ${maxHitsPreset === 'custom' ? 'w-24 ml-2 opacity-100' : 'w-0 ml-0 opacity-0'
                    }`}
                >
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={customHits}
                    onChange={(e) => setCustomHits(e.target.value)}
                    disabled={step !== 'input'}
                    placeholder="e.g. 200"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-2 py-1 text-xs font-mono focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                {step !== 'input' && (
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    Reset
                  </button>
                )}
                {step === 'input' && blastHits.length > 0 && (
                  <button
                    onClick={() => setStep('done')}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    Go Back
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={step !== 'input' || !input.trim()}
                  className={`px-5 py-2 text-sm font-medium rounded-lg shadow-sm text-white transition-all duration-200 ${step !== 'input' || !input.trim()
                    ? 'bg-slate-300 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'
                    }`}
                >
                  Search &amp; Align
                </button>
              </div>
            </div>
          </div>

          {/* Loading states */}
          {step === 'blasting' && (
            <div className="bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-slate-200 dark:border-slate-700 p-8 mb-6 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent mb-3"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Running BLAST search against NCBI...</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">This may take 30–120 seconds depending on NCBI server load.</p>
            </div>
          )}

          {step === 'aligning' && (
            <div className="bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-slate-200 dark:border-slate-700 p-8 mb-6 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-purple-600 border-t-transparent mb-3"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Running MAFFT alignment on {blastHits.length} sequences...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-6">
              <div className="flex items-start">
                <span className="text-red-500 mr-3 text-lg">⚠</span>
                <div>
                  <h3 className="text-sm font-semibold text-red-800">Error</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Results Summary & Actions */}
          {step === 'done' && blastMeta && (
            <div className="mb-6 bg-white dark:bg-slate-800 shadow-sm rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  {(jobName && jobName !== 'Query') ? jobName : 'Search Analysis'} Completed
                </h3>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono flex flex-wrap gap-x-4 gap-y-1">
                  <span>RID: <span className="text-slate-700 dark:text-slate-300">{blastMeta.rid}</span></span>
                  <span>Len: <span className="text-slate-700 dark:text-slate-300">{blastMeta.query_len} bp</span></span>
                  <span>Hits: <span className="text-slate-700 dark:text-slate-300">{blastHits.length}</span></span>
                  <span>Time: <span className="text-slate-700 dark:text-slate-300">~{blastMeta.rtoe}s</span></span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('input')}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  Edit Search
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* BLAST Results Table */}
          {blastHits.length > 0 && <BlastResults hits={blastHits} />}

          {/* MSA Viewer */}
          {alignment && (
            <>
              <MSAViewer
                alignment={alignment}
                onVisibleQueryChange={setSelectedSequence}
                jobName={jobName}
                primers={selectedPrimers}
                isDarkMode={isDarkMode}
              />
              {step === 'done' && selectedSequence && (
                <QueryViewer
                  data={selectedSequence}
                  jobName={jobName}
                  onPrimersUpdate={setSelectedPrimers}
                  idtCredentials={idtClientId && idtClientSecret ? {
                    clientId: idtClientId,
                    clientSecret: idtClientSecret,
                    username: idtUsername,
                    password: idtPassword
                  } : undefined}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
