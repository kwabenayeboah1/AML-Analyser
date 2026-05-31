/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  FileText, 
  Download, 
  Plus, 
  Trash2, 
  Search, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  Table as TableIcon,
  LayoutDashboard,
  Clock,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { analyzeCourtCase, type SICCode, type AnalysisResult } from './services/analysisService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Default SIC codes for demonstration
const DEFAULT_SIC_CODES: SICCode[] = [
  { code: '0100', description: 'Agricultural Production - Crops' },
  { code: '1000', description: 'Metal Mining' },
  { code: '1520', description: 'General Contractors-Residential Buildings' },
  { code: '2000', description: 'Food and Kindred Products' },
  { code: '2834', description: 'Pharmaceutical Preparations' },
  { code: '3571', description: 'Electronic Computers' },
  { code: '4813', description: 'Telephone Communications, Except Radiotelephone' },
  { code: '6021', description: 'National Commercial Banks' },
  { code: '7372', description: 'Prepackaged Software' },
  { code: '8011', description: 'Offices and Clinics of Doctors of Medicine' },
];

const STORAGE_KEYS = {
  SIC_CODES: 'legal_sic_matcher_codes',
  RESULTS: 'legal_sic_matcher_results'
};

export default function App() {
  const [view, setView] = useState<'dashboard' | 'table'>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Initialize state from Local Storage
  const [sicCodes, setSicCodes] = useState<SICCode[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SIC_CODES);
    return saved ? JSON.parse(saved) : DEFAULT_SIC_CODES;
  });
  
  const [results, setResults] = useState<AnalysisResult[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RESULTS);
    return saved ? JSON.parse(saved) : [];
  });

  const [newSic, setNewSic] = useState({ code: '', description: '' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dailyRequests, setDailyRequests] = useState(() => {
    const saved = localStorage.getItem('gemini_daily_requests');
    const lastReset = localStorage.getItem('gemini_last_reset');
    const today = new Date().toDateString();
    
    if (lastReset !== today) {
      localStorage.setItem('gemini_last_reset', today);
      localStorage.setItem('gemini_daily_requests', '0');
      return 0;
    }
    return saved ? parseInt(saved) : 0;
  });
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [analysisPhase, setAnalysisPhase] = useState<'idle' | 'reading' | 'uploading' | 'reasoning' | 'generating'>('idle');
  const [streamedText, setStreamedText] = useState('');
  const [countdown, setCountdown] = useState<{ current: number, total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const cancelRef = React.useRef(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Persist state to Local Storage
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIC_CODES, JSON.stringify(sicCodes));
  }, [sicCodes]);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(results));
  }, [results]);

  // Auto-sync quota bar if a quota error is detected
  React.useEffect(() => {
    if (error && error.toLowerCase().includes('daily quota reached')) {
      // Only force to 50 if we are sure it's a daily limit
      // We'll trust the API message more now
    }
  }, [error]);

  const resetQuota = () => {
    setDailyRequests(0);
    localStorage.setItem('gemini_daily_requests', '0');
    setError(null);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...acceptedFiles]);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
    },
    multiple: true
  });

  const handleAddSic = () => {
    if (newSic.code && newSic.description) {
      // Prevent duplicates
      if (sicCodes.some(s => s.code === newSic.code)) {
        setError(`SIC Code ${newSic.code} already exists.`);
        return;
      }
      setSicCodes([...sicCodes, { ...newSic }]);
      setNewSic({ code: '', description: '' });
      setError(null);
    }
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newCodes: SICCode[] = [];
      
      // Basic CSV parsing (skipping header)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Handle comma or semicolon separators
        const parts = line.split(/[;,]/);
        if (parts.length >= 2) {
          const code = parts[0].trim().replace(/^["']|["']$/g, '');
          const description = parts[1].trim().replace(/^["']|["']$/g, '');
          
          // Deduplicate within the import itself
          if (!newCodes.some(c => c.code === code)) {
            newCodes.push({ code, description });
          }
        }
      }

      if (newCodes.length > 0) {
        setSicCodes(prev => {
          const existingCodes = new Set(prev.map(s => s.code));
          const uniqueNew = newCodes.filter(c => !existingCodes.has(c.code));
          return [...prev, ...uniqueNew];
        });
        setError(null);
      } else {
        setError("No new or unique SIC codes found in the CSV.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const handleRemoveSic = (code: string) => {
    setSicCodes(sicCodes.filter(s => s.code !== code));
  };

  // Sort and deduplicate SIC codes numerically
  const sortedSicCodes = useMemo(() => {
    // Deduplicate by code
    const uniqueMap = new Map<string, SICCode>();
    sicCodes.forEach(s => {
      if (!uniqueMap.has(s.code)) {
        uniqueMap.set(s.code, s);
      }
    });
    
    return Array.from(uniqueMap.values()).sort((a, b) => {
      const aNum = parseInt(a.code.replace(/\D/g, ''), 10) || 0;
      const bNum = parseInt(b.code.replace(/\D/g, ''), 10) || 0;
      return aNum - bNum;
    });
  }, [sicCodes]);

  const filteredResults = useMemo(() => {
    if (!searchQuery) return results;
    const query = searchQuery.toLowerCase();
    return results.filter(res => 
      res.caseName.toLowerCase().includes(query) || 
      res.caseReference.toLowerCase().includes(query) ||
      res.jurisdiction.toLowerCase().includes(query) ||
      res.summary.toLowerCase().includes(query)
    );
  }, [results, searchQuery]);

  const runAnalysis = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsAnalyzing(true);
    setError(null);
    cancelRef.current = false;
    setAnalysisProgress({ current: 0, total: selectedFiles.length });
    
    const newResults: AnalysisResult[] = [];
    
    for (let i = 0; i < selectedFiles.length; i++) {
      if (cancelRef.current) break;
      
      const file = selectedFiles[i];
      setAnalysisProgress({ current: i + 1, total: selectedFiles.length });
      setCountdown(null);
      setStatusMessage(`Preparing "${file.name}"...`);
      
      // Granular Throttling: Lengthy documents consume more tokens and need more time for the TPM bucket to refill
      let baseWaitTime = 25; 
      let typeMsg = "Waiting";
      
      if (file.size > 1000000) { // > 1MB
        baseWaitTime = 150;
        typeMsg = "Huge document (>1MB) detected. Significant cooldown required";
      } else if (file.size > 500000) { // > 500KB
        baseWaitTime = 90;
        typeMsg = "Large document (>500KB) detected. Extended cooldown required";
      } else if (file.size > 200000) { // > 200KB
        baseWaitTime = 45;
        typeMsg = "Medium document detected. Cooldown required";
      }

      if (i > 0) {
        setCountdown({ current: baseWaitTime, total: baseWaitTime });
        for (let seconds = baseWaitTime; seconds > 0; seconds--) {
          if (cancelRef.current) break;
          setCountdown({ current: seconds, total: baseWaitTime });
          setStatusMessage(`${typeMsg}: ${seconds}s remaining to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (cancelRef.current) break;
        setCountdown(null);
        setStatusMessage(`Resuming analysis with "${file.name}"...`);
      }
      
      try {
        let result: AnalysisResult;
        setStreamedText('');
        
        const retryHandler = (msg: string) => {
          if (cancelRef.current) {
            // This is tricky because we can't easily abort the fetch from here
            // but we can at least stop updating the UI
            return;
          }
          setStatusMessage(msg);
        };

        if (file.type === 'application/pdf') {
          setAnalysisPhase('reading');
          setStatusMessage(`Reading PDF: "${file.name}"...`);
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
          });
          reader.readAsDataURL(file);
          const base64Data = await base64Promise;
          
          if (cancelRef.current) break;

          setAnalysisPhase('uploading');
          setStatusMessage(`Uploading to Gemini: "${file.name}"...`);
          
          // We'll set to reasoning after a short delay to simulate the upload/start
          setTimeout(() => {
            if (!cancelRef.current) setAnalysisPhase('reasoning');
          }, 1000);

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          result = await analyzeCourtCase('', sortedSicCodes, {
            data: base64Data,
            mimeType: 'application/pdf',
            fileName: file.name
          }, (chunk) => {
            if (!cancelRef.current) {
              setAnalysisPhase('generating');
              setStreamedText(prev => prev + chunk);
            }
          }, retryHandler, abortController.signal);
        } else {
          setAnalysisPhase('reading');
          setStatusMessage(`Reading Text: "${file.name}"...`);
          const text = await file.text();
          
          if (cancelRef.current) break;

          setAnalysisPhase('uploading');
          setStatusMessage(`Sending to Gemini: "${file.name}"...`);
          setTimeout(() => {
            if (!cancelRef.current) setAnalysisPhase('reasoning');
          }, 500);

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          result = await analyzeCourtCase(text, sortedSicCodes, {
            data: '',
            mimeType: 'text/plain',
            fileName: file.name
          }, (chunk) => {
            if (!cancelRef.current) {
              setAnalysisPhase('generating');
              setStreamedText(prev => prev + chunk);
            }
          }, retryHandler, abortController.signal);
        }
        
        if (cancelRef.current) break;

        setAnalysisPhase('idle');
        setStreamedText('');
        setStatusMessage(`Success: "${file.name}" analyzed.`);
        newResults.push(result);
        
        // Update daily quota
        setDailyRequests(prev => {
          const next = prev + 1;
          localStorage.setItem('gemini_daily_requests', next.toString());
          return next;
        });
      } catch (err: any) {
        if (cancelRef.current) break;
        console.error(`Error analyzing ${file.name}:`, err);
        
        setAnalysisPhase('idle');
        setStreamedText('');

        // Check for quota error in various formats
        const isQuotaError = 
          err?.status === 'RESOURCE_EXHAUSTED' || 
          err?.error?.status === 'RESOURCE_EXHAUSTED' ||
          err?.message?.includes('RESOURCE_EXHAUSTED') ||
          err?.message?.includes('429') ||
          err?.message?.toLowerCase().includes('quota');

        let msg = `Error analyzing "${file.name}": ${err.message || 'Internal error'}.`;
        
        if (isQuotaError) {
          // The Gemini API returns different messages for RPM vs RPD
          // Daily: "User has exceeded quota for the day"
          // Minute: "Resource has been exhausted (e.g. check quota)"
          const isDaily = err?.message?.toLowerCase().includes('exceeded quota') && 
                         (err?.message?.toLowerCase().includes('day') || err?.message?.toLowerCase().includes('daily'));
          
          if (isDaily) {
            msg = `Daily Quota Reached: The Google API reports you have hit your daily limit for the "Pro" model. You can try switching to "Fast Scan" (Flash) which has a much higher daily limit.`;
            setDailyRequests(50); 
            localStorage.setItem('gemini_daily_requests', '50');
          } else {
            msg = `Rate Limit Reached (429): You are sending requests too quickly for the "Pro" model. Switch to "Fast Scan" for higher throughput, or wait 1-2 minutes.`;
          }
        }
        
        setError(msg);
        if (isQuotaError) break;
      }
    }
    
    setResults(prev => [...newResults, ...prev]);
    setSelectedFiles([]);
    setIsAnalyzing(false);
    setStatusMessage(cancelRef.current ? "Analysis cancelled." : null);
    setAnalysisPhase('idle');
    setCountdown(null);
  };

  const exportToExcel = (resultsToExport: AnalysisResult[] = results) => {
    if (resultsToExport.length === 0) return;

    const data = resultsToExport.flatMap(res => 
      res.matches.map(match => ({
        'Case Name': res.caseName,
        'Case Reference': res.caseReference,
        'Jurisdiction': res.jurisdiction,
        'Summary': res.summary,
        'Money Laundering Status': res.moneyLaunderingStatus,
        'ML Confidence (%)': res.moneyLaunderingConfidence,
        'ML Reasoning': res.moneyLaunderingReasoning,
        'Additional Insights': res.additionalInsights.join('; '),
        'SIC Code': match.sicCode,
        'Description': match.description,
        'Industry Context': match.industryContext,
        'SIC Match Confidence (%)': match.confidence,
        'Is Best Fit': match.sicCode === [...res.matches].sort((a, b) => b.confidence - a.confidence)[0]?.sicCode ? 'YES' : 'NO',
        'Reasoning': match.reasoning
      }))
    );

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SIC Analysis");
    XLSX.writeFile(wb, resultsToExport.length === results.length ? "Court_Case_SIC_Analysis_All.xlsx" : "Court_Case_SIC_Analysis_Selected.xlsx");
  };

  const toggleSelectResult = (caseRef: string) => {
    const newSelected = new Set(selectedResults);
    if (newSelected.has(caseRef)) {
      newSelected.delete(caseRef);
    } else {
      newSelected.add(caseRef);
    }
    setSelectedResults(newSelected);
  };

  const toggleSelectAll = (currentResults: AnalysisResult[]) => {
    const allRefs = currentResults.map(r => r.caseReference);
    const areAllSelected = allRefs.every(ref => selectedResults.has(ref));
    
    const newSelected = new Set(selectedResults);
    if (areAllSelected) {
      allRefs.forEach(ref => newSelected.delete(ref));
    } else {
      allRefs.forEach(ref => newSelected.add(ref));
    }
    setSelectedResults(newSelected);
  };

  const renderMlStatus = (status: AnalysisResult['moneyLaunderingStatus'], confidence?: number) => {
    // Safety: If AI returns a probability (0-1) instead of percentage (0-100)
    const displayConfidence = confidence !== undefined 
      ? (confidence <= 1 && confidence > 0 ? Math.round(confidence * 100) : Math.round(confidence))
      : undefined;

    const confidenceBadge = displayConfidence !== undefined && (
      <span className="ml-2 text-[10px] opacity-60 font-mono">({displayConfidence}%)</span>
    );

    switch (status) {
      case 'Confirmed':
        return (
          <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Confirmed ML {confidenceBadge}
          </span>
        );
      case 'Alleged':
        return (
          <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Alleged ML {confidenceBadge}
          </span>
        );
      case 'Discussed/Precedent':
        return (
          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
            <Search className="w-3 h-3" />
            Discussed/Precedent {confidenceBadge}
          </span>
        );
      default:
        return (
          <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
            No ML Detected {confidenceBadge}
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#141414] font-sans">
      {/* Navigation */}
      <nav className="border-b border-[#141414]/10 bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Legal SIC Matcher</h1>
          </div>
          
          <div className="flex items-center gap-1 bg-[#F5F5F4] p-1 rounded-xl">
            <button 
              onClick={() => setView('dashboard')}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                view === 'dashboard' ? "bg-white shadow-sm text-[#141414]" : "text-[#141414]/50 hover:text-[#141414]"
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Analyze
            </button>
            <button 
              onClick={() => setView('table')}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                view === 'table' ? "bg-white shadow-sm text-[#141414]" : "text-[#141414]/50 hover:text-[#141414]"
              )}
            >
              <TableIcon className="w-4 h-4" />
              History
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {view === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Input */}
            <div className="lg:col-span-5 space-y-8">
              {/* File Upload */}
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-[#141414]/5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#141414]/40 mb-4">1. Ingest Court Case</h2>
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-4",
                    isDragActive ? "border-[#141414] bg-[#141414]/5" : "border-[#141414]/10 hover:border-[#141414]/30"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-12 h-12 bg-[#F5F5F4] rounded-full flex items-center justify-center">
                    <Upload className="w-6 h-6 text-[#141414]/60" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {selectedFiles.length > 0 
                        ? `${selectedFiles.length} file(s) selected` 
                        : "Drop court case documents here"}
                    </p>
                    <p className="text-sm text-[#141414]/50 mt-1">
                      PDF or TXT files supported (Batch upload enabled)
                    </p>
                  </div>
                </div>
                
                {/* Quota Indicator */}
                <div className="mt-6 pt-6 border-t border-[#141414]/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/40">Est. Daily Usage</span>
                      <button 
                        onClick={resetQuota}
                        className="text-[9px] bg-[#141414]/5 text-[#141414]/40 px-1.5 py-0.5 rounded hover:bg-[#141414] hover:text-white transition-all font-bold uppercase"
                        title="Reset counter if it seems out of sync"
                      >
                        Reset
                      </button>
                      {dailyRequests < 50 && (
                        <button 
                          onClick={() => {
                            setDailyRequests(50);
                            localStorage.setItem('gemini_daily_requests', '50');
                          }}
                          className="text-[9px] bg-[#141414]/5 text-[#141414]/40 px-1.5 py-0.5 rounded hover:bg-red-100 hover:text-red-600 transition-all font-bold uppercase"
                          title="Click to manually sync if you hit the API limit"
                        >
                          Sync Limit
                        </button>
                      )}
                    </div>
                    <span className={dailyRequests >= 45 ? "text-[10px] font-mono text-red-500 font-bold" : "text-[10px] font-mono opacity-60"}>
                      {dailyRequests} / 50*
                    </span>
                  </div>
                  <div className="h-1 w-full bg-[#141414]/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(dailyRequests / 50) * 100}%` }}
                      className={`h-full transition-all ${dailyRequests >= 45 ? 'bg-red-500' : 'bg-[#141414]'}`}
                    />
                  </div>
                  <p className="text-[9px] text-[#141414]/30 mt-2 leading-tight italic">
                    *Estimate only. The Gemini 3.1 Pro free tier has a strict daily limit enforced by Google.
                  </p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-[#F5F5F4] px-3 py-1.5 rounded-lg text-xs">
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate max-w-[180px] font-medium">{file.name}</span>
                            {file.size > 500000 && (
                              <span className="flex items-center gap-1 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase">
                                <Clock className="w-2.5 h-2.5" />
                                Large
                              </span>
                            )}
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    
                    {selectedFiles.some(f => f.size > 500000) && (
                      <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded-lg flex items-start gap-1.5">
                        <Clock className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>One or more large files detected. These will require a 60s wait between scans to stay within rate limits.</span>
                      </p>
                    )}
                    
                    {isAnalyzing ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full bg-[#141414] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                      >
                        <div className="flex flex-col items-center gap-3 w-full px-4">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span className="text-sm">Analyzing ({analysisProgress.current}/{analysisProgress.total})</span>
                            </div>
                            {statusMessage && (
                              <span className="text-[10px] font-mono opacity-60 animate-pulse text-center">
                                {statusMessage}
                              </span>
                            )}
                          </div>
                          
                          <div className="w-full space-y-2">
                            {/* Overall Progress */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-[9px] uppercase font-bold tracking-wider opacity-40">
                                <span>Batch Progress</span>
                                <span>{Math.round((analysisProgress.current / analysisProgress.total) * 100)}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                                  className="h-full bg-white"
                                />
                              </div>
                            </div>

                            {/* Granular Phase Progress */}
                            {analysisPhase !== 'idle' && !countdown && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[9px] uppercase font-bold tracking-wider opacity-40">
                                  <span>
                                    {analysisPhase === 'reading' ? 'Reading File' : 
                                     analysisPhase === 'uploading' ? 'Uploading' : 
                                     analysisPhase === 'reasoning' ? 'AI Reasoning' : 'Generating Results'}
                                  </span>
                                  <span>
                                    {analysisPhase === 'reading' ? '25%' : 
                                     analysisPhase === 'uploading' ? '50%' : 
                                     analysisPhase === 'reasoning' ? '75%' : '95%'}
                                  </span>
                                </div>
                                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ 
                                      width: analysisPhase === 'reading' ? '25%' : 
                                             analysisPhase === 'uploading' ? '50%' : 
                                             analysisPhase === 'reasoning' ? '75%' : '95%' 
                                    }}
                                    transition={{ type: "spring", stiffness: 30 }}
                                    className="h-full bg-emerald-400"
                                  />
                                </div>
                              </div>
                            )}

                            {streamedText && (
                              <div className="w-full mt-1 p-2 bg-white/5 rounded-lg border border-white/10 overflow-hidden">
                                <p className="text-[8px] font-mono text-white/40 line-clamp-2 text-left leading-tight">
                                  {streamedText}
                                </p>
                              </div>
                            )}

                            {/* Countdown Progress (if waiting) */}
                            {countdown && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[9px] uppercase font-bold tracking-wider opacity-40">
                                  <span>Rate Limit Cooldown</span>
                                  <span>{countdown.current}s</span>
                                </div>
                                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: "100%" }}
                                    animate={{ width: `${(countdown.current / countdown.total) * 100}%` }}
                                    transition={{ ease: "linear", duration: 1 }}
                                    className="h-full bg-amber-400"
                                  />
                                </div>
                              </div>
                            )}

                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRef.current = true;
                                if (abortControllerRef.current) {
                                  abortControllerRef.current.abort();
                                }
                              }}
                              className="w-full mt-2 py-2 bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                              <XCircle className="w-3 h-3" />
                              Cancel Analysis
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={runAnalysis}
                        className="w-full bg-[#141414] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#141414]/90 transition-all"
                      >
                        <Search className="w-5 h-5" />
                        Analyze {selectedFiles.length} Case{selectedFiles.length > 1 ? 's' : ''}
                      </motion.button>
                    )}
                  </div>
                )}
                
                {error && (
                  <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                    <button 
                      onClick={() => setError(null)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </section>

              {/* SIC Code Management */}
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-[#141414]/5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[#141414]/40">2. Target SIC Codes</h2>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold flex items-center gap-1 px-2 py-1 bg-[#141414] text-white rounded-md cursor-pointer hover:bg-[#141414]/80 transition-all">
                      <Upload className="w-3 h-3" />
                      Import CSV
                      <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                    </label>
                    {confirmReset ? (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setSicCodes(DEFAULT_SIC_CODES);
                            setConfirmReset(false);
                          }}
                          className="text-[10px] font-bold px-2 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-all"
                        >
                          Confirm
                        </button>
                        <button 
                          onClick={() => setConfirmReset(false)}
                          className="text-[10px] font-bold px-2 py-1 bg-[#F5F5F4] rounded-md text-[#141414]/40"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setConfirmReset(true)}
                        className="text-xs font-bold px-2 py-1 bg-[#F5F5F4] rounded-md text-[#141414]/40 hover:text-red-500 transition-all"
                      >
                        Reset
                      </button>
                    )}
                    <span className="text-xs font-medium px-2 py-1 bg-[#F5F5F4] rounded-md text-[#141414]/60">
                      {sicCodes.length} Codes
                    </span>
                  </div>
                </div>
                
                <div className="space-y-3 mb-6 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {sortedSicCodes.map((sic) => (
                    <div key={sic.code} className="flex items-center justify-between p-3 bg-[#F5F5F4] rounded-xl group">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold font-mono text-[#141414]/40">{sic.code}</span>
                        <span className="text-sm font-medium leading-tight">{sic.description}</span>
                      </div>
                      <button 
                        onClick={() => handleRemoveSic(sic.code)}
                        className="p-2 text-[#141414]/20 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <input 
                    type="text" 
                    placeholder="Code"
                    value={newSic.code}
                    onChange={(e) => setNewSic({ ...newSic, code: e.target.value })}
                    className="col-span-3 bg-[#F5F5F4] border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#141414]/10 transition-all font-mono"
                  />
                  <input 
                    type="text" 
                    placeholder="Industry Description"
                    value={newSic.description}
                    onChange={(e) => setNewSic({ ...newSic, description: e.target.value })}
                    className="col-span-7 bg-[#F5F5F4] border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#141414]/10 transition-all"
                  />
                  <button 
                    onClick={handleAddSic}
                    className="col-span-2 bg-[#141414] text-white rounded-lg flex items-center justify-center hover:bg-[#141414]/90 transition-all"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </section>
            </div>

            {/* Right Column: Results */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#141414]/40">Analysis Results</h2>
                <div className="flex items-center gap-4">
                  {results.length > 0 && (
                    <button 
                      onClick={() => toggleSelectAll(results)}
                      className="text-xs font-bold text-[#141414]/60 hover:text-[#141414] transition-all"
                    >
                      {results.every(r => selectedResults.has(r.caseReference)) ? "Deselect All" : "Select All"}
                    </button>
                  )}
                  {selectedResults.size > 0 && (
                    <button 
                      onClick={() => exportToExcel(results.filter(r => selectedResults.has(r.caseReference)))}
                      className="text-sm font-bold flex items-center gap-2 text-emerald-600 hover:opacity-70 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Export Selected ({selectedResults.size})
                    </button>
                  )}
                  {results.length > 0 && (
                    <button 
                      onClick={() => exportToExcel(results)}
                      className="text-sm font-bold flex items-center gap-2 text-[#141414] hover:opacity-70 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Export All
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                {results.length === 0 ? (
                  <div className="bg-white rounded-2xl p-12 border border-[#141414]/5 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-[#F5F5F4] rounded-full flex items-center justify-center mb-4">
                      <Search className="w-8 h-8 text-[#141414]/20" />
                    </div>
                    <p className="text-[#141414]/40 font-medium">No analyses performed yet.<br/>Upload a case to begin.</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {results.map((res, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#141414]/5"
                      >
                        <div className="p-6 border-b border-[#141414]/5 bg-[#141414]/[0.02]">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1">
                              <div className="mt-1.5">
                                <input 
                                  type="checkbox"
                                  checked={selectedResults.has(res.caseReference)}
                                  onChange={() => toggleSelectResult(res.caseReference)}
                                  className="w-4 h-4 rounded border-[#141414]/20 text-[#141414] focus:ring-[#141414]/10 cursor-pointer"
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex flex-col gap-1 mb-2">
                                  <div className="flex items-center gap-3">
                                    <h3 className="font-bold text-xl">{res.caseName}</h3>
                                    {renderMlStatus(res.moneyLaunderingStatus, res.moneyLaunderingConfidence)}
                                  </div>
                                  <span className="text-xs font-mono text-[#141414]/40">{res.caseReference}</span>
                                  <span className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest">{res.jurisdiction}</span>
                                </div>
                                <p className="text-sm text-[#141414]/60 leading-relaxed">{res.summary}</p>
                                {res.moneyLaunderingStatus !== 'None' && (
                                  <div className={cn(
                                    "mt-3 p-3 border rounded-xl text-xs italic",
                                    res.moneyLaunderingStatus === 'Confirmed' ? "bg-red-50/50 border-red-100 text-red-800" :
                                    res.moneyLaunderingStatus === 'Alleged' ? "bg-orange-50/50 border-orange-100 text-orange-800" :
                                    "bg-blue-50/50 border-blue-100 text-blue-800"
                                  )}>
                                    <strong>ML Analysis ({res.moneyLaunderingStatus}):</strong> {res.moneyLaunderingReasoning}
                                  </div>
                                )}
                                
                                {res.additionalInsights && res.additionalInsights.length > 0 && (
                                  <div className="mt-4 space-y-2">
                                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/30">Key Legal & Financial Insights</h4>
                                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {res.additionalInsights.map((insight, iIdx) => (
                                        <li key={iIdx} className="flex items-start gap-2 text-xs text-[#141414]/70 bg-[#F5F5F4] p-2 rounded-lg">
                                          <div className="w-1.5 h-1.5 bg-[#141414]/20 rounded-full mt-1.5 shrink-0" />
                                          {insight}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Analyzed
                            </div>
                          </div>
                        </div>
                        
                        <div className="p-6 space-y-4">
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/30">Matched SIC Categories</h4>
                          <div className="grid gap-3">
                            {res.matches.sort((a, b) => b.confidence - a.confidence).map((match, mIdx) => {
                              const isBestFit = mIdx === 0;
                              return (
                                <div 
                                  key={mIdx} 
                                  className={cn(
                                    "p-4 rounded-xl border transition-all relative",
                                    isBestFit ? "border-[#141414] bg-[#141414]/[0.01]" : "border-[#141414]/5 hover:border-[#141414]/10"
                                  )}
                                >
                                  {isBestFit && (
                                    <div className="absolute top-0 right-6 -translate-y-1/2 bg-[#141414] text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                      Best Fit
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-sm font-bold bg-[#F5F5F4] px-2 py-0.5 rounded text-[#141414]/60">{match.sicCode}</span>
                                      <span className="font-bold text-sm">{match.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="w-24 h-1.5 bg-[#F5F5F4] rounded-full overflow-hidden">
                                        <div 
                                          className="h-full bg-[#141414] transition-all duration-1000" 
                                          style={{ width: `${match.confidence <= 1 && match.confidence > 0 ? match.confidence * 100 : match.confidence}%` }}
                                        />
                                      </div>
                                      <span className="text-xs font-bold w-10 text-right">
                                        {match.confidence <= 1 && match.confidence > 0 ? Math.round(match.confidence * 100) : Math.round(match.confidence)}%
                                      </span>
                                    </div>
                                  </div>
                                  <div className="mb-3 p-2 bg-[#F5F5F4]/50 rounded-lg border border-[#141414]/5">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/30 mb-1">Industry Context</p>
                                    <p className="text-xs text-[#141414]/70 leading-relaxed">{match.industryContext}</p>
                                  </div>
                                  <p className="text-sm text-[#141414]/60 italic leading-relaxed">
                                    &ldquo;{match.reasoning}&rdquo;
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Table View / History */
          <div className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 overflow-hidden">
            <div className="p-6 border-b border-[#141414]/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1">
                <h2 className="font-bold text-lg whitespace-nowrap">Analysis History</h2>
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/30" />
                  <input 
                    type="text" 
                    placeholder="Search by case name, reference, or jurisdiction..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#F5F5F4] border-none rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-[#141414]/10 transition-all"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedResults.size > 0 && (
                  <button 
                    onClick={() => exportToExcel(results.filter(r => selectedResults.has(r.caseReference)))}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Export Selected ({selectedResults.size})
                  </button>
                )}
                {confirmClear ? (
                  <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100">
                    <span className="text-[10px] font-bold text-red-600 px-2 uppercase tracking-tight">Are you sure?</span>
                    <button 
                      onClick={() => {
                        setResults([]);
                        setConfirmClear(false);
                        localStorage.removeItem(STORAGE_KEYS.RESULTS);
                      }}
                      className="text-[10px] font-bold bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition-all"
                    >
                      Yes, Clear
                    </button>
                    <button 
                      onClick={() => setConfirmClear(false)}
                      className="text-[10px] font-bold text-[#141414]/40 hover:text-[#141414] px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setConfirmClear(true)}
                    disabled={results.length === 0}
                    className="text-sm font-bold text-[#141414]/40 hover:text-red-500 transition-all disabled:opacity-0"
                  >
                    Clear History
                  </button>
                )}
                <button 
                  onClick={() => exportToExcel()}
                  disabled={results.length === 0}
                  className="bg-[#141414] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#141414]/90 transition-all disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Export All to Excel
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F4]">
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 w-10">
                      <input 
                        type="checkbox"
                        checked={filteredResults.length > 0 && filteredResults.every(r => selectedResults.has(r.caseReference))}
                        onChange={() => toggleSelectAll(filteredResults)}
                        className="w-4 h-4 rounded border-[#141414]/20 text-[#141414] focus:ring-[#141414]/10 cursor-pointer"
                      />
                    </th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Case Name</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Reference</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Jurisdiction</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Money Laundering</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">ML Conf.</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Top Match</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Confidence</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">Matches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-[#141414]/40 font-medium">
                        {searchQuery ? "No results match your search." : "No history found."}
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((res, idx) => {
                      const topMatch = res.matches.sort((a, b) => b.confidence - a.confidence)[0];
                      return (
                        <tr key={idx} className={cn("hover:bg-[#F5F5F4]/50 transition-colors", selectedResults.has(res.caseReference) && "bg-[#141414]/[0.02]")}>
                          <td className="px-6 py-4">
                            <input 
                              type="checkbox"
                              checked={selectedResults.has(res.caseReference)}
                              onChange={() => toggleSelectResult(res.caseReference)}
                              className="w-4 h-4 rounded border-[#141414]/20 text-[#141414] focus:ring-[#141414]/10 cursor-pointer"
                            />
                          </td>
                          <td className="px-6 py-4 font-bold text-sm">{res.caseName}</td>
                          <td className="px-6 py-4 font-mono text-xs text-[#141414]/50">{res.caseReference}</td>
                          <td className="px-6 py-4 text-xs font-medium text-[#141414]/60">{res.jurisdiction}</td>
                          <td className="px-6 py-4">
                            {renderMlStatus(res.moneyLaunderingStatus, res.moneyLaunderingConfidence)}
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold">
                              {res.moneyLaunderingConfidence !== undefined 
                                ? `${res.moneyLaunderingConfidence <= 1 && res.moneyLaunderingConfidence > 0 ? Math.round(res.moneyLaunderingConfidence * 100) : Math.round(res.moneyLaunderingConfidence)}%` 
                                : 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs bg-[#F5F5F4] px-1.5 py-0.5 rounded">{topMatch?.sicCode}</span>
                              <span className="text-xs font-medium">{topMatch?.description}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold">
                              {topMatch?.confidence !== undefined
                                ? `${topMatch.confidence <= 1 && topMatch.confidence > 0 ? Math.round(topMatch.confidence * 100) : Math.round(topMatch.confidence)}%`
                                : 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs bg-[#141414]/5 px-2 py-1 rounded-full font-bold">
                              {res.matches.length}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(20, 20, 20, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(20, 20, 20, 0.2);
        }
      `}} />
    </div>
  );
}
