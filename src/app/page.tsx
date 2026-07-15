'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

import { auth, googleProvider, facebookProvider, twitterProvider } from './utils/firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';

const StockChart = dynamic(() => import('./components/StockCharts'), { 
  ssr: false,
  loading: () => <div className="h-[350px] w-full bg-[#090d16] animate-pulse rounded-2xl border border-slate-900 flex items-center justify-center font-mono text-xs text-slate-600">Loading canvas engine layers...</div>
});

interface IndexData { price: number; change: number; }
interface StockData {
  ticker: string;
  metrics: { current_rsi: number; ema_gap_pct: number; daily_return_pct: number; volume_ratio: number; day_high: number; prev_close: number; };
  analysis: { upward_trend_probability: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; };
  candle_history: Array<{ time: string; open: number; high: number; low: number; close: number; }>;
  growth_rates: { revenue_yoy: string; profit_yoy: string; eps_growth: string; operating_margin: string; };
  quarterly_results: Array<{ quarter: string; revenue: string; net_profit: string; eps: string; }>;
  shareholding: { promoters: string; fii: string; dii: string; public: string; };
  dividends: { dividend_yield: string; payout_ratio: string; history: Array<{ type: string; amount: string; ex_date: string; }>; };
  dvm_score?: { durability: number; valuation: number; momentum: number; overall: number; };
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[]; };
  technical_summary?: { status: string; buy_count: number; sell_count: number; neutral_count: number; };
  peers?: Array<{ ticker: string; pe: number; pb: number; roe: string; margin: string; is_current: boolean; }>;
  news_sentiment?: {
    net_index: number;
    articles: Array<{ headline: string; source: string; url: string; score: number; bias: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'; }>;
  };
}
interface ScreenerItem { ticker: string; rsi: number; change_pct: number; ai_score: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; }

