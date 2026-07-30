import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FlankingPrimersPanel from './FlankingPrimersPanel';

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const RAW = 'ACGT'.repeat(50);

const primer = (seq: string) => ({
    sequence: seq,
    length: seq.length,
    interval: [0, seq.length] as [number, number],
    tm: 60, tm_strider: 59, gc_percent: 50,
    primer3: { tm: 60, gc_percent: 50, self_any: null, self_end: null, hairpin_th: null },
    hairpin: { structure_found: false, tm: null, dg: null },
    homodimer: { structure_found: false, tm: null, dg: null },
});

const restoredState = {
    params: { flankWindow: 200, optSize: 20, minSize: 18, maxSize: 25, optTm: 60, minTm: 57, maxTm: 63, minGc: 30, maxGc: 80, numReturn: 5, mvConc: 50, dvConc: 3, dntpConc: 0.8, dnaConc: 250 },
    showAdv: false,
    manual: { leftStart: null, leftEnd: null, rightStart: null, rightEnd: null },
    result: null,
    selFwd: primer('CGATCGATTTTTCCCCAAAA'),
    selRev: primer('GGGGAAAACCCCTTTTGGGG'),
    fwdName: 'F', revName: 'R',
    idtResultsIndiv: {},
    pairIdtResults: null,
};

const creds = () => ({ clientId: 'c', clientSecret: 's', username: 'u', password: 'p', region: 'eu' as const });

describe('FlankingPrimersPanel pair analysis', () => {
    let analyzeCalls = 0;
    let pairLog: { p1: string; p2: string }[] = [];

    beforeEach(() => {
        analyzeCalls = 0;
        pairLog = [];
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/idt/analyze')) {
                const body = init?.body ? JSON.parse(String(init.body)) : {};
                if (body.p2_seq && body.p2_seq !== 'A') {
                    analyzeCalls++; // pair analysis only (individual calls use p2_seq "A")
                    pairLog.push({ p1: body.p1_seq, p2: body.p2_seq });
                }
            }
            return {
                ok: true,
                json: async () => url.includes('/idt/token')
                    ? { access_token: 'tok' }
                    : { m1: { hairpin: {}, self_dimer: {}, analyze: {} }, m2: { hairpin: {}, self_dimer: {}, analyze: {} }, pairwise: {} },
            } as Response;
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not re-fire IDT pair analysis when props are re-created with identical contents', async () => {
        const props = {
            rawSeq: RAW,
            oligoStart: 60, oligoEnd: 120,
            p1Start: 60, p1End: 90, p2Start: 90, p2End: 120,
        };

        const view = render(
            <FlankingPrimersPanel
                {...props}
                idtCredentials={creds()}
                idtAdvancedParams={{ mg_conc: 10, mv_conc: 50, dntp_conc: 0.8, oligo_conc: 0.25 }}
                restoredState={restoredState as never}
            />
        );

        // Let the initial auto-analysis round-trip settle.
        await vi.waitFor(() => expect(analyzeCalls).toBe(1), { timeout: 5000 });
        // PROBE 1: no further renders — count must stay 1 for 1.5s (no self-sustaining loop).
        await new Promise(r => setTimeout(r, 1500));
        const settled = analyzeCalls;
        if (settled !== 1) console.log('PROBE1 drift without rerenders:', settled, JSON.stringify(pairLog));
        expect(settled).toBe(1);

        // Re-render 5 times, each time with a BRAND NEW credentials object identity
        // (this mirrors App.tsx passing an inline literal).
        for (let i = 0; i < 5; i++) {
            view.rerender(
                <FlankingPrimersPanel
                    {...props}
                    idtCredentials={creds()}
                    idtAdvancedParams={{ mg_conc: 10, mv_conc: 50, dntp_conc: 0.8, oligo_conc: 0.25 }}
                    restoredState={restoredState as never}
                />
            );
            await new Promise(r => setTimeout(r, 250));
        }

        if (analyzeCalls !== 1) console.log('PAIR CALLS:', JSON.stringify(pairLog));
        expect(analyzeCalls).toBe(1);
    }, 20000);
});
