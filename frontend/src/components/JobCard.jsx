import React from 'react';
import { MapPin, Building, Calendar, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

export function JobCard({ job, onClick, isNew }) {
    // Calculate expiry status
    const isExpiringSoon = () => {
        if (!job.closing_date) return false;
        const today = new Date();
        const closeDate = new Date(job.closing_date);
        const diffTime = closeDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 3 && diffDays >= 0;
    };

    const expiring = isExpiringSoon();

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            whileHover={{ y: -5, transition: { duration: 0.2 } }}
            onClick={onClick}
            className={cn(
                "group relative overflow-hidden rounded-2xl border p-4 transition-all cursor-pointer backdrop-blur-md",
                "bg-white/5 border-white/10 hover:bg-white/10 hover:border-primary/30 hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]",
                "light:bg-white light:border-slate-200 light:hover:bg-slate-50 light:hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]",
                isNew && "ring-2 ring-emerald-500/50 border-emerald-500/30"
            )}
        >
            {/* Holographic Gradient Border Effect */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition duration-700 pointer-events-none bg-gradient-to-tr from-white/5 via-transparent to-primary/10" />

            {/* NEW Badge */}
            {isNew && (
                <div className="absolute top-3 right-3 z-10">
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-green-500 rounded-full shadow-lg animate-pulse">
                        ✨ NEW
                    </span>
                </div>
            )}

            <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-white/5 light:bg-slate-100 rounded-xl border border-white/5 light:border-slate-200 group-hover:border-primary/20 transition-colors">
                    <Building className="w-6 h-6 text-primary group-hover:text-white light:group-hover:text-primary transition-colors" />
                </div>
                {expiring && !isNew && (
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
                    </span>
                )}
            </div>

            <h3 className="text-lg font-bold text-white light:text-slate-900 mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                {job.title}
            </h3>

            <p className="text-sm text-slate-400 light:text-slate-600 font-medium mb-4 flex items-center gap-1">
                {job.company}
            </p>

            <div className="flex flex-col gap-2 text-sm text-slate-500 mb-6">
                <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                    <span>{job.location}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                    <span>
                        Closing: <span className={cn(expiring ? "text-orange-400 font-bold" : "text-slate-300 light:text-slate-700")}>
                            {job.closing_date}
                        </span>
                    </span>
                </div>
            </div>

            <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5 light:border-slate-100">
                <span className="text-xs font-mono text-slate-600 bg-black/20 light:bg-slate-200 px-2 py-1 rounded">
                    {job.source}
                </span>
                <span className="text-xs font-medium text-primary flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    View Details <ArrowRight className="w-3 h-3" />
                </span>
            </div>
        </motion.div>
    );
}
