import React from 'react';
import { X, Building, MapPin, Calendar, ExternalLink, Mail, Briefcase, Copy, Info } from 'lucide-react';
import { motion } from 'framer-motion';

export function JobDetails({ job, onClose }) {
    if (!job) return null;

    // Extract Reference Number (flexible match)
    const getReference = () => {
        if (!job.details) return null;
        const key = Object.keys(job.details).find(k => k.toLowerCase().includes('reference'));
        return key ? job.details[key] : null;
    };

    const refNo = getReference();
    const subjectLine = `Application for ${job.title} - ${refNo || 'Job Application'}`;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-dark/80 light:bg-slate-900/60 backdrop-blur-sm"
            />

            <motion.div
                initial={{ opacity: 0, y: "100%" }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="relative w-full sm:w-[95%] max-w-4xl h-[90vh] sm:h-auto sm:max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-dark/95 light:bg-white border-t sm:border border-white/10 light:border-slate-200 shadow-2xl scrollbar-hide"
                onClick={(e) => e.stopPropagation()}
            >

                {/* Header */}
                <div className="sticky top-0 z-10 flex items-start justify-between p-5 sm:p-6 bg-dark/95 light:bg-white/95 backdrop-blur-xl border-b border-white/5 light:border-slate-100">
                    <div className="pr-8">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 light:bg-slate-100 text-slate-300 light:text-slate-600 border border-white/5 light:border-slate-200">
                                {refNo || 'NO REF'}
                            </span>
                            {job.scraped_at && (
                                <span className="text-[10px] text-slate-500">
                                    Updated: {job.scraped_at.split('T')[0]}
                                </span>
                            )}
                        </div>
                        <h2 className="text-xl sm:text-3xl font-bold text-white light:text-slate-900 mb-2 leading-tight">
                            {job.title}
                        </h2>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-400 light:text-slate-500">
                            <div className="flex items-center gap-1.5">
                                <Building className="w-4 h-4 text-primary" />
                                {job.company}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-secondary" />
                                {job.location}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-orange-400" />
                                Closing: <span className="text-slate-200 light:text-slate-900">{job.closing_date}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 bg-white/5 light:bg-slate-100 hover:bg-white/10 light:hover:bg-slate-200 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 sm:p-8 space-y-6">

                    {/* Application Guide Card */}
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                            <div className="flex-1 space-y-3">
                                <h3 className="text-sm font-bold text-white light:text-slate-900 uppercase tracking-wider">How to Apply</h3>
                                <p className="text-sm text-slate-400 light:text-slate-600">
                                    Please send your CV to the email below using the exact subject line.
                                </p>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    {/* Reference / Subject */}
                                    <div className="bg-dark/50 light:bg-slate-50 rounded-lg p-3 border border-white/5 light:border-slate-100">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Subject Line</span>
                                        <div className="flex items-center gap-2 text-white light:text-slate-900 font-mono text-xs sm:text-sm break-all">
                                            {subjectLine}
                                        </div>
                                    </div>
                                    {/* Email */}
                                    <div className="bg-dark/50 light:bg-slate-50 rounded-lg p-3 border border-white/5 light:border-slate-100">
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Send To</span>
                                        <div className="text-white light:text-slate-900 font-mono text-xs sm:text-sm">
                                            {job.apply_emails?.[0] || 'See description'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Apply Buttons */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        {job.apply_emails && job.apply_emails.length > 0 && job.apply_emails.map(email => (
                            <a
                                key={email}
                                href={`mailto:${email}?subject=${encodeURIComponent(subjectLine)}`}
                                className="flex-1 order-1 sm:order-2 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-emerald-500/25 animate-pulse-subtle ring-1 ring-emerald-400/50"
                                title={`Send email with subject: ${subjectLine}`}
                            >
                                <Mail className="w-5 h-5 fill-current" />
                                Apply via Email
                            </a>
                        ))}

                        {job.apply_url && (
                            <a
                                href={job.apply_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 order-2 sm:order-1 flex items-center justify-center gap-2 bg-white/5 light:bg-slate-100 hover:bg-white/10 light:hover:bg-slate-200 text-white light:text-slate-900 font-semibold py-4 px-6 rounded-xl border border-white/10 light:border-slate-200 transition-all"
                            >
                                View on Website <ExternalLink className="w-5 h-5" />
                            </a>
                        )}
                    </div>

                    {/* One-Liner Details */}
                    <div className="grid grid-cols-2 gap-4 sm:gap-6 p-4 sm:p-6 bg-white/5 light:bg-slate-50 rounded-2xl border border-white/5 light:border-slate-100">
                        {job.details && Object.entries(job.details).map(([key, value]) => (
                            <div key={key} className="flex flex-col">
                                <span className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-medium mb-1">{key}</span>
                                <span className="text-sm sm:text-base text-slate-200 light:text-slate-900 font-medium">{value}</span>
                            </div>
                        ))}
                    </div>

                    {/* Description */}
                    <div className="prose prose-invert light:prose-slate max-w-none pb-8">
                        <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-white light:text-slate-900 mb-4 transition-all duration-300">
                            <Briefcase className="w-5 h-5 text-primary" />
                            Job Description
                        </h3>
                        <div className="text-slate-300 light:text-slate-700 leading-relaxed whitespace-pre-wrap text-sm sm:text-base transition-all duration-300">
                            {job.description || "No description available."}
                        </div>
                    </div>
                </div>

            </motion.div>
        </div>
    );
}
