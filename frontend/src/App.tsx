import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MSAViewer, { type MSAViewerHandle } from './components/MSAViewer';
import QueryViewer, { type QueryViewerHandle, type ImportedSession } from './components/QueryViewer';
import BlastResults from './components/BlastResults';
import RabbitGame from './components/RabbitGame';
import UserReport from './components/UserReport';
import { downloadSession, parseSessionText, OLIGOOL_SESSION_APP, OLIGOOL_SESSION_VERSION, type OligoolSession, type FlankingPanelState, type FlankingPrimerSelection } from './utils/session';
import { parseSequenceHeader } from './utils/dna';
import { ACCENT_PRESETS, NEUTRAL_PRESETS, WALLPAPERS, applyAccentPreset, applyNeutralPreset, clearThemeOverrides, generatePalette } from './theme';

type Step = 'input' | 'blasting' | 'aligning' | 'done';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
  const [parameterSet, setParameterSet] = useState(
    () => localStorage.getItem('parameter_set') || 'mathews2004-dna'
  );
  const [searchEngine, setSearchEngine] = useState<'primer3' | 'strider'>(
    () => localStorage.getItem('search_engine') === 'strider' ? 'strider' : 'primer3'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'account' | 'engine' | 'theme'>('account');
  const [maxHitsPreset, setMaxHitsPreset] = useState(() => localStorage.getItem('max_hits_preset') || '50');
  const [customHits, setCustomHits] = useState(() => localStorage.getItem('custom_hits') || '');
  const [organism, setOrganism] = useState(() => localStorage.getItem('organism') || '');
  const [eValue, setEValue] = useState(() => localStorage.getItem('e_value') || '0.05');
  const [percIdentity, setPercIdentity] = useState(() => localStorage.getItem('perc_identity') || '0');
  const [filterMatches, setFilterMatches] = useState(() => localStorage.getItem('filter_matches') === 'true');

  const [wallpaperUrl, setWallpaperUrl] = useState(() => localStorage.getItem('wallpaper_url') || '');
  const [wallpaperOpacity, setWallpaperOpacity] = useState(() => {
    const v = localStorage.getItem('wallpaper_opacity');
    return v ? parseInt(v, 10) : 20;
  });
  const [accentPreset, setAccentPreset] = useState(() => localStorage.getItem('accent_preset') || 'teal');
  const [neutralPreset, setNeutralPreset] = useState(() => localStorage.getItem('neutral_preset') || 'zinc');
  const [customAccentColor, setCustomAccentColor] = useState(() => localStorage.getItem('custom_accent_color') || '#0d9488');
  const [customNeutralColor, setCustomNeutralColor] = useState(() => localStorage.getItem('custom_neutral_color') || '#71717a');

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
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const undoRef = useRef<(() => void) | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => { applyAccentPreset(accentPreset, customAccentColor); }, [accentPreset, customAccentColor]);
  useEffect(() => { applyNeutralPreset(neutralPreset, customNeutralColor); }, [neutralPreset, customNeutralColor]);
  useEffect(() => {
    try { localStorage.setItem('wallpaper_url', wallpaperUrl); }
    catch { localStorage.removeItem('wallpaper_url'); }
  }, [wallpaperUrl]);
  useEffect(() => { localStorage.setItem('wallpaper_opacity', String(wallpaperOpacity)); }, [wallpaperOpacity]);
  useEffect(() => { localStorage.setItem('accent_preset', accentPreset); }, [accentPreset]);
  useEffect(() => { localStorage.setItem('neutral_preset', neutralPreset); }, [neutralPreset]);
  useEffect(() => { localStorage.setItem('custom_accent_color', customAccentColor); }, [customAccentColor]);
  useEffect(() => { localStorage.setItem('custom_neutral_color', customNeutralColor); }, [customNeutralColor]);

  // Persistence hooks
  useEffect(() => { localStorage.setItem('organism', organism); }, [organism]);
  useEffect(() => { localStorage.setItem('e_value', eValue); }, [eValue]);
  useEffect(() => { localStorage.setItem('perc_identity', percIdentity); }, [percIdentity]);
  useEffect(() => { localStorage.setItem('filter_matches', filterMatches.toString()); }, [filterMatches]);
  useEffect(() => { localStorage.setItem('max_hits_preset', maxHitsPreset); }, [maxHitsPreset]);
  useEffect(() => { localStorage.setItem('custom_hits', customHits); }, [customHits]);
  useEffect(() => { localStorage.setItem('job_name', jobName); }, [jobName]);
  useEffect(() => { localStorage.setItem('idt_mg_conc', idtMgConc); }, [idtMgConc]);
  useEffect(() => { localStorage.setItem('parameter_set', parameterSet); }, [parameterSet]);
  useEffect(() => { localStorage.setItem('search_engine', searchEngine); }, [searchEngine]);
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

  const handleResetWithUndo = () => {
    const prev = {
      step, blastHits, filteredHits, showMatches, blastMeta, alignment,
      selectedSequence, error, input, genbankHeader, selectedFlankingPrimers,
      flankingPanelState, autofindSelectedAccessions, importedSession,
    };
    undoRef.current = () => {
      setStep(prev.step);
      setBlastHits(prev.blastHits);
      setFilteredHits(prev.filteredHits);
      setShowMatches(prev.showMatches);
      setBlastMeta(prev.blastMeta);
      setAlignment(prev.alignment);
      setSelectedSequence(prev.selectedSequence);
      setError(prev.error);
      setInput(prev.input);
      setGenbankHeader(prev.genbankHeader);
      setSelectedFlankingPrimers(prev.selectedFlankingPrimers);
      setFlankingPanelState(prev.flankingPanelState);
      setAutofindSelectedAccessions(prev.autofindSelectedAccessions);
      setImportedSession(prev.importedSession);
    };
    handleReset();
    setShowUndo(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setShowUndo(false);
      undoRef.current = null;
    }, 10000);
  };

  const handleUndo = () => {
    if (undoRef.current) {
      undoRef.current();
      undoRef.current = null;
    }
    setShowUndo(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    flashSessionMsg('ok', 'Restored');
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
      flashSessionMsg('err', 'Nothing to save yet. Run a search first.');
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

      // Ctrl+M: toggle MOLigo provenance schematic
      if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        const toggle = document.getElementById('moligo-provenance-toggle');
        if (toggle) {
          toggle.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toggle.click();
        }
      }

      // Ctrl+E: open/scroll to flanking primer section
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const section = document.getElementById('flanking-primers-section');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          const proceedBtn = document.getElementById('btn-proceed-design') as HTMLButtonElement | null;
          if (proceedBtn && !proceedBtn.disabled) {
            proceedBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            proceedBtn.click();
          }
        }
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
      {wallpaperUrl && (
        <div
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            backgroundImage: `url(${wallpaperUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: wallpaperOpacity / 100,
          }}
        />
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header: sticky so context stays pinned while data scrolls */}
        <header
          className="sticky top-2 z-40 mb-5 flex items-start justify-between backdrop-blur-md rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 py-3 px-4"
          style={{
            backgroundColor: hexToRgba(
              (neutralPreset === 'custom' && customNeutralColor
                ? generatePalette(customNeutralColor)
                : NEUTRAL_PRESETS[neutralPreset] || NEUTRAL_PRESETS.zinc
              )[isDarkMode ? '950' : '100'],
              0.8,
            ),
          }}
        >
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Oligool
            </h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">BLAST Search → Multiple Sequence Alignment</p>
          </div>
          <div className="flex items-center gap-4 mt-7">
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
            <div className="flex items-center gap-3">
              <div
                className="flex items-center rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden"
                role="group"
                aria-label="Session actions"
              >
                <button
                  type="button"
                  onClick={() => setShowUserReport(true)}
                  title="Create a standalone report with images and notes"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Report
                </button>
                <button
                  onClick={() => setShowWhatsNew(true)}
                  title="Kliknutím zobrazíte novinky a návod k použití"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap border-l border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
                >
                  v0.9.9 beta
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Load a saved Oligool session (.oligool.json)"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium border-l border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Load
                </button>
                {step === 'done' && alignment && (
                  <button
                    onClick={handleSaveSession}
                    title="Save this session (oligos, pinned positions, primers & alignment) to a file"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium border-l border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16v1a3 3 0 01-3 3H7a3 3 0 01-3-3v-1m4-4l4 4m0 0l4-4m-4 4V4" />
                    </svg>
                    Save
                  </button>
                )}
              </div>
              {sessionMsg && (
                <span
                  className={`text-[13px] font-medium tabular-nums ${sessionMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {sessionMsg.text}
                </span>
              )}
            </div>
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
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Settings"
              title="Settings"
              className="icon-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </header>

        {/* Settings Dialog */}
        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div
              className="card max-w-2xl w-full h-[55vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="panel-header flex items-center justify-between rounded-t-lg">
                <div className="flex items-center gap-1">
                  {([
                    ['account', 'Account'],
                    ['engine', 'Engine'],
                    ['theme', 'Theme'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSettingsTab(key)}
                      className={`px-3 py-1 text-[13px] font-medium rounded-md transition-colors ${settingsTab === key ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="icon-btn"
                  aria-label="Close settings"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="overflow-y-auto p-4">
                {settingsTab === 'account' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
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
                          <div className={`block w-8 h-4 rounded-full transition-colors ${showSecrets ? 'bg-accent-700' : 'bg-zinc-300 dark:bg-zinc-700'}`}></div>
                          <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform ${showSecrets ? 'tranzinc-x-4' : ''}`}></div>
                        </div>
                        <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
                          Show Passwords
                        </span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            NCBI Key
                          </label>
                          <input
                            type={showSecrets ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => handleApiKeyChange(e.target.value)}
                            placeholder="NCBI API key"
                            className="input text-[13px] p-2 font-mono"
                          />
                        </div>
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                          Increases BLAST rate limit (3 → 10 req/s). Get from <a href="https://www.ncbi.nlm.nih.gov/account/settings/" target="_blank" rel="noopener noreferrer" className="text-accent-700 underline">NCBI Settings</a>.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            IDT Client ID
                          </label>
                          <input
                            type={showSecrets ? "text" : "password"}
                            value={idtClientId}
                            onChange={(e) => handleIdtIdChange(e.target.value)}
                            placeholder="OligoAnalyzer Client ID"
                            className="input text-[13px] p-2 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            IDT Secret
                          </label>
                          <input
                            type={showSecrets ? "text" : "password"}
                            value={idtClientSecret}
                            onChange={(e) => handleIdtSecretChange(e.target.value)}
                            placeholder="OligoAnalyzer Client Secret"
                            className="input text-[13px] p-2 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            IDT User
                          </label>
                          <input
                            type="text"
                            value={idtUsername}
                            onChange={(e) => handleIdtUsernameChange(e.target.value)}
                            placeholder="IDT Username"
                            className="input text-[13px] p-2 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            IDT Pass
                          </label>
                          <input
                            type={showSecrets ? "text" : "password"}
                            value={idtPassword}
                            onChange={(e) => handleIdtPasswordChange(e.target.value)}
                            placeholder="IDT Account Password"
                            className="input text-[13px] p-2 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                            IDT Region
                          </label>
                          <select
                            value={idtRegion}
                            onChange={(e) => handleIdtRegionChange(e.target.value as 'us' | 'eu')}
                            className="input text-[13px] p-2 font-mono"
                          >
                            <option value="eu">EU (eu.idtdna.com)</option>
                            <option value="us">US (www.idtdna.com)</option>
                          </select>
                        </div>
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                          Required for IDT OligoAnalyzer features. Obtain from <a href="https://www.idtdna.com/pages/scitools/plus-api" target="_blank" rel="noopener noreferrer" className="text-accent-700 underline">IDT SciTools Plus API</a>. US and EU accounts use separate IDT regions.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {settingsTab === 'engine' && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Search Engine</h3>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-24">
                        Engine
                      </label>
                      <div
                        className="flex items-center rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden"
                        title="Engine for MOLigo quick search and flanking primer picking. Tm and picks follow the chosen engine's model; Primer3 is the default"
                      >
                        {([
                          ['primer3', 'Primer3'],
                          ['strider', 'Strider'],
                        ] as const).map(([value, label], idx) => (
                          <button
                            key={value}
                            onClick={() => setSearchEngine(value)}
                            className={`px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${idx > 0 ? 'border-l border-zinc-300 dark:border-zinc-700 ' : ''}${
                              searchEngine === value
                                ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200'
                                : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        Tm and oligo picks follow the selected engine's model
                      </p>
                    </div>
                  </div>
                )}
                {settingsTab === 'theme' && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Theme</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                          Wallpaper
                        </label>
                        <div className="grid grid-cols-6 sm:grid-cols-9 gap-2 mt-2">
                          <button
                            onClick={() => setWallpaperUrl('')}
                            className={`h-12 rounded-md border-2 flex items-center justify-center text-[13px] text-zinc-400 transition-colors ${!wallpaperUrl ? 'border-accent-600 dark:border-accent-300' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'}`}
                          >
                            None
                          </button>
                          {WALLPAPERS.map((wp) => (
                            <button
                              key={wp}
                              onClick={() => setWallpaperUrl(`/wallpapers/${wp}`)}
                              className={`h-12 rounded-md border-2 overflow-hidden transition-all ${wallpaperUrl === `/wallpapers/${wp}` ? 'border-accent-600 dark:border-accent-300 ring-1 ring-accent-600 dark:ring-accent-300' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'}`}
                            >
                              <img src={`/wallpapers/${wp}`} alt={wp} className="w-full h-full object-cover" loading="lazy" />
                            </button>
                          ))}
                          <label
                            className={`h-12 rounded-md border-2 flex items-center justify-center cursor-pointer transition-colors ${wallpaperUrl.startsWith('data:') ? 'border-accent-600 dark:border-accent-300' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'}`}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const url = reader.result as string;
                                  try { localStorage.setItem('wallpaper_url', url); }
                                  catch { localStorage.removeItem('wallpaper_url'); }
                                  setWallpaperUrl(url);
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                          </label>
                        </div>
                        {wallpaperUrl && (
                          <div className="flex items-center gap-3 mt-3">
                            <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-20">
                              Opacity
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={wallpaperOpacity}
                              onChange={(e) => setWallpaperOpacity(parseInt(e.target.value, 10))}
                              className="flex-1 accent-accent-600 dark:accent-accent-300"
                            />
                            <span className="text-[13px] text-zinc-500 dark:text-zinc-400 w-10 text-right tabular-nums">{wallpaperOpacity}%</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                          Accent color
                        </label>
                        <div className="flex items-center gap-2 mt-2">
                          {Object.entries(ACCENT_PRESETS).map(([name, palette]) => (
                            <button
                              key={name}
                              onClick={() => setAccentPreset(name)}
                              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${accentPreset === name ? 'border-zinc-900 dark:border-zinc-100 scale-110' : 'border-zinc-200 dark:border-zinc-700'}`}
                              style={{ backgroundColor: palette['600'] }}
                              title={name}
                            />
                          ))}
                          <label
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${accentPreset === 'custom' ? 'border-zinc-900 dark:border-zinc-100 scale-110' : 'border-zinc-200 dark:border-zinc-700'}`}
                            title="Custom color"
                          >
                            <input
                              type="color"
                              value={customAccentColor}
                              onChange={(e) => { setCustomAccentColor(e.target.value); setAccentPreset('custom'); }}
                              className="w-4 h-4 rounded-full cursor-pointer"
                              style={{ appearance: 'none', border: 'none', background: 'transparent' }}
                            />
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                          Neutral palette
                        </label>
                        <div className="flex items-center gap-2 mt-2">
                          {Object.entries(NEUTRAL_PRESETS).map(([name, palette]) => (
                            <button
                              key={name}
                              onClick={() => setNeutralPreset(name)}
                              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${neutralPreset === name ? 'border-zinc-900 dark:border-zinc-100 scale-110' : 'border-zinc-200 dark:border-zinc-700'}`}
                              style={{ backgroundColor: palette['500'] }}
                              title={name}
                            />
                          ))}
                          <label
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${neutralPreset === 'custom' ? 'border-zinc-900 dark:border-zinc-100 scale-110' : 'border-zinc-200 dark:border-zinc-700'}`}
                            title="Custom color"
                          >
                            <input
                              type="color"
                              value={customNeutralColor}
                              onChange={(e) => { setCustomNeutralColor(e.target.value); setNeutralPreset('custom'); }}
                              className="w-4 h-4 rounded-full cursor-pointer"
                              style={{ appearance: 'none', border: 'none', background: 'transparent' }}
                            />
                          </label>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setWallpaperUrl('');
                          setWallpaperOpacity(20);
                          setAccentPreset('teal');
                          setNeutralPreset('zinc');
                          setCustomAccentColor('#0d9488');
                          setCustomNeutralColor('#71717a');
                          clearThemeOverrides();
                          localStorage.removeItem('custom_accent_color');
                          localStorage.removeItem('custom_neutral_color');
                        }}
                        className="btn-secondary"
                      >
                        Reset to defaults
                      </button>
                    </div>
                  </div>
                )}
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
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors duration-250 ${isStepCurrent(s.key)
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : isStepActive(s.key)
                        ? 'bg-accent-700 text-white dark:bg-accent-300 dark:text-zinc-900'
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
                    className={`mt-1.5 text-[13px] font-medium ${isStepActive(s.key) ? 'text-accent-700 dark:text-accent-300' : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 transition-colors duration-250 ${stepOrder.indexOf(step) > idx ? 'bg-accent-700 dark:bg-accent-300' : 'bg-zinc-200 dark:bg-zinc-800'
                      }`}
                  />
                )}
              </div>
            ))}

            {/* Logo positioned to the right of the "Results" bubble */}
            <img
              src="/rabbit_oligool.png"
              alt="Oligool Logo"
              className="absolute h-32 w-auto object-contain z-10 pointer-events-none hidden lg:block opacity-90 transition-opacity duration-250 xl:left-[calc(100%+440px)] lg:left-[calc(100%+60px)] top-[-18px]"
            />

            {/* Titmouse logo positioned right next to the rabbit's left side */}
            <img
              src="/titmouse_oligool.png"
              alt="Oligool Titmouse Logo"
              className="absolute h-16 w-auto object-contain z-10 pointer-events-none hidden xl:block opacity-90 transition-opacity duration-250 xl:left-[calc(100%-150px)] top-[-27px]"
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
              <p className="mt-1 text-[13px] text-emerald-600 dark:text-emerald-400 break-all">
                Header detected. It will be used in the report: <span className="font-mono font-semibold">{queryHeader}</span>
              </p>
            )}

            <label htmlFor="genbank-header" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 mt-4">
              GenBank Header
              <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">(optional: paste the full header from GenBank)</span>
            </label>
            <textarea
              id="genbank-header"
              rows={4}
              disabled={step !== 'input'}
              className="input font-mono text-[13px] p-3"
              placeholder={"LOCUS       PD166130                 981 bp    DNA     linear   PAT 29-JAN-2025\nDEFINITION  ...\nACCESSION   ...\nVERSION     ..."}
              value={genbankHeader}
              onChange={(e) => setGenbankHeader(e.target.value)}
            />
            {/* ... filters ... */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              {/* Organism Filter */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Organism (Optional)</label>
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
                <label className="block text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">E-value Threshold</label>
                <input
                  type="number"
                  step="1e-10"
                  min="0"
                  value={eValue}
                  onChange={(e) => setEValue(e.target.value)}
                  disabled={step !== 'input'}
                  className="input px-2 py-1 text-[13px] font-mono tabular-nums"
                />
              </div>

              {/* % Identity Threshold */}
              <div>
                <label className="block text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 mb-1">% Identity Threshold</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={percIdentity}
                  onChange={(e) => setPercIdentity(e.target.value)}
                  disabled={step !== 'input'}
                  className="input px-2 py-1 text-[13px] font-mono tabular-nums"
                />
              </div>
            </div>
            {/* ... buttons ... */}
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">Max hits:</label>
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
                      className={`px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 disabled:opacity-50 ${i > 0 ? 'border-l border-zinc-300 dark:border-zinc-700' : ''
                        } ${maxHitsPreset === opt.value
                          ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200'
                          : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                        }`}
                      title={opt.value === 'custom' ? 'Custom number' : opt.value === 'all' ? 'Up to 5000' : `Top ${opt.label}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div
                  className={`overflow-hidden transition-all duration-250 ease-out flex items-center ${maxHitsPreset === 'custom' ? 'w-24 ml-2 opacity-100' : 'w-0 ml-0 opacity-0'
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
                    className="input px-2 py-1 text-[13px] font-mono tabular-nums placeholder-zinc-400 dark:placeholder-zinc-500"
                  />
                </div>
              </div>

              {/* Filter Matches Toggle */}
              <div className="flex items-center gap-2">
                <label className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">Filter matches:</label>
                <div className="flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-700">
                  <button
                    type="button"
                    onClick={() => setFilterMatches(true)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-[13px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${filterMatches ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                      }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMatches(false)}
                    disabled={step !== 'input'}
                    className={`px-2.5 py-1 text-[13px] font-medium transition-colors disabled:opacity-50 border-l border-zinc-300 dark:border-zinc-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${!filterMatches ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
                  className={`px-5 py-2 text-sm font-medium rounded-md text-white transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${step !== 'input' || !input.trim()
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
                  <span className="font-semibold text-accent-700 ml-2">
                    {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                  </span>
                </div>
                <p className="text-[13px] text-zinc-400 dark:text-zinc-500">This may take 1-2 minutes depending on sequence count. Preparing environment...</p>
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
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400"></span>
                  {(jobName && jobName !== 'Query') ? jobName : 'Search Analysis'} Completed
                </h3>
                <div className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums flex flex-wrap gap-x-4 gap-y-1">
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
                  onClick={() => setShowResetConfirm(true)}
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
                    region: idtRegion,
                    parameterSet
                  }}
                  onParameterSetChange={setParameterSet}
                  searchEngine={searchEngine}
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
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-700/10 dark:bg-accent-300/10 text-accent-700 dark:text-accent-300 text-[13px] font-bold">v0.9.9</span>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Co je nového</h2>
                </div>
                <button onClick={() => setShowWhatsNew(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 text-xl leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300">&times;</button>
              </div>
              <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Klávesové zkratky, potvrzení resetu a úspornější hlavička</h3>
                    <p>
                      Přihlašovací údaje (NCBI, IDT) jsou nyní skryté pod tlačítkem <b>Účet</b>, na obrazovce
                      je hned vidět prostor pro zadání sekvence. Tlačítko <b>Start Over</b> se nově ptá
                      na potvrzení a nabízí <b>Undo</b> (vrátit zpět) po dobu 10 sekund. Přibyly klávesové
                      zkratky: <b>Ctrl+S</b> uloží relaci, <b>Ctrl+M</b> přepne MOLigo provenance schéma,
                      <b>Ctrl+E</b> otevře nebo skroluje na sekci flanking primerů.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Přepínač Mathews / SantaLucia a přesnější sekundární struktury</h3>
                    <p>
                      Nalevo od tlačítka <b>Structural analysis</b> je nový přepínač <b>Mathews / SantaLucia</b>,
                      který vybírá parametry nejbližších sousedů pro lokální výpočet. Současně byly opraveny
                      tabulky Mathews 2004 (orientace stack klíčů, bulge a interior smyčky) a přidán __dangling__
                      stacking na koncích stemů, hairpiny, self-dimery i jejich Tm nyní sledují IDT na
                      desetiny kcal/mol, bez uměle stabilních bulgovaných struktur, které aplikace dříve
                      ukazovala. Self-dimer ΔG se nově reportuje bez duplexní iniciace, stejně jako u IDT.
                      Mg²⁺ je nadále v pokročilých parametrech. V PDF reportu jsou oddělovače nyní
                      tabulátor, bez pomlček.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path d="M9 12l2 2 4-4M10 18a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Souřadnicový tooltip v MSA přehledu</h3>
                    <p>
                      Při najetí kurzorem na BLAST hit v horním MSA přehledu se vedle kurzoru
                      objeví box se třemi čísly: pozice v MSA sloupci, pozice v celém genomu
                      a pozice v kódující oblasti (CDS). U inzercí a delecí se box rozšíří o
                      informaci o jejich délce a sekvenci. Box se chytrě přepíná na levou
                      stranu kurzoru, když jste v pravé polovině přehledu, takže nikdy nezmizí
                      z obrazovky. Zapíná a vypíná se tlačítkem <b>Coordinates</b>.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Režim Kowalski / Analýza!</h3>
                    <p>
                      Tlačítko <b>autofind</b> bylo přejmenováno na <b>Kowalski</b>. V klidovém
                      režimu (Kowalski) kliknutí na hit v MSA přehledu rovnou otevře NCBI modal
                      s genomem a CDS, nemusíte klikat na levý okraj. Po zapnutí analýzy
                      (tlačítko se změní na <b>Analysis!</b>) kliknutí vybírá hity pro autofind,
                      tedy hledání oblastí bez mismatchů, jako dříve.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0L10 8.586l2.293-2.293a1 1 0 111.414 1.414L11.414 10l2.293 2.293a1 1 0 01-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 01-1.414-1.414L8.586 10 6.293 7.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Oprava IDT prokvenance u flanking primerů</h3>
                    <p>
                      V panelu flanking primerů se nyní IDT ΔG a Tm zobrazují správně pro
                      hairpiny, dříve chyběly, protože IDT vrací hodnoty pod různými názvy
                      klíčů._backend nyní všechny varianty normalizuje. Řádky s chybějícími
                      hodnotami se čistě skrývají místo zobrazení „N/A“. ΔG i Tm hodnoty
                      (IDT i Strider) jsou zarovnané vpravo, stejně jako v MOLigo panelu.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm6.5-3a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM10 12a3 3 0 00-2.83 2h5.66A3 3 0 0010 12z" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Top-2 hairpiny a top-5 self-dimery</h3>
                    <p>
                      V panelu flanking primerů se u každého primeru zobrazuje top-5 hairpinů
                      a top-5 self-dimerů s individuální prokvenancí (IDT ΔG, Strider ΔG,
                      IDT Tm, Strider Tm) a vizualizací struktury u každého z nich. Při výběru
                      levého a pravého primeru se automaticky spočítá i heterodimer.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h3a1 1 0 100-2H7z" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Loga Kowalski v reportu a patičce</h3>
                    <p>
                      Do patičky aplikace i do reportového dialogu byla přidána loga Kowalski
                      (králík a sýkora). Report má nově také vlastní záhlaví s datem a názvem
                      úlohy.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V4z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Minimap vždy viditelná</h3>
                    <p>
                      Přehledová lišta (minimapa) v MSA přehledu je nyní trvale zapnutá,
                      tlačítko pro její skrytí bylo odstraněno. Minimapa je klíčová pro
                      orientaci v dlouhých alignementech a neměla by být skrytelná.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.083 9h1.754c.319-1.824.853-3.247 1.5-4.246A8.001 8.001 0 002 9c.083.386.197.755.339 1.108.572-.386 1.213-.69 1.744-.108zM10 2a8 8 0 100 16 8 8 0 000-16zm0 4c.99 0 1.683.763 2.072 1.5a8.46 8.46 0 01.43 1H7.498c.12-.34.265-.67.43-1C8.317 6.763 9.01 6 10 6zm-2.5 5a8.46 8.46 0 00.43 1c.389.737 1.082 1.5 2.07 1.5.988 0 1.681-.763 2.07-1.5a8.46 8.46 0 00.43-1h-5z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Oprava NCBI odkazů</h3>
                    <p>
                      Odkazy z NCBI modalu (Whole genome / Coding region) už nekončí chybou 500
                      při načtení uložené relace. Parametry <code>RID</code> a <code>blast_rank</code>
                      se přidávají pouze tehdy, když je k dispozici platné (neexpirované) BLAST RID.
                      Při obnově relace se odkazy otevírají čistě bez BLAST kontextu.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2A1 1 0 0114 8a1 1 0 01-2 0l-.073-.257H10.073L10 8a1 1 0 11-2 0l1.033-5.256A1 1 0 0110 2h2z" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Velká písmena ve flanking primerech</h3>
                    <p>
                      Sekvence flanking primerů zůstávají při přesunu nebo změně velikosti
                      vždy velkými písmeny, místo aby se náhodně přepnuly na malá.
                    </p>
                  </div>
                </section>
                <section className="flex gap-3">
                  <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-accent-700 dark:text-accent-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                  <div>
                    <h3 className="font-semibold text-accent-700 dark:text-accent-300 mb-1">Přepínač vyhledávacího enginu Primer3 / Strider</h3>
                    <p>
                      V nastavení (ozubené kolo) je nový přepínač <b>Search engine</b>:
                      <b>Primer3</b> (výchozí) nebo <b>Strider</b>. Vybraný engine řídí MOLigo
                      quick search i výběr flanking primerů: Tm a picky oligů se řídí modelem
                      vybraného enginu. Stejné číselné parametry mohou vybrat mírně odlišné oligy,
                      protože Strider čte Tm zhruba o 1–2 °C výše než Primer3. Obě Tm hodnoty
                      (Primer3 i Strider) zůstávají zobrazené vedle sebe na každé kartě. Volba
      přežije restart aplikace.
                    </p>
                  </div>
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
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Restore session?</h2>
                <button onClick={rejectPendingSession} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 text-xl leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300">&times;</button>
              </div>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <div className="flex justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Job name</span>
                  <span className="font-medium">{pendingSession.jobName}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Alignment length</span>
                  <span className="font-medium">{pendingSession.results.alignment.split('\n').find(l => !l.startsWith('>'))?.length ?? 0} bp</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  <span className="text-zinc-500">Pinned positions</span>
                  <span className="font-medium">{pendingSession.oligo?.savedPositions.length ?? 0}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
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

        {showResetConfirm && (
          <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
            <div className="card shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Are you sure?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                This will clear the current session including BLAST results, alignment, and designed primers.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleResetWithUndo();
                    setShowResetConfirm(false);
                  }}
                  className="btn-destructive px-4 py-2 text-sm"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {showUndo && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-xl">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Session reset.</span>
            <button
              onClick={handleUndo}
              className="text-sm font-medium text-accent-700 dark:text-accent-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
            >
              Undo
            </button>
          </div>
        )}

        <footer className="relative mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-center text-[13px] text-zinc-500 dark:text-zinc-400 space-y-1">
          <p>
            Oligool is developed by{' '}
            <strong className="text-zinc-700 dark:text-zinc-300">Mgr. Vojtěch Rejtar</strong>.
          </p>
          <p>
            Contact:{' '}
            <a href="mailto:rejtarv@gmail.com" className="text-accent-700 dark:text-accent-300 hover:underline">rejtarv@gmail.com</a>
            {' | '}
            <a href="mailto:rejtarv@sci.muni.cz" className="text-accent-700 dark:text-accent-300 hover:underline">rejtarv@sci.muni.cz</a>
          </p>
          <p>In case of bugs or errors, please contact the author.</p>
          <p className="pt-1">
            Licensed under the{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-accent-700 dark:text-accent-300 hover:underline">
              GNU General Public License v3.0
            </a>.
          </p>
          <img
            src="/kowalski_up_oligool.png"
            alt="Kowalski"
            className="absolute right-0 top-1/2 -translate-y-1/2 h-20 w-auto object-contain pointer-events-none hidden lg:block opacity-90"
          />
        </footer>
      </div>
    </div>
  );
}

export default App;
