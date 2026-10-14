import { CheckCircle2, CircleAlert, CircleX } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatSource } from '../lib/jobs';

const STATUS = {
    healthy: { label: 'Checked', icon: CheckCircle2, tone: 'text-emerald-300 light:text-emerald-700' },
    partial: { label: 'Partly checked', icon: CircleAlert, tone: 'text-amber-300 light:text-amber-700' },
    major_drop: { label: 'Showing last good data', icon: CircleAlert, tone: 'text-amber-300 light:text-amber-700' },
    failed: { label: 'Unavailable today · showing last good data', icon: CircleX, tone: 'text-rose-300 light:text-rose-700' },
};

const GROUPS = [
    { kind: 'afghanistan', title: 'Afghanistan job boards & UN/NGO portals' },
    { kind: 'remote', title: 'Remote job boards' },
];

/** Which boards the last refresh covered, so gaps are never silent. */
export function SourceStatus({ health }) {
    if (!Array.isArray(health) || health.length === 0) return null;
    return (
        <section id="sources" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 scroll-mt-20" aria-labelledby="sources-heading">
            <div className="rounded-2xl border border-white/10 light:border-slate-200 bg-white/[0.035] light:bg-white p-5 sm:p-6">
                <h2 id="sources-heading" className="text-lg font-bold text-white light:text-slate-950">Sources checked in the last refresh</h2>
                <p className="mt-1 text-sm text-slate-400 light:text-slate-600">
                    Every listing is read in full and kept only if it is a technology role. Remote roles are kept only when someone in Afghanistan can apply.
                </p>
                <div className="mt-5 grid gap-6 md:grid-cols-2">
                    {GROUPS.map(group => {
                        const items = health.filter(item => (item.kind || 'afghanistan') === group.kind);
                        if (!items.length) return null;
                        return (
                            <div key={group.kind}>
                                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 light:text-slate-600">{group.title}</h3>
                                <ul className="divide-y divide-white/5 light:divide-slate-100">
                                    {items.map(item => {
                                        const status = STATUS[item.status] || STATUS.failed;
                                        const Icon = status.icon;
                                        return (
                                            <li key={item.source} className="flex items-center justify-between gap-3 py-2 text-sm">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <Icon className={cn('h-4 w-4 shrink-0', status.tone)} aria-hidden="true" />
                                                    <span className="font-semibold text-slate-100 light:text-slate-900">{formatSource(item.source)}</span>
                                                    <span className={cn('truncate text-xs', status.tone)}>{status.label}</span>
                                                </span>
                                                <span className="shrink-0 text-xs text-slate-400 light:text-slate-600">
                                                    {Number.isFinite(item.relevant) ? `${item.relevant} tech` : ''}
                                                    {Number.isFinite(item.listed) && item.listed > 0 ? ` of ${item.listed}` : ''}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
