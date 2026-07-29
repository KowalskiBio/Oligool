import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MSAViewer, { type MSAViewerHandle } from './components/MSAViewer';
import QueryViewer, { type QueryViewerHandle, type ImportedSession } from './components/QueryViewer';
import BlastResults from './components/BlastResults';
import RabbitGame from './components/RabbitGame';
import { downloadSession, parseSessionText, OLIGOOL_SESSION_APP, OLIGOOL_SESSION_VERSION, type OligoolSession } from './utils/session';

type Step = 'input' | 'blasting' | 'aligning' | 'done';

interface BlastHit {
  accession: string;
  description: string;
  evalue: number;
  identity: number;
  query_cover: number;
  sstart?: number;
  send?: number;
  rank?: number;
}

function App() {
  const [input, setInput] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [blastHits, setBlastHits] = useState<BlastHit[]>([]);
  const [filteredHits, setFilteredHits] = useState<BlastHit[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const [blastMeta, setBlastMeta] = useState<{ rid: string; rtoe: number; query_len: number } | null>(null);
  const [alignment, setAlignment] = useState('');
  const [selectedSequence, setSelectedSequence] = useState<{ id: string; seq: string; start: number; end: number; fullSeq?: string; ungappedOffset?: number } | null>(null);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ncbi_api_key') || '');
  const [idtClientId, setIdtClientId] = useState(() => localStorage.getItem('idt_client_id') || '');
  const [idtClientSecret, setIdtClientSecret] = useState(() => localStorage.getItem('idt_client_secret') || '');
  const [idtUsername, setIdtUsername] = useState(() => localStorage.getItem('idt_username') || '');
  const [idtPassword, setIdtPassword] = useState(() => localStorage.getItem('idt_password') || '');
  const [idtRegion, setIdtRegion] = useState<'us' | 'eu'>(() => {
    const saved = localStorage.getItem('idt_region');
    return saved === 'us' ? 'us' : 'eu';
  });
  const [idtMgConc, setIdtMgConc] = useState(() => localStorage.getItem('idt_mg_conc') || '0');
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('ncbi_api_key'));
  const [maxHitsPreset, setMaxHitsPreset] = useState(() => localStorage.getItem('max_hits_preset') || '50');
  const [customHits, setCustomHits] = useState(() => localStorage.getItem('custom_hits') || '');
  const [organism, setOrganism] = useState(() => localStorage.getItem('organism') || '');
  const [eValue, setEValue] = useState(() => localStorage.getItem('e_value') || '0.05');
  const [percIdentity, setPercIdentity] = useState(() => localStorage.getItem('perc_identity') || '0');
  const [filterMatches, setFilterMatches] = useState(() => localStorage.getItem('filter_matches') === 'true');

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [jobName, setJobName] = useState(() => localStorage.getItem('job_name') || 'Query');
  const [selectedPrimers, setSelectedPrimers] = useState<{ p1: { start: number, end: number }, p2: { start: number, end: number } } | null>(null);
  const [selectedFlankingPrimers, setSelectedFlankingPrimers] = useState<{ fwd: { start: number; end: number } | null; rev: { start: number; end: number } | null; fwdName?: string; revName?: string; amplicon?: number } | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [navigateTarget, setNavigateTarget] = useState<{ colStart: number; colEnd: number; ts: number } | null>(null);
  const [oligoRegion, setOligoRegion] = useState<{ startCol: number; endCol: number } | null>(null);
  const [autofindRegion, setAutofindRegion] = useState<{ startCol: number; endCol: number } | null>(null);
  const [autofindSelectedAccessions, setAutofindSelectedAccessions] = useState<Set<string>>(new Set());
  const [autofindTreatIndelsAsMismatches, setAutofindTreatIndelsAsMismatches] = useState(
    () => localStorage.getItem('autofind_treat_indels_as_mismatches') === 'true'
  );
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  const queryViewerRef = useRef<QueryViewerHandle>(null);
  const msaViewerRef = useRef<MSAViewerHandle>(null);
  const msaViewerContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importNonceRef = useRef(0);
  const [importedSession, setImportedSession] = useState<ImportedSession | null>(null);
  const [sessionMsg, setSessionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pendingSession, setPendingSession] = useState<OligoolSession | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [restoredRegion, setRestoredRegion] = useState<{ start: number; end: number } | null>(null);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMsaViewportRef = useRef<{ scrollLeft: number; scrollTop: number; viewFraction: number; viewMode: 'bars' | 'letters' } | null>(null);
  const AUTOSAVE_KEY = 'oligool_autosave';

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
  useEffect(() => { localStorage.setItem('filter_matches', filterMatches.toString()); }, [filterMatches]);
  useEffect(() => { localStorage.setItem('max_hits_preset', maxHitsPreset); }, [maxHitsPreset]);
  useEffect(() => { localStorage.setItem('custom_hits', customHits); }, [customHits]);
  useEffect(() => { localStorage.setItem('job_name', jobName); }, [jobName]);
  useEffect(() => { localStorage.setItem('idt_mg_conc', idtMgConc); }, [idtMgConc]);
  useEffect(() => { localStorage.setItem('idt_region', idtRegion); }, [idtRegion]);
  useEffect(() => {
    localStorage.setItem('autofind_treat_indels_as_mismatches', autofindTreatIndelsAsMismatches.toString());
  }, [autofindTreatIndelsAsMismatches]);

  useEffect(() => {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return;
    try {
      const session = parseSessionText(saved);
      if (session.results.alignment) {
        setPendingSession(session);
        setShowPreview(true);
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, []);

  // Sync Mg²⁺ changes from QueryViewer's inline input back to App state
  useEffect(() => {
    const handler = (e: Event) => {
      const val = (e as CustomEvent).detail;
      setIdtMgConc(val);
    };
    window.addEventListener('idt-mg-change', handler);
    return () => window.removeEventListener('idt-mg-change', handler);
  }, []);

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

  const handleIdtRegionChange = (val: 'us' | 'eu') => {
    setIdtRegion(val);
    localStorage.setItem('idt_region', val);
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
    setElapsedSeconds(0);
    setSelectedFlankingPrimers(null);
    setImportedSession(null); // a fresh search must not re-apply a previously loaded session

    const timerId = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

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
          filter_matches: filterMatches,
        }),
      });

      if (!response.ok) {
        let errorMsg = `Server error: ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.detail || errorMsg;
        } catch (e) {
          // Fallback if response is not JSON (e.g., Cloudflare 504 HTML page)
          if (response.status === 504) {
            errorMsg = "Cloudflare Timeout (504): The NCBI BLAST search took too long. Please add an NCBI API Key in Settings to speed up the search!";
          } else if (response.status === 502) {
            errorMsg = "Bad Gateway (502): The Oligool backend is currently down or restarting on your VM.";
          }
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.detail || 'Search or alignment failed');
      }

      setBlastHits(data.blast_hits);
      setFilteredHits(data.filtered_hits || []);
      setShowMatches(false);
      setAutofindSelectedAccessions(new Set([
        ...data.blast_hits.map((h: BlastHit) => h.accession),
        ...(data.filtered_hits || []).map((h: BlastHit) => h.accession),
      ]));
      setBlastMeta(data.blast_meta);
      setStep('aligning');

      // Small delay so the user sees the step change
      await new Promise((r) => setTimeout(r, 300));
      setAlignment(data.alignment);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('input');
    } finally {
      clearInterval(timerId);
    }
  };

  const handleReset = () => {
    setStep('input');
    setBlastHits([]);
    setFilteredHits([]);
    setShowMatches(false);
    setBlastMeta(null);
    setAlignment('');
    setSelectedSequence(null);
    setError('');
    setInput('');
    setSelectedFlankingPrimers(null);
    setAutofindSelectedAccessions(new Set());
    setImportedSession(null);
  };

  const flashSessionMsg = (type: 'ok' | 'err', text: string, ms = 3000) => {
    setSessionMsg({ type, text });
    setTimeout(() => setSessionMsg(null), ms);
  };

  const buildSession = useCallback((): OligoolSession | null => {
    if (!alignment) return null;
    return {
      app: OLIGOOL_SESSION_APP,
      version: OLIGOOL_SESSION_VERSION,
      savedAt: new Date().toISOString(),
      jobName,
      search: { input, organism, eValue, percIdentity, filterMatches, maxHitsPreset, customHits },
      results: {
        blastHits,
        filteredHits,
        blastMeta,
        showMatches,
        alignment,
        autofindSelectedAccessions: Array.from(autofindSelectedAccessions),
        autofindTreatIndelsAsMismatches,
        selectedSequence: selectedSequence ?? undefined,
        msaViewport: msaViewerRef.current?.getViewportSnapshot(),
      },
      oligo: queryViewerRef.current?.getSnapshot() ?? null,
      flankingPrimers: selectedFlankingPrimers ?? null,
    };
  }, [alignment, blastHits, filteredHits, blastMeta, showMatches, jobName, input, organism, eValue, percIdentity, filterMatches, maxHitsPreset, customHits, autofindSelectedAccessions, autofindTreatIndelsAsMismatches, selectedFlankingPrimers, selectedSequence]);

  // ── Restore a previously saved session, skipping the BLAST/MSA pipeline ──
  const applySession = useCallback((session: OligoolSession) => {
    setJobName(session.jobName || 'Query');
    setInput(session.search?.input ?? '');
    setOrganism(session.search?.organism ?? '');
    setEValue(session.search?.eValue ?? '0.05');
    setPercIdentity(session.search?.percIdentity ?? '0');
    setFilterMatches(!!session.search?.filterMatches);
    setMaxHitsPreset(session.search?.maxHitsPreset ?? '50');
    setCustomHits(session.search?.customHits ?? '');

    setBlastHits(session.results.blastHits || []);
    setFilteredHits(session.results.filteredHits || []);
    setBlastMeta(session.results.blastMeta || null);
    setShowMatches(!!session.results.showMatches);
    setAutofindSelectedAccessions(new Set(session.results.autofindSelectedAccessions || []));
    setAutofindTreatIndelsAsMismatches(!!session.results.autofindTreatIndelsAsMismatches);

    setSelectedPrimers(null);
    setOligoRegion(null);
    setSelectedFlankingPrimers(session.flankingPrimers || null);
    setError('');

    setSelectedSequence(session.results.selectedSequence ?? null);
    pendingMsaViewportRef.current = session.results.msaViewport ?? null;

    setAlignment(session.results.alignment);
    setStep('done');

    if (session.oligo) {
      importNonceRef.current += 1;
      setImportedSession({ nonce: importNonceRef.current, oligo: session.oligo });
      const co = session.oligo.currentOligo;
      if (co && !session.results.msaViewport) {
        setNavigateTarget({ colStart: co.p1AbsStart - 1, colEnd: co.p2AbsEnd - 1, ts: Date.now() });
      }
    } else {
      setImportedSession(null);
    }
  }, []);

  // ── Save the whole working session to a downloadable file ──────────────
  const handleSaveSession = useCallback(() => {
    const session = buildSession();
    if (!session) {
      flashSessionMsg('err', 'Nothing to save yet — run a search first.');
      return;
    }
    try {
      downloadSession(session);
      localStorage.removeItem(AUTOSAVE_KEY);
      flashSessionMsg('ok', 'Session saved');
    } catch (e: any) {
      flashSessionMsg('err', e?.message || 'Failed to save session');
    }
  }, [buildSession]);

  const confirmApplySession = useCallback((session: OligoolSession) => {
    applySession(session);
    flashSessionMsg('ok', `Loaded "${session.jobName || 'session'}"`);
    setPendingSession(null);
    setShowPreview(false);
    localStorage.removeItem(AUTOSAVE_KEY);
  }, [applySession]);

  const rejectPendingSession = useCallback(() => {
    setPendingSession(null);
    setShowPreview(false);
  }, []);

  const handleLoadSessionFile = async (file: File) => {
    try {
      const text = await file.text();
      const session = parseSessionText(text);
      setPendingSession(session);
      setShowPreview(true);
    } catch (e: any) {
      flashSessionMsg('err', e?.message || 'Failed to load session', 5000);
    }
  };

  useEffect(() => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      const session = buildSession();
      if (session) {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(session));
      }
    }, 2000);
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [buildSession]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (e.key === 'p' || e.key === 'P') {
        const pinBtn = document.getElementById('btn-pin-position') as HTMLButtonElement | null;
        if (pinBtn && !pinBtn.disabled) {
          pinBtn.click();
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveSession();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveSession]);

  useEffect(() => {
    if (pendingMsaViewportRef.current && msaViewerRef.current) {
      msaViewerRef.current.applyViewportSnapshot(pendingMsaViewportRef.current);
      pendingMsaViewportRef.current = null;
    }
  }, [alignment]);

  const isStepActive = (s: Step) => stepOrder.indexOf(s) <= stepOrder.indexOf(step);
  const isStepCurrent = (s: Step) => s === step;

  // When showMatches is off, strip 100%-match sequences from the FASTA alignment
  const visibleAlignment = (() => {
    if (showMatches || filteredHits.length === 0 || !alignment) return alignment;
    const filteredAccessions = new Set(filteredHits.map(h => h.accession));
    const blocks = alignment.split(/(?=>)/);
    return blocks.filter(block => {
      const header = block.match(/^>([^\n]+)/)?.[1] ?? '';
      return !filteredAccessions.has(header.trim().split(/\s/)[0]);
    }).join('');
  })();

  const hitRanges = useMemo(() => {
    const ranges: Record<string, { sstart: number; send: number; rank: number }> = {};
    for (const hit of blastHits) {
      if (hit.sstart !== undefined && hit.send !== undefined && hit.rank !== undefined) {
        ranges[hit.accession] = { sstart: hit.sstart, send: hit.send, rank: hit.rank };
      }
    }
    for (const hit of filteredHits) {
      if (hit.sstart !== undefined && hit.send !== undefined && hit.rank !== undefined) {
        ranges[hit.accession] = { sstart: hit.sstart, send: hit.send, rank: hit.rank };
      }
    }
    return ranges;
  }, [blastHits, filteredHits]);

  const handleHitClick = useCallback((hit: BlastHit) => {
    if (!visibleAlignment) return;

    const lines = visibleAlignment.trim().split('\n');
    const alignmentAccessions: string[] = [];

    for (const line of lines) {
      if (line.startsWith('>')) {
        const header = line.substring(1).trim();
        const parts = header.split(/\s+/);
        if (parts.length > 0) {
          alignmentAccessions.push(parts[0]);
        }
      }
    }

    const hitIndex = alignmentAccessions.indexOf(hit.accession);
    if (hitIndex === -1) return;

    const autofindSelections = new Set<string>();
    for (let i = 1; i <= hitIndex && i < alignmentAccessions.length; i++) {
      autofindSelections.add(alignmentAccessions[i]);
    }

    setAutofindSelectedAccessions(autofindSelections);
    msaViewerRef.current?.scrollToRow(hitIndex);
    msaViewerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [visibleAlignment]);

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
            {/* Session Save / Load */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLoadSessionFile(file);
                e.target.value = ''; // allow re-loading the same file
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowWhatsNew(true)}
                title="Kliknutím zobrazíte novinky a návod k použití"
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 whitespace-nowrap cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
              >
                v0.9.4 beta
              </button>
              {sessionMsg && (
                <span
                  className={`text-xs font-medium animate-in fade-in ${sessionMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {sessionMsg.text}
                </span>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Load a saved Oligool session (.oligool.json)"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-xs font-medium"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Load
              </button>
              {step === 'done' && alignment && (
                <button
                  onClick={handleSaveSession}
                  title="Save this session (oligos, pinned positions, primers & alignment) to a file"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-xs font-medium"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16v1a3 3 0 01-3 3H7a3 3 0 01-3-3v-1m4-4l4 4m0 0l4-4m-4 4V4" />
                  </svg>
                  Save
                </button>
              )}
            </div>

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
          <div className="mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50 rounded-t-xl">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">API Credentials</h3>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={showSecrets}
                    onChange={(e) => setShowSecrets(e.target.checked)}
                    aria-label="Show Secrets"
                  />
                  <div className={`block w-8 h-4 rounded-full transition-colors ${showSecrets ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform ${showSecrets ? 'translate-x-4' : ''}`}></div>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
                  Show Passwords
                </span>
              </label>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    NCBI Key
                  </label>
                  <input
                    type={showSecrets ? "text" : "password"}
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
                    type={showSecrets ? "text" : "password"}
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
                    type={showSecrets ? "text" : "password"}
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
                    type={showSecrets ? "text" : "password"}
                    value={idtPassword}
                    onChange={(e) => handleIdtPasswordChange(e.target.value)}
                    placeholder="IDT Account Password"
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase w-24">
                    IDT Region
                  </label>
                  <select
                    value={idtRegion}
                    onChange={(e) => handleIdtRegionChange(e.target.value as 'us' | 'eu')}
                    className="flex-1 rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs p-2 border font-mono"
                  >
                    <option value="eu">EU (eu.idtdna.com)</option>
                    <option value="us">US (www.idtdna.com)</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Required for IDT OligoAnalyzer features. Obtain from <a href="https://www.idtdna.com/pages/scitools/plus-api" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">IDT SciTools Plus API</a>. US and EU accounts use separate IDT regions.
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

              {/* Filter Matches Toggle */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Filter matches:</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                  <button
                    type="button"
                    onClick={() => setFilterMatches(true)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${filterMatches ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                      }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMatches(false)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 border-l border-slate-300 dark:border-slate-600 ${!filterMatches ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                      }`}
                  >
                    No
                  </button>
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

          {/* Loading states (Foreshadowing Blueprint) */}
          {(step === 'blasting' || step === 'aligning') && (
            <div className="space-y-6 mt-8">
              {/* Status Indicator */}
              <div className="flex flex-col items-center justify-center gap-2 mb-8 animate-pulse duration-1000">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 font-mono text-sm">
                  <div className={`w-5 h-5 border-2 ${step === 'blasting' ? 'border-indigo-500' : 'border-purple-500'} border-t-transparent rounded-full animate-spin`}></div>
                  {step === 'blasting' ? 'Running BLAST search and collecting homologs...' : 'Finalizing MAFFT alignment...'}
                  <span className="font-semibold text-indigo-500 ml-2">
                    {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                  </span>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">This may take 1-2 minutes depending on sequence count. Preparing environment...</p>
              </div>

              <div><RabbitGame /></div>

              {/* MSA Viewer Blueprint */}
              <div className="border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-800 opacity-60 pointer-events-none animate-pulse duration-1000">
                <div className="h-14 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700/50 flex items-center px-4 gap-4">
                  <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
                  <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
                </div>
                <div className="h-10 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/50 flex items-center px-4">
                  <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded opacity-50"></div>
                </div>
                <div className="p-4 space-y-3 bg-white dark:bg-slate-800">
                  <div className="flex gap-4"><div className="w-24 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div><div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div><div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div><div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div><div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-slate-200 dark:bg-slate-700 rounded"></div><div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded"></div></div>
                </div>
              </div>

              {/* Provenance Blueprint */}
              <div className="border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-800 opacity-40 mt-6 pointer-events-none">
                <div className="h-14 bg-gradient-to-r from-slate-50 to-indigo-50/30 dark:from-slate-800 dark:to-indigo-900/10 border-b border-slate-200 dark:border-slate-700/50 px-5 flex items-center justify-between">
                  <div className="h-5 w-48 bg-slate-200 dark:bg-slate-700 rounded"></div>
                  <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
                </div>
                <div className="p-5 flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-4">
                    <div className="h-32 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700/50"></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="h-12 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700/50"></div>
                      <div className="h-12 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700/50"></div>
                    </div>
                  </div>
                  <div className="w-full md:w-64 space-y-4">
                    <div className="h-40 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700/50"></div>
                  </div>
                </div>
              </div>
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
          {blastHits.length > 0 && (
            <BlastResults
              hits={blastHits}
              filteredHits={filteredHits}
              showMatches={showMatches}
              onToggleShowMatches={() => setShowMatches(v => !v)}
              onHitClick={handleHitClick}
            />
          )}

          {/* MSA Viewer */}
          {visibleAlignment && (
            <>
              <div ref={msaViewerContainerRef}>
                <MSAViewer
                  ref={msaViewerRef}
                  alignment={visibleAlignment}
                  onVisibleQueryChange={setSelectedSequence}
                  jobName={jobName}
                  primers={selectedPrimers}
                  flankingPrimers={selectedFlankingPrimers}
                  isDarkMode={isDarkMode}
                  navigateTarget={navigateTarget}
                  restoredRegion={restoredRegion}
                  onOligoRegionSelect={(startCol, endCol) => setOligoRegion({ startCol, endCol })}
                  onAutofindRegionSelect={(colStart, colEnd) => {
                    setNavigateTarget({ colStart, colEnd, ts: Date.now() });
                    setOligoRegion({ startCol: colStart, endCol: colEnd });
                    setAutofindRegion({ startCol: colStart, endCol: colEnd });
                  }}
                  selectedAccessions={autofindSelectedAccessions}
                  onSelectionChange={setAutofindSelectedAccessions}
                  autofindTreatIndelsAsMismatches={autofindTreatIndelsAsMismatches}
                  onAutofindTreatIndelsAsMismatchesChange={setAutofindTreatIndelsAsMismatches}
                  blastRid={blastMeta?.rid ?? ''}
                  hitRanges={hitRanges}
                />
              </div>
              {step === 'done' && selectedSequence && (
                <QueryViewer
                  key={`qv-${importNonceRef.current}`}
                  ref={queryViewerRef}
                  importedSession={importedSession}
                  data={selectedSequence}
                  jobName={jobName}
                  onPrimersUpdate={setSelectedPrimers}
                  onFlankingPrimersUpdate={setSelectedFlankingPrimers}
                  onNavigateTo={(colStart, colEnd) => {
                    setNavigateTarget({ colStart, colEnd, ts: Date.now() });
                    setRestoredRegion({ start: colStart, end: colEnd });
                  }}
                  oligoRegion={oligoRegion}
                  autofindRegion={autofindRegion}
                  idtCredentials={{
                    clientId: idtClientId,
                    clientSecret: idtClientSecret,
                    username: idtUsername,
                    password: idtPassword,
                    mgConc: parseFloat(idtMgConc) || 0,
                    region: idtRegion
                  }}
                  alignment={alignment}
                  navigateTarget={navigateTarget}
                  isDarkMode={isDarkMode}
                />
              )}
            </>
          )}
        </main>

        {showWhatsNew && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowWhatsNew(false)}>
            <div className="max-w-lg w-full max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Co je nového</h2>
                <button onClick={() => setShowWhatsNew(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">&times;</button>
              </div>
              <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
                <section>
                  <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1">MOLigo schéma a kopírovatelné sekvence</h3>
                  <p>
                    Z MOLigo provenance schématu jsme odstranili režim tvarů — nyní se vždy zobrazuje
                    pouze sekvencí režim s jednotlivými bázemi. Přímo nad tlačítkem „Proceed with the Design“
                    najdete dva boxy s finálními sekvencemi oligonukleotidů: levý oligo (reverse primer + Oligo 2)
                    a pravý oligo (Oligo 1 + TAG + forward primer). Každý box má tlačítko pro jednoduché zkopírování.
                    TAG sekvence je v pravém oligu zvýrazněna malými písmeny.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1">Sekundární struktury a ASCII stabilita</h3>
                  <p>
                    Sekce IDT analýzy se přejmenovala na „Secondary structures“ a tlačítka pro analýzu
                    nyní nesou název „Structural analysis“ / „Re-run Structural analysis“. ASCII schéma
                    sekundárních struktur se už nemění okamžitě při úpravě délky oligos — zobrazuje
                    původní analyzovanou sekvenci, dokud uživatel neklikne na „Re-run Structural analysis“.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1">Drobná vylepšení</h3>
                  <p>
                    Opravili jsme označení koncentrace Mg²⁺ na správné jednotky (mM) a doladili
                    uživatelské rozhraní pro konzistentnější pojmenování funkcí.
                  </p>
                </section>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowWhatsNew(false)}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  Rozumím
                </button>
              </div>
            </div>
          </div>
        )}

        {showPreview && pendingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={rejectPendingSession}>
            <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Restore session?</h2>
                <button onClick={rejectPendingSession} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">&times;</button>
              </div>
              <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Job name</span>
                  <span className="font-medium">{pendingSession.jobName}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Alignment length</span>
                  <span className="font-medium">{pendingSession.results.alignment.split('\n').find(l => !l.startsWith('>'))?.length ?? 0} bp</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Pinned positions</span>
                  <span className="font-medium">{pendingSession.oligo?.savedPositions.length ?? 0}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Current oligo</span>
                  <span className="font-medium">{pendingSession.oligo?.currentOligo ? 'yes' : 'no'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Saved</span>
                  <span className="font-medium">{new Date(pendingSession.savedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={rejectPendingSession}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmApplySession(pendingSession)}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  Restore
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <p>
            Oligool is developed by{' '}
            <strong className="text-slate-700 dark:text-slate-300">Mgr. Vojtěch Rejtar</strong>.
          </p>
          <p>
            Contact:{' '}
            <a href="mailto:rejtarv@gmail.com" className="text-indigo-500 hover:underline">rejtarv@gmail.com</a>
            {' | '}
            <a href="mailto:rejtarv@sci.muni.cz" className="text-indigo-500 hover:underline">rejtarv@sci.muni.cz</a>
          </p>
          <p>In case of bugs or errors, please contact the author.</p>
          <p className="pt-1">
            Licensed under the{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
              GNU General Public License v3.0
            </a>.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
