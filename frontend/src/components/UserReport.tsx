import { useState, useEffect, useRef, useCallback } from 'react';

interface UserReportProps {
    open: boolean;
    onClose: () => void;
    /** Pre-fill the sequence field from the current query input. */
    defaultSequence: string;
    /** Job name used for the saved filename. */
    jobName: string;
}

interface ReportImage {
    id: string;
    dataUrl: string;
    name: string;
}

/** Build a filesystem-safe filename like `My_Gene_report_20260801.html`. */
function buildReportFilename(jobName: string): string {
    const safe = (jobName || 'oligool')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'oligool';
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `${safe}_report_${stamp}.html`;
}

/** Escape HTML special characters so user text/sequence can't break the saved HTML. */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Build a self-contained HTML report embedding images as base64 data URLs. */
function buildReportHtml(opts: {
    jobName: string;
    sequence: string;
    notes: string;
    images: ReportImage[];
}): string {
    const { jobName, sequence, notes, images } = opts;
    const now = new Date().toLocaleString();
    const safeJob = escapeHtml(jobName || 'Oligool Report');
    const safeDate = escapeHtml(now);

    const imgTags = images
        .map(
            (img, i) =>
                `<figure><img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" /><figcaption>Image ${i + 1}: ${escapeHtml(img.name)}</figcaption></figure>`
        )
        .join('\n');

    // Render sequence line-by-line in a <pre> so FASTA structure is preserved
    const seqBlock = sequence.trim()
        ? `<pre class="seq">${escapeHtml(sequence)}</pre>`
        : '<p class="muted">No sequence provided.</p>';

    const notesBlock = notes.trim()
        ? `<div class="notes">${escapeHtml(notes).replace(/\n/g, '<br>')}</div>`
        : '<p class="muted">No notes provided.</p>';

    const imagesBlock = images.length
        ? `<section><h2>Images (${images.length})</h2>${imgTags}</section>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeJob}: Oligool Report</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    color: #18181b;
    background: #f4f4f5;
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 24px;
  }
  header { border-bottom: 2px solid #18181b; padding-bottom: 16px; margin-bottom: 24px; }
  header h1 { font-size: 22px; margin: 0 0 4px; color: #18181b; letter-spacing: -0.01em; }
  header .meta { font-size: 13px; color: #71717a; }
  section { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e4e4e7; }
  .seq {
    font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
    background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px; padding: 12px;
    margin: 0;
  }
  .notes { font-size: 14px; white-space: normal; }
  .muted { color: #a1a1aa; font-style: italic; font-size: 14px; }
  figure { margin: 0 0 16px; text-align: center; }
  figure:last-child { margin-bottom: 0; }
  figure img { max-width: 100%; height: auto; border: 1px solid #e4e4e7; border-radius: 6px; }
  figcaption { font-size: 12px; color: #71717a; margin-top: 6px; }
  footer { text-align: center; font-size: 12px; color: #a1a1aa; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e4e4e7; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #f4f4f5; }
    header { border-color: #f4f4f5; }
    header h1 { color: #f4f4f5; }
    header .meta { color: #a1a1aa; }
    section { background: #18181b; border-color: #27272a; }
    h2 { color: #a1a1aa; border-color: #27272a; }
    .seq { background: #222226; border-color: #27272a; }
    .muted { color: #71717a; }
    figure img { border-color: #27272a; }
    figcaption { color: #71717a; }
    footer { color: #71717a; border-color: #27272a; }
  }
</style>
</head>
<body>
  <header>
    <h1>${safeJob}</h1>
    <div class="meta">Oligool Report · ${safeDate}</div>
  </header>

  <section>
    <h2>Sequence</h2>
    ${seqBlock}
  </section>

  <section>
    <h2>Notes</h2>
    ${notesBlock}
  </section>

  ${imagesBlock}

  <footer>Generated by Oligool</footer>
</body>
</html>`;
}