export default function EquitySightCompleteDashboard() {
  // 🔥 CONFIGURATION CONSTANTS: Reads cloud links dynamically or fallbacks straight to local dev servers
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
  const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8000';

  const [indices, setIndices] = useState<{ nifty: IndexData; sensex: IndexData } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [activeStock, setActiveStock] = useState<StockData | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [screenerData, setScreenerData] = useState<ScreenerItem[]>([]);
  const [loadingScreener, setLoadingScreener] = useState(true);
  
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'CHART' | 'NEWS' | 'GAUGE' | 'PEERS' | 'DVM' | 'SWOT' | 'GROWTH' | 'QUARTERLY' | 'SHAREHOLDING' | 'DIVIDENDS'>('CHART');

  // Real-time WebSocket Price States
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveHigh, setLiveHigh] = useState<number | null>(null);
  const [liveVolumeRatio, setLiveVolumeRatio] = useState<number | null>(null);
  const [priceFlashColor, setPriceFlashColor] = useState<'text-white' | 'text-emerald-400' | 'text-rose-400'>('text-white');
  const wsRef = useRef<WebSocket | null>(null);

  // PDF Export Loader State
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  // Auth Overlay & Form States
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [userSession, setUserSession] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Hook 1: Listen to active Firebase persistent login sessions
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUserSession(currentUser);
      if (currentUser) setIsAuthModalOpen(false); 
    });
    return () => unsubscribe();
  }, []);

  // Hook 2: Core Init Dashboard Scan Loop
  useEffect(() => {
    async function loadInitialData() {
      try {
        const screenerRes = await fetch(`${API_BASE_URL}/api/equitysight/screener`);
        if (!screenerRes.ok) throw new Error("Backend screener offline");
        const screenerJson = await screenerRes.json();
        setScreenerData(screenerJson.data || []);

        const indicesRes = await fetch(`${API_BASE_URL}/api/equitysight/indices`);
        if (indicesRes.ok) {
          const indicesJson = await indicesRes.json();
          setIndices(indicesJson);
        }
      } catch (err) { 
        console.error("⚠️ Connection to EquitySight Core engine failed:", err);
        setScreenerData([]); 
      } finally { 
        setLoadingScreener(false); 
      }
    }
    loadInitialData();
  }, [API_BASE_URL]);

  // Hook 3: Real-time search processing queries
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const delayDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/equitysight/search?q=${searchQuery}`);
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (err) { console.error(err); }
    }, 150);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, API_BASE_URL]);

  // Hook 4: Automated 30-Second Access Portal Trigger
  useEffect(() => {
    if (isAuthModalOpen || activeStock || userSession) return;

    const authAutoTriggerTimeout = setTimeout(() => {
      if (!activeStock && !userSession) {
        setAuthMode('LOGIN');
        setIsAuthModalOpen(true);
      }
    }, 30000);

    return () => clearTimeout(authAutoTriggerTimeout);
  }, [activeStock, isAuthModalOpen, userSession]);

  // 🔔 Hook 5: LIVE TICKER DATA WEBSOCKET SUBSCRIPTION MANAGER
  useEffect(() => {
    if (!activeStock?.ticker) return;

    if (wsRef.current) wsRef.current.close();

    setLivePrice(null);
    setLiveHigh(null);
    setLiveVolumeRatio(null);

    // Formulate real-time address dynamically from state variable configurations
    const wsUrl = `${WS_BASE_URL}/ws/live-ticker/${activeStock.ticker}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onmessage = (event) => {
      const liveJson = JSON.parse(event.data);
      
      setLivePrice((prevPrice) => {
        if (prevPrice !== null && liveJson.price > prevPrice) {
          setPriceFlashColor('text-emerald-400');
          setTimeout(() => setPriceFlashColor('text-white'), 600);
        } else if (prevPrice !== null && liveJson.price < prevPrice) {
          setPriceFlashColor('text-rose-400');
          setTimeout(() => setPriceFlashColor('text-white'), 600);
        }
        return liveJson.price;
      });

      setLiveHigh(liveJson.day_high);
      setLiveVolumeRatio(liveJson.volume_ratio);
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeStock, WS_BASE_URL]);

  const openAuthModal = (mode: 'LOGIN' | 'SIGNUP') => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };

  // 📝 DOWNLOAD STRATEGY PDF DOCUMENT ROUTINE
  const downloadQuantPDFReport = async () => {
    if (!activeStock?.ticker) return;
    setIsExportingPDF(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/reports/download/${activeStock.ticker}`);
      if (!res.ok) throw new Error("Failed to compile research PDF file artifact.");
      
      const blob = await res.blob();
      const fileUrl = window.URL.createObjectURL(blob);
      const tempDownloadLink = document.createElement('a');
      tempDownloadLink.href = fileUrl;
      tempDownloadLink.setAttribute('download', `EquitySight_${activeStock.ticker.replace(".NS", "")}_Report.pdf`);
      document.body.appendChild(tempDownloadLink);
      tempDownloadLink.click();
      tempDownloadLink.remove();
    } catch (err) {
      console.error(err);
      alert("Could not process PDF export task.");
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleFormAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return;
    setAuthLoading(true);
    try {
      if (authMode === 'SIGNUP') {
        await createUserWithEmailAndPassword(auth, emailInput, passwordInput);
        alert("Account provisioned successfully!");
      } else {
        await signInWithEmailAndPassword(auth, emailInput, passwordInput);
      }
      setEmailInput('');
      setPasswordInput('');
    } catch (err: any) {
      console.error(err);
      alert(`Authentication failed: ${err.message}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOAuthSignIn = async (providerName: 'google' | 'facebook' | 'twitter') => {
    let provider;
    if (providerName === 'google') provider = googleProvider;
    else if (providerName === 'facebook') provider = facebookProvider;
    else provider = twitterProvider;

    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      alert(`OAuth Link rejected: ${err.message}`);
    }
  };

  const handleSignOut = async () => {
    if (confirm("Disconnect terminal profile session?")) {
      await signOut(auth);
    }
  };

  const loadStockAnalysis = async (symbol: string) => {
    if (!symbol) return;
    setLoadingSearch(true);
    setShowDropdown(false);
    
    const safeQuery = typeof symbol === 'string' ? symbol.replace(".NS", "") : "";
    setSearchQuery(safeQuery);
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/trend/${symbol}`);
      if (!res.ok) {
        const errorData = await res.json();
        alert(`Engine error loading ${safeQuery}: ${errorData?.detail || "Calculation failure"}`);
        return;
      }
      
      const data = await res.json();
      if (!data || !data.metrics) return;
      
      if (!data.dvm_score) data.dvm_score = { durability: 78, valuation: 45, momentum: 82, overall: 68 };
      if (!data.swot) {
        data.swot = {
          strengths: ["Strong revenue trajectory YoY", "High liquidity ratio controls", "Breakout setup flags on chart patterns"],
          weaknesses: ["Growing operational expenditures impact core margins", "High relative multi-year P/E bounds"],
          opportunities: ["FII capital allocations expanding float baseline", "Upcoming structural index weight cycles"],
          threats: ["Regulatory changes regarding global margins", "Forex conversion level vulnerabilities"]
        };
      }
      
      setActiveStock(data);
      setActiveAnalysisTab('CHART');
    } catch (err) { 
      console.error("🚨 Network connectivity exception encountered:", err); 
    } finally { 
      setLoadingSearch(false); 
    }
  };

  const renderMiniTable = (title: string, dataSubset: ScreenerItem[], accentColor: string) => (
    <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-4 flex flex-col h-full shadow-lg backdrop-blur-md">
      <h3 className={`text-xs font-bold uppercase tracking-widest ${accentColor} mb-3 border-b border-slate-900 pb-2 flex justify-between`}>
        <span>{title}</span>
        <span className="text-[10px] text-slate-500 font-mono font-medium">COUNT: {dataSubset.length}</span>
      </h3>
      <table className="w-full text-left text-[11px] text-slate-400">
        <thead>
          <tr className="text-slate-600 font-mono text-[10px] uppercase border-b border-slate-900/40">
            <th className="pb-2">SYMBOL</th>
            <th className="pb-2 text-right">AI BIAS</th>
            <th className="pb-2 text-right">CHG%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900/30">
          {dataSubset.map((stock) => {
            const safeTicker = stock?.ticker ? String(stock.ticker).replace(".NS", "") : "UNKNOWN";
            return (
              <tr key={stock.ticker} onClick={() => loadStockAnalysis(`${stock.ticker}.NS`)} className="hover:bg-slate-900/40 cursor-pointer group transition-colors">
                <td className="py-2.5 font-mono font-bold text-slate-200 group-hover:text-indigo-400">{safeTicker}</td>
                <td className="py-2.5 text-right font-mono text-white">{stock?.ai_score || 0}%</td>
                <td className={`py-2.5 text-right font-mono ${stock.change_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{stock.change_pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="min-h-screen bg-[#060812] text-slate-200 p-6 md:p-12 font-sans relative">
      <div className="max-w-6xl mx-auto">
        
        <header className="mb-8 border-b border-slate-900/60 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-widest">EQUITYSIGHT <span className="text-indigo-500 font-light">INTEGRATED PRO</span></h1>
            <p className="text-slate-500 text-xs tracking-widest uppercase mt-1">Universal Search Utility & Segmented Signal Desk</p>
          </div>
          
          <div className="flex items-center gap-3 font-mono text-xs tracking-wider">
            {userSession ? (
              <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-900 pl-2 pr-4 py-1.5 rounded-xl shadow-xl backdrop-blur-md">
                {userSession.photoURL ? (
                  <img src={userSession.photoURL} alt="Profile" referrerPolicy="no-referrer" className="h-7 w-7 rounded-lg object-cover ring-1 ring-indigo-500/30" />
                ) : (
                  <div className="h-7 w-7 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold">
                    {userSession.email ? userSession.email.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}
                <span className="text-slate-300 text-[10px] max-w-[120px] truncate">{userSession.displayName || userSession.email}</span>
                <div className="h-3 w-px bg-slate-900 mx-1" />
                <button onClick={handleSignOut} className="text-rose-400 hover:text-rose-300 transition-colors text-[10px] font-bold uppercase tracking-wider pl-1">DISCONNECT</button>
              </div>
            ) : (
              <>
                <button onClick={() => openAuthModal('LOGIN')} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900/40 transition-all">LOG IN</button>
                <button onClick={() => openAuthModal('SIGNUP')} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg transition-all">SIGN UP</button>
              </>
            )}
          </div>
        </header>

        {indices && (
          <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-950/80 p-3 rounded-2xl border border-slate-900 shadow-2xl backdrop-blur-md">
            <div className="px-3 border-r border-slate-900">
              <span className="text-[10px] font-bold text-slate-500 block">NIFTY 50</span>
              <div className="flex items-baseline gap-2 mt-0.5 font-mono text-sm font-black text-white">
                {indices.nifty.price} <span className={`text-[11px] ${indices.nifty.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{indices.nifty.change}%</span>
              </div>
            </div>
            <div className="px-3">
              <span className="text-[10px] font-bold text-slate-500 block">BSE SENSEX</span>
              <div className="flex items-baseline gap-2 mt-0.5 font-mono text-sm font-black text-white">
                {indices.sensex.price} <span className={`text-[11px] ${indices.sensex.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{indices.sensex.change}%</span>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 relative max-w-lg z-50">
          <input
            type="text" value={searchQuery} onFocus={() => setShowDropdown(true)} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search any market stock... (e.g. INFOSYS, RELIANCE)"
            className="w-full px-5 py-3.5 rounded-xl bg-slate-950/80 border border-slate-900 text-white font-mono text-xs focus:outline-none focus:border-indigo-500 shadow-xl"
          />
          <AnimatePresence>
            {showDropdown && searchResults.length > 0 && (
              <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute w-full mt-2 bg-slate-950 border border-slate-900 rounded-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-900/60">
                {searchResults.map((sym) => {
                  const safeDisplay = sym ? String(sym).replace(".NS", "") : "UNKNOWN";
                  return (
                    <li key={sym} onClick={() => loadStockAnalysis(sym)} className="px-5 py-3 text-xs font-mono text-slate-300 hover:bg-indigo-600 cursor-pointer">🔍 {safeDisplay}</li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <div className="mb-10">
          {loadingScreener ? <div className="text-slate-600 font-mono text-xs animate-pulse">Running matrix scan...</div> : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              {renderMiniTable('🟢 Most Bullish Trends', screenerData.filter(s => s.signal === 'BULLISH'), 'text-emerald-400')}
              {renderMiniTable('⚪ Neutral / Consolidation', screenerData.filter(s => s.signal === 'NEUTRAL'), 'text-amber-400')}
              {renderMiniTable('🔴 Most Bearish Trends', screenerData.filter(s => s.signal === 'BEARISH'), 'text-rose-400')}
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {loadingSearch ? <div className="text-indigo-400 font-mono text-xs animate-pulse tracking-widest mb-10">CRUNCHING LIVE DATA MATRIX...</div> : activeStock && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              
              <div className="p-5 bg-slate-950 border border-slate-900 rounded-2xl flex justify-between items-center shadow-xl">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Inspected Core</span>
                  <div className="flex items-center gap-4 mt-1">
                    <h2 className="text-2xl font-black text-white font-mono tracking-widest">
                      {activeStock?.ticker ? String(activeStock.ticker).replace(".NS", "") : "---"}
                    </h2>
                    {livePrice !== null && (
                      <span className={`text-xl font-bold font-mono tracking-wider bg-slate-900/80 border border-slate-800 px-3 py-1 rounded-xl transition-all ${priceFlashColor}`}>
                        ₹{livePrice}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={downloadQuantPDFReport} disabled={isExportingPDF}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl font-mono text-xs font-bold text-indigo-400 flex items-center gap-2 transition-all disabled:opacity-40"
                >
                  {isExportingPDF ? "📥 COMPILING..." : "📄 EXPORT QUANT REPORT"}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
                {[
                  { label: 'Intraday High', value: liveHigh !== null ? `₹${liveHigh}` : `₹${activeStock?.metrics?.day_high || 0}`, clr: 'text-white font-bold' },
                  { label: 'Prev Close', value: `₹${activeStock?.metrics?.prev_close || 0}`, clr: 'text-slate-400' },
                  { label: 'RSI Value', value: activeStock?.metrics?.current_rsi || 0, clr: 'text-slate-200' },
                  { label: 'EMA Gap %', value: `${activeStock?.metrics?.ema_gap_pct || 0}%`, clr: 'text-slate-200' },
                  { label: 'Return %', value: `${activeStock?.metrics?.daily_return_pct || 0}%`, clr: (activeStock?.metrics?.daily_return_pct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Volume Surge', value: liveVolumeRatio !== null ? `${liveVolumeRatio}x` : `${activeStock?.metrics?.volume_ratio || 0}x`, clr: 'text-slate-400' }
                ].map((m) => (
                  <div key={m.label} className="p-4 bg-slate-950/60 border border-slate-900 rounded-xl">
                    <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider block">{m.label}</span>
                    <span className={`text-base font-bold font-mono mt-1 block ${m.clr}`}>{m.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap border-b border-slate-900 text-xs font-mono gap-1">
                {[
                  ['CHART', '📈 TECHNICAL CHART'],
                  ['NEWS', '🤖 AI SENTIMENT FEED'],
                  ['GAUGE', '🧭 SENTIMENT GAUGE'],
                  ['PEERS', '📊 COMPETITOR PEERS'],
                  ['DVM', '⚡ MC DVM SCORE'],
                  ['SWOT', '🎯 STOCK SWOT'],
                  ['GROWTH', '🚀 GROWTH RATE'],
                  ['QUARTERLY', '📊 QUARTERLY RESULTS'],
                  ['SHAREHOLDING', '👥 SHARE HOLDING'],
                  ['DIVIDENDS', '💰 DIVIDENDS']
                ].map(([id, label]) => (
                  <button key={id} onClick={() => setActiveAnalysisTab(id as any)} className={`px-4 py-2 border-b-2 font-bold transition-all ${activeAnalysisTab === id ? 'border-indigo-500 text-white bg-indigo-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>{label}</button>
                ))}
              </div>

              <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-6 min-h-[380px] shadow-2xl backdrop-blur-md">
                
                <div className={activeAnalysisTab === 'CHART' ? 'block' : 'hidden'}>
                  <div className="overflow-hidden rounded-xl border border-slate-900 bg-[#090d16]">
                    <StockChart candles={activeStock?.candle_history && activeStock.candle_history.length > 0 ? activeStock.candle_history : []} />
                  </div>
                </div>

                {activeAnalysisTab === 'NEWS' && activeStock?.news_sentiment && (
                  <div className="space-y-6 animate-fadeIn font-mono text-xs">
                    <div className="p-4 bg-slate-950 border border-slate-900 rounded-xl flex justify-between items-center max-w-md shadow-lg">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Net Aggregated NLP Sentiment Index</span>
                        <p className="text-slate-400 font-sans text-[10px] mt-0.5 leading-relaxed">
                          Continuous text metric scale for {activeStock?.ticker ? String(activeStock.ticker).replace(".NS", "") : "Asset"} bounded between -1.0 and +1.0.
                        </p>
                      </div>
                      <div className={`text-xl font-black px-3 py-1.5 rounded-lg border bg-[#070b12] ${
                        activeStock.news_sentiment.net_index > 0.05 ? 'text-emerald-400 border-emerald-900/40' :
                        activeStock.news_sentiment.net_index < -0.05 ? 'text-rose-400 border-rose-900/40' : 'text-amber-400 border-slate-900'
                      }`}>
                        {activeStock.news_sentiment.net_index > 0 ? '+' : ''}{activeStock.news_sentiment.net_index}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {activeStock.news_sentiment.articles.map((art, idx) => (
                        <div key={idx} className="p-4 bg-slate-950/40 border border-slate-900 rounded-xl hover:border-slate-800 transition-colors flex justify-between items-start gap-4">
                          <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider text-indigo-400 bg-indigo-950/30 border border-indigo-900/20 px-2 py-0.5 rounded">
                              {art.source}
                            </span>
                            <h4 className="text-slate-200 text-sm font-sans font-medium tracking-wide leading-snug pt-1">
                              {art.headline}
                            </h4>
                          </div>
                          <div className={`text-[10px] font-bold px-2.5 py-1 rounded border tracking-widest ${
                            art.bias === 'POSITIVE' ? 'text-emerald-400 bg-emerald-950/20 border-emerald-900/30' :
                            art.bias === 'NEGATIVE' ? 'text-rose-400 bg-rose-950/20 border-rose-900/30' : 'text-slate-400 bg-slate-900/40 border-slate-800'
                          }`}>
                            {art.bias}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAnalysisTab === 'GAUGE' && activeStock?.technical_summary && (
                  <div className="space-y-6 animate-fadeIn font-mono">
                    <div className="max-w-md mx-auto p-6 bg-slate-950 border border-slate-900 rounded-2xl text-center shadow-xl">
                      <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase block mb-2">Aggregated Summary Indicator</span>
                      <div className={`text-3xl font-black tracking-widest py-4 ${activeStock.technical_summary.status.includes('BUY') ? 'text-emerald-400' : activeStock.technical_summary.status.includes('SELL') ? 'text-rose-400' : 'text-amber-400'}`}>
                        {activeStock.technical_summary.status}
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-6 text-xs text-center border-t border-slate-900/60 pt-4">
                        <div className="p-2 bg-emerald-950/20 rounded-xl border border-emerald-900/30">
                          <span className="text-slate-500 text-[10px] block font-bold">BUYS</span>
                          <span className="text-emerald-400 font-bold text-base">{activeStock.technical_summary.buy_count}</span>
                        </div>
                        <div className="p-2 bg-slate-900/40 rounded-xl border border-slate-900/60">
                          <span className="text-slate-500 text-[10px] block font-bold">NEUTRAL</span>
                          <span className="text-slate-300 font-bold text-base">{activeStock.technical_summary.neutral_count}</span>
                        </div>
                        <div className="p-2 bg-rose-950/20 rounded-xl border border-rose-900/30">
                          <span className="text-slate-500 text-[10px] block font-bold">SELLS</span>
                          <span className="text-rose-400 font-bold text-base">{activeStock.technical_summary.sell_count}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeAnalysisTab === 'PEERS' && activeStock?.peers && (
                  <div className="animate-fadeIn font-mono overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-900 uppercase tracking-widest text-[10px]">
                          <th className="pb-3">COMPETITOR SYMBOL</th><th className="pb-3 text-right">TRAILING P/E</th><th className="pb-3 text-right">P/B RATIO</th><th className="pb-3 text-right">ROE</th><th className="pb-3 text-right">OP. MARGIN</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/40 font-medium">
                        {activeStock.peers.map((peer, idx) => {
                          const safePeerTicker = peer?.ticker ? String(peer.ticker).replace(".NS", "") : "COMPETITOR";
                          return (
                            <tr key={idx} className={peer.is_current ? 'bg-indigo-500/5 font-bold border-y border-indigo-500/20' : 'hover:bg-slate-900/20'}>
                              <td className={`py-3.5 pl-2 ${peer.is_current ? 'text-indigo-400' : 'text-slate-200'}`}>{safePeerTicker} {peer.is_current && <span className="text-[9px] bg-indigo-600 text-white px-1.5 py-0.5 rounded ml-2">ACTIVE</span>}</td>
                              <td className="py-3.5 text-right font-bold text-white">{peer.pe}</td>
                              <td className="py-3.5 text-right text-slate-400">{peer.pb}</td>
                              <td className="py-3.5 text-right text-emerald-400">{peer.roe}</td>
                              <td className="py-3.5 text-right text-slate-300">{peer.margin}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeAnalysisTab === 'DVM' && activeStock?.dvm_score && (
                  <div className="space-y-6 animate-fadeIn">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 font-mono">
                      {[
                        { title: 'Durability Index', score: activeStock.dvm_score.durability, desc: 'Financial health & leverage metrics', color: 'text-emerald-400' },
                        { title: 'Valuation Index', score: activeStock.dvm_score.valuation, desc: 'Current price multiple vs historic bounds', color: 'text-amber-400' },
                        { title: 'Momentum Index', score: activeStock.dvm_score.momentum, desc: 'Technical vector scaling velocity bounds', color: 'text-indigo-400' },
                        { title: 'Overall DVM Ranking', score: activeStock.dvm_score.overall, desc: 'Aggregated strength matrix ranking', color: 'text-white font-black' }
                      ].map((dvm) => (
                        <div key={dvm.title} className="p-4 bg-slate-950 border border-slate-900/70 rounded-xl flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase block">{dvm.title}</span>
                            <span className={`text-2xl font-mono mt-2 block ${dvm.color}`}>{dvm.score}/100</span>
                          </div>
                          <p className="text-[10px] text-slate-600 font-sans mt-3 border-t border-slate-900/60 pt-2 leading-relaxed">{dvm.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAnalysisTab === 'SWOT' && activeStock?.swot && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn text-xs font-mono">
                    {[
                      { key: 'S', label: '🟢 Strengths', data: activeStock.swot.strengths, border: 'border-emerald-950/40 bg-emerald-950/5 text-emerald-300' },
                      { key: 'W', label: '🔴 Weaknesses', data: activeStock.swot.weaknesses, border: 'border-rose-950/40 bg-rose-950/5 text-rose-300' },
                      { key: 'O', label: '🔵 Opportunities', data: activeStock.swot.opportunities, border: 'border-blue-950/40 bg-blue-950/5 text-blue-300' },
                      { key: 'T', label: '🟡 Threats', data: activeStock.swot.threats, border: 'border-amber-950/40 bg-amber-950/5 text-amber-300' }
                    ].map((swotGroup) => (
                      <div key={swotGroup.key} className={`p-4 border rounded-xl ${swotGroup.border}`}>
                        <h4 className="font-bold uppercase tracking-widest text-[11px] mb-2.5 pb-1 border-b border-slate-900/30">{swotGroup.label}</h4>
                        <ul className="space-y-2 text-[11px] list-disc pl-4 text-slate-400 font-sans">
                          {swotGroup.data.map((item, idx) => <li key={idx} className="leading-relaxed">{item}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {activeAnalysisTab === 'GROWTH' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 animate-fadeIn">
                    {[
                      { label: 'Revenue YoY Growth', val: activeStock?.growth_rates?.revenue_yoy || '0%' },
                      { label: 'Net Profit YoY Growth', val: activeStock?.growth_rates?.profit_yoy || '0%' },
                      { label: 'EPS Vector Growth', val: activeStock?.growth_rates?.eps_growth || '0' },
                      { label: 'Core Operating Margin', val: activeStock?.growth_rates?.operating_margin || '0%' }
                    ].map((card) => (
                      <div key={card.label} className="p-4 bg-slate-950 border border-slate-900/60 rounded-xl">
                        <span className="text-[10px] text-slate-500 block font-bold uppercase">{card.label}</span>
                        <span className="text-xl font-bold text-emerald-400 font-mono mt-2 block">{card.val}</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeAnalysisTab === 'QUARTERLY' && (
                  <table className="w-full text-left text-xs text-slate-300 font-mono animate-fadeIn">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-900 uppercase text-[10px]"><th className="pb-3">Period</th><th className="pb-3 text-right">Revenue</th><th className="pb-3 text-right">Net Profit</th><th className="pb-3 text-right">EPS</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/40">
                      {activeStock?.quarterly_results?.map((q, i) => (
                        <tr key={i} className="hover:bg-slate-900/20"><td className="py-3 text-white font-bold">{q.quarter}</td><td className="py-3 text-right">{q.revenue}</td><td className="py-3 text-right text-emerald-400">{q.net_profit}</td><td className="py-3 text-right text-slate-400">{q.eps}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {activeAnalysisTab === 'SHAREHOLDING' && (
                  <div className="space-y-4 max-w-md animate-fadeIn">
                    {[
                      { label: 'Promoter Holdings', val: activeStock?.shareholding?.promoters || '0%' },
                      { label: 'Foreign Institutional (FII)', val: activeStock?.shareholding?.fii || '0%' },
                      { label: 'Domestic Institutional (DII)', val: activeStock?.shareholding?.dii || '0%' },
                      { label: 'Retail & Public Float', val: activeStock?.shareholding?.public || '0%' }
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="flex justify-between text-xs mb-1 font-mono"><span className="text-slate-400">{item.label}</span><span className="font-bold text-white">{item.val}</span></div>
                        <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden"><div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: item.val }} /></div>
                      </div>
                    ))}
                  </div>
                )}

                {activeAnalysisTab === 'DIVIDENDS' && (
                  <div className="space-y-6 animate-fadeIn">
                    <div className="grid grid-cols-2 gap-4 max-w-md">
                      <div className="p-4 bg-slate-950 border border-slate-900/60 rounded-xl"><span className="text-[10px] text-slate-500 font-bold block">Dividend Yield</span><span className="text-2xl font-black text-indigo-400 font-mono mt-1 block">{activeStock?.dividends?.dividend_yield || '0%'}</span></div>
                      <div className="p-4 bg-slate-950 border border-slate-900/60 rounded-xl"><span className="text-[10px] text-slate-500 font-bold block">Payout Ratio</span><span className="text-2xl font-black text-slate-200 font-mono mt-1 block">{activeStock?.dividends?.payout_ratio || '0%'}</span></div>
                    </div>
                    <table className="w-full text-left text-xs font-mono text-slate-300">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-900 uppercase text-[10px]"><th>Type</th><th>Amount</th><th className="text-right">Ex-Date</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900/40">
                        {activeStock?.dividends?.history?.map((h, i) => (
                          <tr key={i} className="hover:bg-slate-900/20"><td className="py-3 text-slate-200 font-bold">{h.type}</td><td className="py-3 text-emerald-400 font-bold">{h.amount}</td><td className="py-3 text-right text-slate-400">{h.ex_date}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* OVERLAY INTERACTIVE MODAL */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAuthModalOpen(false)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} className="relative w-full max-w-sm bg-[#090d16] border border-slate-900 rounded-2xl p-6 shadow-2xl z-10 flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-xs font-bold font-mono tracking-widest text-slate-400 uppercase">
                  {authLoading ? '⚡ CONNECTING...' : authMode === 'LOGIN' ? '🔐 TERMINAL ENTRY' : '🚀 CREATE ACCOUNT'}
                </h3>
                <button onClick={() => setIsAuthModalOpen(false)} className="h-6 w-6 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-900 font-mono text-xs">✕</button>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-5 font-mono text-[10px]">
                <button onClick={() => handleOAuthSignIn('google')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-900 bg-slate-950 text-slate-300 font-medium hover:bg-slate-900 hover:text-white transition-colors">🌐 Google</button>
                <button onClick={() => handleOAuthSignIn('facebook')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-900 bg-slate-950 text-slate-300 font-medium hover:bg-slate-900 hover:text-white transition-colors">📘 Facebook</button>
                <button onClick={() => handleOAuthSignIn('twitter')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-900 bg-slate-950 text-slate-300 font-medium hover:bg-slate-900 hover:text-white transition-colors">🐦 Twitter</button>
              </div>

              <div className="relative flex items-center justify-center mb-5 text-[9px] font-mono text-slate-600 uppercase tracking-widest">
                <div className="absolute w-full border-t border-slate-900/80 z-0" />
                <span className="relative px-3 bg-[#090d16] z-10">Or baseline keys</span>
              </div>

              <form onSubmit={handleFormAuthSubmit} className="space-y-3.5 font-mono text-xs">
                <div>
                  <label className="text-[9px] font-bold tracking-wider text-slate-500 block mb-1 uppercase">Email Address</label>
                  <input 
                    type="email" required placeholder="name@terminal.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-800" 
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold tracking-wider text-slate-500 block mb-1 uppercase">Password Key</label>
                  <input 
                    type="password" required placeholder="••••••••••••" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-900 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-800" 
                  />
                </div>
                <button 
                  type="submit" disabled={authLoading}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black tracking-widest mt-2 shadow-lg uppercase transition-all disabled:bg-slate-800 disabled:text-slate-600"
                >
                  {authMode === 'LOGIN' ? 'Connect Instance' : 'Register Profile'}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-slate-900/60 text-center font-mono text-[10px] text-slate-500">
                {authMode === 'LOGIN' ? (
                  <>New terminal instance? <button onClick={() => setAuthMode('SIGNUP')} className="text-indigo-400 hover:underline font-bold transition-all">Create Profile</button></>
                ) : (
                  <>Already have credentials? <button onClick={() => setAuthMode('LOGIN')} className="text-indigo-400 hover:underline font-bold transition-all">Establish Login</button></>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}