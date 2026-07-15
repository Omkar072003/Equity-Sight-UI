'use client';

import { createChart, ColorType, AreaSeries } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

interface CandleDataNode { 
  time: string; 
  close: number; 
}
interface ChartProps { candles: CandleDataNode[]; }

export default function StockChart({ candles }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const hasValidData = Array.isArray(candles) && candles.length > 0;

  useEffect(() => {
    if (!chartContainerRef.current || !hasValidData) return;

    const container = chartContainerRef.current;
    container.innerHTML = ''; // Wipe past dynamic canvas structures

    const chart = createChart(container, {
      layout: { 
        background: { type: ColorType.Solid, color: '#090d16' }, 
        textColor: '#64748b' 
      },
      grid: { 
        vertLines: { color: '#131926' }, 
        horzLines: { color: '#131926' } 
      },
      width: container.clientWidth || 600,
      height: 350,
      timeScale: { borderColor: '#1e293b' }
    });

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#6366f1',       
      topColor: '#6366f120',      
      bottomColor: '#6366f100',   
      lineWidth: 2,
    });

    // Clean, validate and sort timelines from oldest to newest chronologically
    const sortedData = [...candles]
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .map(item => ({ time: item.time, value: item.close }));

    const uniqueData: { time: string; value: number }[] = [];
    const seenDates = new Set<string>();

    for (const dataPoint of sortedData) {
      if (!seenDates.has(dataPoint.time)) {
        seenDates.add(dataPoint.time);
        uniqueData.push(dataPoint);
      }
    }

    areaSeries.setData(uniqueData);
    
    requestAnimationFrame(() => {
      chart.timeScale().fitContent();
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width });
          chart.timeScale().fitContent();
        }
      }
    });
    
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, hasValidData]); 

  return (
    <div className="w-full bg-[#090d16] p-4 border border-slate-900 rounded-2xl relative min-h-[420px]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xs font-bold font-mono tracking-widest text-slate-500 uppercase">📈 Market Trend Line</h3>
        <span className="text-[10px] font-mono text-slate-600">CLOSING VALUE BASELINE</span>
      </div>
      
      <div className="relative w-full h-[350px]">
        {!hasValidData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center font-mono text-xs text-slate-600 animate-pulse bg-[#090d16] rounded-xl">
            Awaiting technical historical chart data matrix hydration...
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}