/** Trigger a browser download of the report as a self-contained HTML file. */
function downloadReportHtml(html: string, jobName: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildReportFilename(jobName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function UserReport({ open, onClose, defaultSequence, jobName }: UserReportProps) {
    const [sequence, setSequence] = useState(defaultSequence);
    const [notes, setNotes] = useState('');
    const [images, setImages] = useState<ReportImage[]>([]);
    const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [sending, setSending] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);

    // Sync the sequence field when the modal opens (so it picks up the latest query input)
    useEffect(() => {
        if (open) {
            setSequence(defaultSequence);
        }
    }, [open, defaultSequence]);

    // Clear state when the modal closes
    useEffect(() => {
        if (!open) {
            setNotes('');
            setImages([]);
            setStatus(null);
        }
    }, [open]);

    const addImageFromFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            setImages((prev) => [
                ...prev,
                { id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, name: file.name || `image-${prev.length + 1}` },
            ]);
        };
        reader.readAsDataURL(file);
    }, []);

    // Paste handler: capture images from the clipboard anywhere in the modal
    useEffect(() => {
        if (!open) return;
        const onPaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            let captured = 0;
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) {
                        addImageFromFile(file);
                        captured += 1;
                    }
                }
            }
            if (captured > 0) {
                e.preventDefault();
                setStatus({ kind: 'ok', text: `${captured} image${captured > 1 ? 's' : ''} pasted.` });
                setTimeout(() => setStatus(null), 2500);
            }
        };
        // Attach to the modal container so it captures paste while focused
        const node = modalRef.current;
        if (node) {
            node.addEventListener('paste', onPaste);
            return () => node.removeEventListener('paste', onPaste);
        }
    }, [open, addImageFromFile]);

    const removeImage = useCallback((id: string) => {
        setImages((prev) => prev.filter((img) => img.id !== id));
    }, []);

    const handleSave = useCallback(() => {
        if (!sequence.trim() && !notes.trim() && images.length === 0) {
            setStatus({ kind: 'err', text: 'Nothing to save. Add a sequence, notes, or images first.' });
            return;
        }
        try {
            const html = buildReportHtml({ jobName, sequence, notes, images });
            downloadReportHtml(html, jobName);
            setStatus({ kind: 'ok', text: 'Report saved.' });
            setTimeout(() => {
                setStatus(null);
                onClose();
            }, 1200);
        } catch (e) {
            setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to save report.' });
        }
    }, [sequence, notes, images, jobName, onClose]);

    const handleSendToMe = useCallback(async () => {
        if (!sequence.trim() && !notes.trim() && images.length === 0) {
            setStatus({ kind: 'err', text: 'Nothing to send. Add a sequence, notes, or images first.' });
            return;
        }
        setSending(true);
        setStatus(null);
        try {
            const html = buildReportHtml({ jobName, sequence, notes, images });
            const response = await fetch(((import.meta.env.VITE_API_BASE as string) || '') + '/api/report/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_name: jobName, html }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.detail || `Failed to send (${response.status}).`);
            }
            setStatus({ kind: 'ok', text: 'Report emailed.' });
        } catch (e) {
            setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to send report.' });
        } finally {
            setSending(false);
        }
    }, [sequence, notes, images, jobName]);

    // Close on Escape
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
        }
    };

    if (!open) return null;

    return (
        <div
            className="modal-overlay"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-report-title"
        >
            <div
                ref={modalRef}
                onKeyDown={handleKeyDown}
                tabIndex={-1}
                className="card shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto outline-none"
            >
                {/* Header */}
                <div className="flex justify-between items-start px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 rounded-t-lg z-10">
                    <div>
                        <h3 id="user-report-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Report</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Paste images, write notes, and save a standalone report.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1 -mr-2 -mt-1"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5">
                    {/* Sequence */}
                    <div>
                        <label htmlFor="report-sequence" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Sequence
                            <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">(FASTA or raw nucleotides)</span>
                        </label>
                        <textarea
                            id="report-sequence"
                            rows={5}
                            value={sequence}
                            onChange={(e) => setSequence(e.target.value)}
                            placeholder={"ATCGATCGATCG... or >my_sequence\\nATCG..."}
                            className="input font-mono text-xs resize-y"
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label htmlFor="report-notes" className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Notes
                        </label>
                        <textarea
                            id="report-notes"
                            rows={4}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Write observations, experimental conditions, sample IDs…"
                            className="input text-sm resize-y"
                        />
                    </div>

                    {/* Images */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                                Images
                                {images.length > 0 && (
                                    <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">({images.length})</span>
                                )}
                            </label>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="btn-secondary"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Add file
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    const files = e.target.files;
                                    if (files) {
                                        for (const f of Array.from(files)) addImageFromFile(f);
                                    }
                                    e.target.value = '';
                                }}
                            />
                        </div>
                        {/* Paste zone */}
                        <div className="rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900/30 px-4 py-3 text-center">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Paste an image here with <kbd className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-mono text-[10px]">Ctrl/⌘ + V</kbd>
                                {images.length === 0 && ' or use "Add file" above.'}
                            </p>
                        </div>
                        {/* Thumbnails */}
                        {images.length > 0 && (
                            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {images.map((img) => (
                                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900">
                                        <img src={img.dataUrl} alt={img.name} className="w-full h-28 object-contain" />
                                        <button
                                            type="button"
                                            onClick={() => removeImage(img.id)}
                                            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                            aria-label={`Remove ${img.name}`}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate px-1.5 py-1 bg-white dark:bg-zinc-800">{img.name}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Status */}
                    {status && (
                        <p className={`text-xs font-medium ${status.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {status.text}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-3 sticky bottom-0 bg-white dark:bg-zinc-900 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="btn-secondary px-4 py-2 text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSendToMe}
                        disabled={sending}
                        className="btn-secondary px-4 py-2 text-sm disabled:opacity-60"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {sending ? 'Sending…' : 'Send to me'}
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn-primary px-4 py-2 text-sm"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save report
                    </button>
                </div>
            </div>
        </div>
    );
}
