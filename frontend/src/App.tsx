import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MSAViewer, { type MSAViewerHandle } from './components/MSAViewer';
import QueryViewer, { type QueryViewerHandle, type ImportedSession } from './components/QueryViewer';
import BlastResults from './components/BlastResults';
import RabbitGame from './components/RabbitGame';
import UserReport from './components/UserReport';
import { downloadSession, parseSessionText, OLIGOOL_SESSION_APP, OLIGOOL_SESSION_VERSION, type OligoolSession, type FlankingPanelState, type FlankingPrimerSelection } from './utils/session';
import { parseSequenceHeader } from './utils/dna';

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
  const [genbankHeader, setGenbankHeader] = useState('');
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
    const queryHeader = useMemo(() => parseSequenceHeader(input), [input]);

    useEffect(() => {
        if (!genbankHeader.trim() && queryHeader) setGenbankHeader(queryHeader);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryHeader]);
  const [selectedPrimers, setSelectedPrimers] = useState<{ p1: { start: number, end: number }, p2: { start: number, end: number } } | null>(null);
  const [selectedFlankingPrimers, setSelectedFlankingPrimers] = useState<FlankingPrimerSelection | null>(null);
const [flankingPanelState, setFlankingPanelState] = useState<FlankingPanelState | null>(null);
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
  const [showUserReport, setShowUserReport] = useState(false);

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
      setGenbankHeader('');
      setSelectedFlankingPrimers(null);
    setFlankingPanelState(null);
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
      search: { input, genbankHeader, organism, eValue, percIdentity, filterMatches, maxHitsPreset, customHits },
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
      flankingPanel: flankingPanelState ?? null,
    };
  }, [alignment, blastHits, filteredHits, blastMeta, showMatches, jobName, input, organism, eValue, percIdentity, filterMatches, maxHitsPreset, customHits, autofindSelectedAccessions, autofindTreatIndelsAsMismatches, selectedFlankingPrimers, selectedSequence, flankingPanelState]);

  // ── Restore a previously saved session, skipping the BLAST/MSA pipeline ──
  const applySession = useCallback((session: OligoolSession) => {
    setJobName(session.jobName || 'Query');
    setInput(session.search?.input ?? '');
    setGenbankHeader(session.search?.genbankHeader ?? '');
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
    setFlankingPanelState(session.flankingPanel ?? null);
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
    <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Oligool
            </h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">BLAST Search → Multiple Sequence Alignment</p>
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
                type="button"
                onClick={() => setShowUserReport(true)}
                title="Create a standalone report with images and notes"
                className="btn-secondary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Report
              </button>
              <button
                onClick={() => setShowWhatsNew(true)}
                title="Kliknutím zobrazíte novinky a návod k použití"
                className="btn-secondary whitespace-nowrap"
              >
                v0.9.8 beta
              </button>
              {sessionMsg && (
                <span
                  className={`text-xs font-medium tabular-nums ${sessionMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {sessionMsg.text}
                </span>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Load a saved Oligool session (.oligool.json)"
                className="btn-secondary"
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
                  className="btn-secondary"
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
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="icon-btn"
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`mt-0.5 icon-btn ${showSettings ? 'icon-btn-active' : ''}`}
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
          <div className="mb-6 card">
            <div className="panel-header flex justify-between items-center rounded-t-lg">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">API Credentials</h3>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={showSecrets}
                    onChange={(e) => setShowSecrets(e.target.checked)}
                    aria-label="Show Secrets"
                  />
                  <div className={`block w-8 h-4 rounded-full transition-colors ${showSecrets ? 'bg-teal-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform ${showSecrets ? 'tranzinc-x-4' : ''}`}></div>
                </div>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
                  Show Passwords
                </span>
              </label>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    NCBI Key
                  </label>
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="NCBI API key"
                    className="input text-xs p-2 font-mono"
                  />
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  Increases BLAST rate limit (3 → 10 req/s). Get from <a href="https://www.ncbi.nlm.nih.gov/account/settings/" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">NCBI Settings</a>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    IDT Client ID
                  </label>
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={idtClientId}
                    onChange={(e) => handleIdtIdChange(e.target.value)}
                    placeholder="OligoAnalyzer Client ID"
                    className="input text-xs p-2 font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    IDT Secret
                  </label>
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={idtClientSecret}
                    onChange={(e) => handleIdtSecretChange(e.target.value)}
                    placeholder="OligoAnalyzer Client Secret"
                    className="input text-xs p-2 font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    IDT User
                  </label>
                  <input
                    type="text"
                    value={idtUsername}
                    onChange={(e) => handleIdtUsernameChange(e.target.value)}
                    placeholder="IDT Username"
                    className="input text-xs p-2 font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    IDT Pass
                  </label>
                  <input
                    type={showSecrets ? "text" : "password"}
                    value={idtPassword}
                    onChange={(e) => handleIdtPasswordChange(e.target.value)}
                    placeholder="IDT Account Password"
                    className="input text-xs p-2 font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                    IDT Region
                  </label>
                  <select
                    value={idtRegion}
                    onChange={(e) => handleIdtRegionChange(e.target.value as 'us' | 'eu')}
                    className="input text-xs p-2 font-mono"
                  >
                    <option value="eu">EU (eu.idtdna.com)</option>
                    <option value="us">US (www.idtdna.com)</option>
                  </select>
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  Required for IDT OligoAnalyzer features. Obtain from <a href="https://www.idtdna.com/pages/scitools/plus-api" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">IDT SciTools Plus API</a>. US and EU accounts use separate IDT regions.
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
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : isStepActive(s.key)
                        ? 'bg-teal-700 text-white dark:bg-teal-300 dark:text-zinc-900'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      }`}
                  >
                    {isStepActive(s.key) && !isStepCurrent(s.key) ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : idx + 1}
                  </div>
                  <span
                    className={`mt-1.5 text-xs font-medium ${isStepActive(s.key) ? 'text-teal-700 dark:text-teal-300' : 'text-zinc-400 dark:text-zinc-600'
                      }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 transition-colors duration-300 ${stepOrder.indexOf(step) > idx ? 'bg-teal-600 dark:bg-teal-400' : 'bg-zinc-200 dark:bg-zinc-800'
                      }`}
                  />
                )}
              </div>
            ))}

            {/* Logo positioned to the right of the "Results" bubble */}
            <img
              src="/rabbit_oligool.png"
              alt="Oligool Logo"
              className={`absolute h-40 w-auto object-contain z-10 pointer-events-none hidden lg:block opacity-90 transition-all duration-500 xl:left-[calc(100%+60px)] lg:left-[calc(100%+60px)] ${step === 'done'
                ? 'top-[-12px]'
                : 'top-[-12px]'
                }`}
            />
          </div>
        </div>

        <main>
          {/* Input Area */}
          <div className={`card p-6 mb-6 ${step === 'done' ? 'hidden' : 'block'}`}>

            {/* Job Name Input */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Job Name
              </label>
              <input
                type="text"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g. My Gene Analysis"
                className="input sm:w-1/2"
              />
            </div>

            <label htmlFor="sequence" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
              Query Sequence
              <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">(FASTA or raw sequence)</span>
            </label>
            {/* ... textarea ... */}
            <textarea
              id="sequence"
              rows={8}
              disabled={step !== 'input'}
              className="input font-mono text-sm p-3"
              placeholder={">my_sequence\nATCGATCGATCGATCGATCGATCGATCG..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            {queryHeader && (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 break-all">
                Header detected — it will be used in the report: <span className="font-mono font-semibold">{queryHeader}</span>
              </p>
            )}

            <label htmlFor="genbank-header" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 mt-4">
              GenBank Header
              <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">(optional — paste the full header from GenBank)</span>
            </label>
            <textarea
              id="genbank-header"
              rows={4}
              disabled={step !== 'input'}
              className="input font-mono text-xs p-3"
              placeholder={"LOCUS       PD166130                 981 bp    DNA     linear   PAT 29-JAN-2025\nDEFINITION  ...\nACCESSION   ...\nVERSION     ..."}
              value={genbankHeader}
              onChange={(e) => setGenbankHeader(e.target.value)}
            />
            {/* ... filters ... */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
              {/* Organism Filter */}
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Organism (Optional)</label>
                <input
                  type="text"
                  value={organism}
                  onChange={(e) => setOrganism(e.target.value)}
                  disabled={step !== 'input'}
                  placeholder="e.g. human, mouse, txid9606"
                  className="input placeholder-zinc-400 dark:placeholder-zinc-500"
                />
              </div>

              {/* E-value Threshold */}
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">E-value Threshold</label>
                <input
                  type="number"
                  step="1e-10"
                  min="0"
                  value={eValue}
                  onChange={(e) => setEValue(e.target.value)}
                  disabled={step !== 'input'}
                  className="input"
                />
              </div>

              {/* % Identity Threshold */}
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">% Identity Threshold</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={percIdentity}
                  onChange={(e) => setPercIdentity(e.target.value)}
                  disabled={step !== 'input'}
                  className="input"
                />
              </div>
            </div>
            {/* ... buttons ... */}
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Max hits:</label>
                <div className="flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-700">
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
                      className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${i > 0 ? 'border-l border-zinc-300 dark:border-zinc-700' : ''
                        } ${maxHitsPreset === opt.value
                          ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200'
                          : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
                    className="input px-2 py-1 text-xs font-mono placeholder-zinc-400 dark:placeholder-zinc-500"
                  />
                </div>
              </div>

              {/* Filter Matches Toggle */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Filter matches:</label>
                <div className="flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setFilterMatches(true)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${filterMatches ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                      }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMatches(false)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 border-l border-zinc-300 dark:border-zinc-700 ${!filterMatches ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    Reset
                  </button>
                )}
                {step === 'input' && blastHits.length > 0 && (
                  <button
                    onClick={() => setStep('done')}
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    Go Back
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={step !== 'input' || !input.trim()}
                  className={`px-5 py-2 text-sm font-medium rounded-md text-white transition-colors ${step !== 'input' || !input.trim()
                    ? 'bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                    : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'
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
                <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400 font-mono text-sm">
                  <div className="w-5 h-5 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-700 dark:border-t-zinc-300 rounded-full animate-spin"></div>
                  {step === 'blasting' ? 'Running BLAST search and collecting homologs...' : 'Finalizing MAFFT alignment...'}
                  <span className="font-semibold text-teal-700 ml-2">
                    {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                  </span>
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">This may take 1-2 minutes depending on sequence count. Preparing environment...</p>
              </div>

              <div><RabbitGame /></div>

              {/* MSA Viewer Blueprint */}
              <div className="card overflow-hidden opacity-60 pointer-events-none animate-pulse duration-1000">
                <div className="h-14 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800/50 flex items-center px-4 gap-4">
                  <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                  <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                </div>
                <div className="h-10 border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-800/50 flex items-center px-4">
                  <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded opacity-50"></div>
                </div>
                <div className="p-4 space-y-3 bg-white dark:bg-zinc-900">
                  <div className="flex gap-4"><div className="w-24 h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div><div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div><div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div><div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div><div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800/50 rounded"></div></div>
                  <div className="flex gap-4"><div className="w-24 h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div><div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800/50 rounded"></div></div>
                </div>
              </div>

              {/* Provenance Blueprint */}
              <div className="card overflow-hidden opacity-40 mt-6 pointer-events-none">
                <div className="h-14 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800/50 px-5 flex items-center justify-between">
                  <div className="h-5 w-48 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                  <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                </div>
                <div className="p-5 flex flex-col md:flex-row gap-6">
                  <div className="flex-1 space-y-4">
                    <div className="h-32 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-800/50"></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="h-12 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-800/50"></div>
                      <div className="h-12 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-800/50"></div>
                    </div>
                  </div>
                  <div className="w-full md:w-64 space-y-4">
                    <div className="h-40 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-800/50"></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 p-4 mb-6">
              <div className="flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600 dark:text-red-400 mr-3 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Error</h3>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Results Summary & Actions */}
          {step === 'done' && blastMeta && (
            <div className="mb-6 card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  {(jobName && jobName !== 'Query') ? jobName : 'Search Analysis'} Completed
                </h3>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums flex flex-wrap gap-x-4 gap-y-1">
                  <span>RID: <span className="text-zinc-700 dark:text-zinc-300">{blastMeta.rid}</span></span>
                  <span>Len: <span className="text-zinc-700 dark:text-zinc-300">{blastMeta.query_len} bp</span></span>
                  <span>Hits: <span className="text-zinc-700 dark:text-zinc-300">{blastHits.length}</span></span>
                  <span>Time: <span className="text-zinc-700 dark:text-zinc-300">~{blastMeta.rtoe}s</span></span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('input')}
                  className="btn-secondary"
                >
                  Edit Search
                </button>
                <button
                  onClick={handleReset}
                  className="btn-destructive"
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
                  queryHeader={queryHeader}
                  genbankHeader={genbankHeader}
                  onGenbankHeaderChange={setGenbankHeader}
                  onPrimersUpdate={setSelectedPrimers}
                  onFlankingPrimersUpdate={setSelectedFlankingPrimers}
                  flankingPanelState={flankingPanelState}
                  onFlankingPanelStateChange={setFlankingPanelState}
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
                  onSaveSession={handleSaveSession}
                />
              )}
            </>
          )}
        </main>

        {showUserReport && (
          <UserReport
            open={showUserReport}
            onClose={() => setShowUserReport(false)}
            defaultSequence={input}
            jobName={jobName}
          />
        )}

        {showWhatsNew && (
          <div className="modal-overlay" onClick={() => setShowWhatsNew(false)}>
            <div className="card shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">Co je nového</h2>
                <button onClick={() => setShowWhatsNew(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none">&times;</button>
              </div>
              <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Samostatné instalátory</h3>
                  <p>
                    Oligool se nově šíří jako samostatný instalátor pro Windows a macOS a jako
                    balíček pro Linux. Instalace obsahuje vše potřebné – Python, backend, MAFFT
                    i sestavené rozhraní – takže na počítači nemusí být nic nainstalované.
                    Na Windows stačí spustit průvodce instalací, na macOS otevřít balíček .pkg.
                    Instalátory najdete na stránce Releases v repozitáři na GitHubu.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Nový MSA přehled na kotvové mřížce</h3>
                  <p>
                    MSA prohlížeč je přepracovaný na kotvovou mřížku: query sekvence tvoří
                    souvislý řádek a ostatní řádky se na ni kotví. Inzerce v hit sekvencích
                    označuje modrá svislá čára; u delších inzercí ji doprovází vodorovné čárky
                    pouze vpravo, tedy tam, kde by vložená sekvence ležela. Značky mismatchů,
                    delecí a inzercí v horní liště i v minimapě mají nově výšku přesně jednoho
                    řádku, takže nikdy nepřesahují mimo pruh své sekvence.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Barva pruhů Sequence / Match</h3>
                  <p>
                    Kliknutím na barevný čtvereček vedle popisku „Sequence / Match“ v legendě
                    MSA přehledu přepnete pruhy sekvencí mezi šedou a bílou. Přepnutí se projeví
                    v horní liště, v minimapě i v hlavním zobrazení pruhů.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Nový vzhled aplikace</h3>
                  <p>
                    Aplikace přešla na jednotný design systém: typografie IBM Plex (Sans pro
                    text, Mono pro sekvence), barevná paleta zinc a sdílené tokeny pro tlačítka,
                    panely a modální okna ve všech částech aplikace. Specifikace je v souboru
                    frontend/DESIGN.md.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Opravy struktur a dimerů</h3>
                  <p>
                    Pokud IDT nevrátí strukturu, použije se lokální dot-bracket ze Strider.
                    Dimery jsou v reportu vykreslené jako ASCII se svislými vazbami, stejně jako
                    v panelu oligo, a dimer SVG má opravené prohozené popisky 3′/5′ konců.
                    IDT analýzy uchovávají strukturální pole a kandidáty s IDT daty se řadí před
                    strider-only výsledky. Strider dimer ΔG je přepočtené na 25 °C, aby bylo
                    srovnatelné s ostatními enginy.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Viditelnost indelů v MSA přehledu</h3>
                  <p>
                    V horní MSA liště a v minimapě jsou nyní indely (inzerce/delece) viditelné
                    jako fialové pruhy vedle červených mismatchů. Indely se vykreslují ve třech
                    průchodech (základní pruhy → mismatchy → indely nahoře), takže nejsou překryty
                    dalšími sekvencemi. Každý indel má minimální výšku 3 px, aby zůstal viditelný
                    i při stovkách sekvencí, a zároveň respektuje Y pozici řádku (indel v řádcích
                    80–90 označí pouze tento úsek, ne celou lištu).
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Tm hodnoty v reportu</h3>
                  <p>
                    MOLigo 1 a 2 v reportu nyní zobrazují Tm řádek se všemi třemi hodnotami
                    (Primer3, Strider, IDT) vedle sebe, stejně jako flanking primery. Opraveno
                    čtení IDT Tm — funkce nyní kontroluje 7 variant názvu klíče v IDT odpovědi
                    (IDT_Tm, Tm, MeltingTemperature, …), takže IDT Tm již nezobrazuje N/A.
                    V panelu flanking primerů je IDT Tm nyní běžná buňka v gridu vedle P3 a
                    Strider, místo odlišného fialového badge.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Čistší layout reportu</h3>
                  <p>
                    Z reportu jsme odstranili duplicitní pairwise sekci („Moligo 1 with Moligo 2
                    pairwise“) — ponechali jsme pouze tu v „Secondary structure predictions“.
                    Sekce „Universal primers“ (fwd/rev) byla odstraněna. Flanking primery jsou
                    nyní rozděleny na tři podsekce: Forward, Reverse a třetí s názvem
                    „FwdName × RevName“ s heterodimerem a amplicon length. Názvy primerů
                    se používají místo generických „Primer1/Primer2“. TAG sekvence v reportu
                    zachovává původní velikost písmen (nepřevádí na malá).
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Tlačítko Save dole</h3>
                  <p>
                    Vedle tlačítka „Create a report“ v pravém dolním rohu je nyní k dispozici
                    tlačítko Save, takže relaci uložíte bez nutnosti scrollovat nahoru.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Přepracovaný design reportu (PDF/TXT)</h3>
                  <p>
                    Report má nově horní záhlaví s menším názvem, datem a vlastním GenBank headerem vloženým
                    přímo na vstupní stránce. Sekce MOLigo 1 a 2 jsou kompaktnější a jsou chráněny proti
                    rozdělení stránkou. Primery se zobrazují vedle sebe, ΔG hodnoty jsou tučně a v tabulátorovém
                    rozložení. Heterodimer M1×M2 je přejmenován na „Moligo 1 with Moligo 2 pairwise“ včetně
                    SVG struktury. TAG ukazuje číslo z role (např. A018) místo délky.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">MOLigo schéma a kopírovatelné sekvence</h3>
                  <p>
                    Z MOLigo provenance schématu jsme odstranili režim tvarů — nyní se vždy zobrazuje
                    pouze sekvencí režim s jednotlivými bázemi. Přímo nad tlačítkem „Proceed with the Design“
                    najdete dva boxy s finálními sekvencemi oligonukleotidů: levý oligo (reverse primer + Oligo 2)
                    a pravý oligo (Oligo 1 + TAG + forward primer). Každý box má tlačítko pro jednoduché zkopírování.
                    TAG sekvence je v pravém oligu zvýrazněna malými písmeny.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Sekundární struktury a ASCII stabilita</h3>
                  <p>
                    Sekce IDT analýzy se přejmenovala na „Secondary structures“ a tlačítka pro analýzu
                    nyní nesou název „Structural analysis“ / „Re-run Structural analysis“. ASCII schéma
                    sekundárních struktur se už nemění okamžitě při úpravě délky oligos — zobrazuje
                    původní analyzovanou sekvenci, dokud uživatel neklikne na „Re-run Structural analysis“.
                  </p>
                </section>
                <section>
                  <h3 className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Drobná vylepšení</h3>
                  <p>
                    Opravili jsme označení koncentrace Mg²⁺ na správné jednotky (mM) a doladili
                    uživatelské rozhraní pro konzistentnější pojmenování funkcí.
                  </p>
                </section>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowWhatsNew(false)}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Rozumím
                </button>
              </div>
            </div>
          </div>
        )}

        {showPreview && pendingSession && (
          <div className="modal-overlay" onClick={rejectPendingSession}>
            <div className="card shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">Restore session?</h2>
                <button onClick={rejectPendingSession} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none">&times;</button>
              </div>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Job name</span>
                  <span className="font-medium">{pendingSession.jobName}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Alignment length</span>
                  <span className="font-medium">{pendingSession.results.alignment.split('\n').find(l => !l.startsWith('>'))?.length ?? 0} bp</span>
                </div>
                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Pinned positions</span>
                  <span className="font-medium">{pendingSession.oligo?.savedPositions.length ?? 0}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Current oligo</span>
                  <span className="font-medium">{pendingSession.oligo?.currentOligo ? 'yes' : 'no'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Saved</span>
                  <span className="font-medium">{new Date(pendingSession.savedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={rejectPendingSession}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmApplySession(pendingSession)}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Restore
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
          <p>
            Oligool is developed by{' '}
            <strong className="text-zinc-700 dark:text-zinc-300">Mgr. Vojtěch Rejtar</strong>.
          </p>
          <p>
            Contact:{' '}
            <a href="mailto:rejtarv@gmail.com" className="text-teal-700 dark:text-teal-300 hover:underline">rejtarv@gmail.com</a>
            {' | '}
            <a href="mailto:rejtarv@sci.muni.cz" className="text-teal-700 dark:text-teal-300 hover:underline">rejtarv@sci.muni.cz</a>
          </p>
          <p>In case of bugs or errors, please contact the author.</p>
          <p className="pt-1">
            Licensed under the{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-teal-700 dark:text-teal-300 hover:underline">
              GNU General Public License v3.0
            </a>.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
