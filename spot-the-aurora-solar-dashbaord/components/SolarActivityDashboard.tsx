// --- START OF FILE src/components/SolarActivityDashboard.tsx ---

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
import { sendNotification, canSendNotification, clearNotificationCooldown } from '../utils/notifications.ts';

interface SolarActivityDashboardProps {
  apiKey: string;
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
  // Callback to navigate to CME Visualization with a specific CME
  onViewCMEInVisualization: (cmeId: string) => void; // RENAMED PROP
}

// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const NOAA_PROTON_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';

// SDO URLs now point to your Cloudflare Worker proxy, only 1024px and 2048px retained
const SDO_PROXY_BASE_URL = 'https://sdo-imagery-proxy.thenamesrock.workers.dev';
const SDO_HMI_BC_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmibc-1024`; // HMI Continuum
const SDO_HMI_IF_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmiif-1024`; // HMI Intensitygram
const SDO_AIA_193_2048_URL = `${SDO_PROXY_BASE_URL}/sdo-aia193-2048`; // AIA 193 (Coronal Holes)

// REMOVED: NASA_IPS_URL

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// --- HELPERS ---
const getCssVar = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
};

const getColorForFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'; // Green
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'; // Hot Pink for X5+
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';    // Purple for X1-X4.9
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';    // OrangeRed for M
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11'; // Yellow
    return `rgba(${rgb}, ${opacity})`;
};

const getColorForProtonFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'; // Default Green (S0 and below)
    if (value >= 10) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11'; // Yellow (S1)
    if (value >= 100) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0'; // OrangeRed (S2)
    if (value >= 1000) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219'; // Purple (S3)
    if (value >= 10000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'; // Hot Pink (S4)
    if (value >= 100000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'; // Re-using hot pink for S5 (highest severity)
    return `rgba(${rgb}, ${opacity})`;
};

const getColorForFlareClass = (classType: string): { background: string, text: string } => {
    const type = classType ? classType[0].toUpperCase() : 'U';
    const magnitude = parseFloat(classType.substring(1));

    if (type === 'X') {
        if (magnitude >= 5) {
            return { background: `rgba(${getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'}, 1)`, text: 'text-white' }; // Hot Pink
        }
        return { background: `rgba(${getCssVar('--solar-flare-x-rgb') || '147, 112, 219'}, 1)`, text: 'text-white' }; // Purple
    }
    if (type === 'M') {
        return { background: `rgba(${getCssVar('--solar-flare-m-rgb') || '255, 69, 0'}, 1)`, text: 'text-white' }; // OrangeRed
    }
    if (type === 'C') {
        return { background: `rgba(${getCssVar('--solar-flare-c-rgb') || '245, 158, 11'}, 1)`, text: 'text-black' }; // Yellow
    }
    return { background: `rgba(${getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'}, 1)`, text: 'text-white' }; // Green for A/B/Unknown
};

const formatNZTimestamp = (isoString: string | null) => {
    if (!isoString) return 'N/A';
    try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; }
};

// NEW: Helper for X-ray class string (e.g., "M1.5")
const getXrayClass = (value: number | null): string => {
    if (value === null) return 'N/A';
    if (value >= 1e-4) return `X${(value / 1e-4).toFixed(1)}`;
    if (value >= 1e-5) return `M${(value / 1e-5).toFixed(1)}`;
    if (value >= 1e-6) return `C${(value / 1e-6).toFixed(1)}`;
    if (value >= 1e-7) return `B${(value / 1e-7).toFixed(1)}`;
    return `A${(value / 1e-8).toFixed(1)}`;
};

// NEW: Helper for Proton class string (e.g., "S1")
const getProtonClass = (value: number | null): string => {
    if (value === null) return 'N/A';
    if (value >= 100000) return 'S5';
    if (value >= 10000) return 'S4';
    if (value >= 1000) return 'S3';
    if (value >= 100) return 'S2';
    if (value >= 10) return 'S1';
    return 'S0';
};

// NEW: Helper for Overall Activity Status
const getOverallActivityStatus = (xrayClass: string, protonClass: string): 'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A' => {
    if (xrayClass === 'N/A' && protonClass === 'N/A') return 'N/A';

    let activityLevel: 'Quiet' | 'Moderate' | 'High' | 'Very High' = 'Quiet';

    // Prioritize X-ray for flare activity
    if (xrayClass.startsWith('X')) activityLevel = 'Very High';
    else if (xrayClass.startsWith('M')) activityLevel = 'High';
    else if (xrayClass.startsWith('C')) activityLevel = 'Moderate';

    // Then consider Proton activity, upgrading if necessary
    if (protonClass === 'S5' || protonClass === 'S4') activityLevel = 'Very High';
    else if (protonClass === 'S3' || protonClass === 'S2') {
        if (activityLevel !== 'Very High') activityLevel = 'High';
    }
    else if (protonClass === 'S1') {
        if (activityLevel === 'Quiet') activityLevel = 'Moderate';
    }
    
    return activityLevel;
};


// --- REUSABLE COMPONENTS ---
const TimeRangeButtons: React.FC<{ onSelect: (duration: number) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '4 Hr', hours: 4 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
    return (
        <div className="flex justify-center gap-2 my-2 flex-wrap">
            {timeRanges.map(({ label, hours }) => (
                <button key={hours} onClick={() => onSelect(hours * 3600000)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`} title={`Show data for the last ${hours} hours`}>
                    {label}
                </button>
            ))}
        </div>
    );
};

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            content
          )}
        </div>
      </div>
    </div>
  );
};

// NEW: Simple Loading Spinner Component
const LoadingSpinner: React.FC<{ message?: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-neutral-400 italic">
        <svg className="animate-spin h-8 w-8 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {message && <p className="mt-2 text-sm">{message}</p>}
    </div>
);


const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ apiKey, setViewerMedia, setLatestXrayFlux, onViewCMEInVisualization }) => { // RENAMED PROP
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoAia193_2048, setSdoAia193_2048] = useState({ url: '/placeholder.png', loading: 'Loading image...' });

    const [ccor1Video, setCcor1Video] = useState({ url: '', loading: 'Loading video...' });

    // Set default active image to SUVI_131
    const [activeSunImage, setActiveSunImage] = useState<string>('SUVI_131');

    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(24 * 60 * 60 * 1000);
    
    const [allProtonData, setAllProtonData] = useState<any[]>([]);
    const [loadingProton, setLoadingProton] = useState<string | null>('Loading proton flux data...');
    const [protonTimeRange, setProtonTimeRange] = useState<number>(24 * 60 * 60 * 1000);

    const [solarFlares, setSolarFlares] = useState<any[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [selectedFlare, setSelectedFlare] = useState<any | null>(null);

    // Refs for previous flux values to trigger notifications
    const previousLatestXrayFluxRef = useRef<number | null>(null);
    const previousLatestProtonFluxRef = useRef<number | null>(null);

    // State for the InfoModal
    const [modalState, setModalState] = useState<{isOpen: boolean; title: string; content: string | React.ReactNode} | null>(null);

    // NEW: States for Summary Section and Last Update Timestamps
    const [currentXraySummary, setCurrentXraySummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
    const [currentProtonSummary, setCurrentProtonSummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
    const [latestRelevantEvent, setLatestRelevantEvent] = useState<string | null>(null);
    const [overallActivityStatus, setOverallActivityStatus] = useState<'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A'>('N/A');

    const [lastXrayUpdate, setLastXrayUpdate] = useState<string | null>(null);
    const [lastProtonUpdate, setLastProtonUpdate] = useState<string | null>(null);
    const [lastFlaresUpdate, setLastFlaresUpdate] = useState<string | null>(null);
    const [lastImagesUpdate, setLastImagesUpdate] = useState<string | null>(null);


    const tooltipContent = useMemo(() => ({
        'xray-flux': 'The GOES X-ray Flux measures X-ray radiation from the Sun. Sudden, sharp increases indicate solar flares. Flares are classified by their peak X-ray flux: B, C, M, and X, with X being the most intense. Higher class flares (M and X) can cause radio blackouts and enhanced aurora.',
        'proton-flux': '<strong>GOES Proton Flux (>=10 MeV):</strong> Measures the flux of solar protons with energies of 10 MeV or greater. Proton events (Solar Radiation Storms) are classified on an S-scale from S1 to S5 based on the peak flux. These events can cause radiation hazards for astronauts and satellite operations, and can contribute to auroral displays.',
        'suvi-131': '<strong>SUVI 131Å (Angstrom):</strong> This Extreme Ultraviolet (EUV) wavelength shows the hot, flaring regions of the Sun\'s corona, highlighting solar flares and active regions. It\'s good for seeing intense bursts of energy, especially bursts from solar flares. **Best for: Monitoring solar flares and active regions.**',
        'suvi-304': '<strong>SUVI 304Å (Angstrom):</strong> This EUV wavelength reveals the cooler, denser plasma in the Sun\'s chromosphere and transition region. It\'s excellent for observing prominences (loops of plasma extending from the Sun\'s limb) and filaments (prominences seen against the solar disk). **Best for: Observing prominences and filaments, tracking large-scale solar activity.**',
        'sdo-hmibc-1024': '<strong>SDO HMI (Helioseismic and Magnetic Imager) Continuum (1024px):</strong> Provides a visible light view of the Sun\'s surface, primarily showing sunspots and granulation. It\'s like a high-resolution "photograph" of the Sun. **Best for: Detailed observation of sunspot structure and active region morphology.**',
        'sdo-hmiif-1024': '<strong>SDO HMI (Helioseismic and Magnetic Imager) Intensitygram (1024px):</strong> Offers a higher resolution view of sunspots and active regions, highlighting magnetic field concentrations. **Best for: Tracking the evolution of sunspots and identifying potential flare source regions.**',
        'sdo-aia193-2048': '<strong>SDO AIA 193Å (Angstrom) (2048px) - Coronal Holes:</strong> A very high-resolution view of the hot corona, excellent for observing large-scale coronal holes which are sources of fast solar wind. These dark regions are crucial for predicting geomagnetic storm potential. **Best for: Identifying and monitoring coronal holes, understanding solar wind origins.**',
        'ccor1-video': '<strong>CCOR1 (Coronal Coronagraph Observation by Optical Reconnaissance) Video:</strong> This coronagraph imagery captures the faint outer atmosphere of the Sun (the corona) by blocking out the bright solar disk. It is primarily used to detect and track Coronal Mass Ejections (CMEs) as they erupt and propagate away from the Sun. **Best for: Detecting and tracking Coronal Mass Ejections (CMEs) as they leave the Sun.**',
        'solar-flares': 'A list of the latest detected solar flares. Flares are sudden bursts of radiation from the Sun. Pay attention to the class type (M or X) as these are stronger events. A "CME Event" tag means a Coronal Mass Ejection was also observed with the flare, potentially leading to Earth impacts.',
        'solar-imagery': `
            <p><strong>SUVI 131Å (Angstrom):</strong> Shows hot, flaring regions. Best for: Monitoring solar flares and active regions.</p><br>
            <p><strong>SUVI 304Å (Angstrom):</strong> Reveals cooler, denser plasma. Best for: Observing prominences and filaments, tracking large-scale solar activity.</p><br>
            <p><strong>SDO AIA 193Å (Angstrom) (2048px) - Coronal Holes:</strong> High-resolution view of the hot corona. Best for: Identifying and monitoring coronal holes, understanding solar wind origins.</p><br>
            <p><strong>SDO HMI (Helioseismic and Magnetic Imager) Continuum (1024px):</strong> Visible light view of the Sun\'s surface, primarily showing sunspots and granulation. Best for: Detailed observation of sunspot structure and active region morphology.</p><br>
            <p><strong>SDO HMI (Helioseismic and Magnetic Imager) Intensitygram (1024px):</strong> Higher resolution view of sunspots and magnetic fields. Best for: Tracking the evolution of sunspots and identifying potential flare source regions.</p>
        `
    }), []);

    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'xray-flux') title = 'About GOES X-ray Flux';
            else if (id === 'proton-flux') title = 'About GOES Proton Flux (>=10 MeV)';
            else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
            else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
            else if (id === 'sdo-hmibc-1024') title = 'About SDO HMI Continuum Imagery';
            else if (id === 'sdo-hmiif-1024') title = 'About SDO HMI Intensitygram Imagery';
            else if (id === 'sdo-aia193-2048') title = 'About SDO AIA 193Å Imagery (Coronal Holes)';
            else if (id === 'ccor1-video') title = 'About CCOR1 Coronagraph Video';
            else if (id === 'solar-flares') title = 'About Solar Flares';
            else if (id === 'solar-imagery') title = 'About Solar Imagery Types';
            else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();

            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);

    const closeModal = useCallback(() => setModalState(null), []);

    const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true) => {
        setState({ url: isVideo ? '' : '/placeholder.png', loading: `Loading ${isVideo ? 'video' : 'image'}...` });
        try {
            const fetchUrl = addCacheBuster ? `${url}?_=${new Date().getTime()}` : url;
            const res = await fetch(fetchUrl);
            if (!res.ok) {
                console.error(`Failed to fetch ${fetchUrl}: HTTP ${res.status} ${res.statusText}`);
                throw new Error(`HTTP ${res.status} for ${url}`);
            }

            if (isVideo) {
                setState({ url: url, loading: null });
            } else {
                const blob = await res.blob();
                const objectURL = URL.createObjectURL(blob);
                setState({ url: objectURL, loading: null });
            }
            setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            setState({ url: isVideo ? '' : '/error.png', loading: `${isVideo ? 'Video' : 'Image'} failed to load. (Check proxy/network)` });
        }
    }, []);

    const fetchXrayFlux = useCallback(() => {
        setLoadingXray('Loading X-ray flux data...');
        fetch(`${NOAA_XRAY_FLUX_URL}?_=${new Date().getTime()}`).then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(rawData => {
                const groupedData = new Map();
                rawData.forEach((d: any) => { const time = new Date(d.time_tag).getTime(); if (!groupedData.has(time)) groupedData.set(time, { time, short: null }); if (d.energy === "0.1-0.8nm") groupedData.get(time).short = parseFloat(d.flux); });
                const processedData = Array.from(groupedData.values()).filter(d => d.short !== null && !isNaN(d.short)).sort((a,b) => a.time - b.time);
                
                if (!processedData.length) {
                    setLoadingXray('No valid X-ray data.');
                    setAllXrayData([]);
                    setLatestXrayFlux(null);
                    setCurrentXraySummary({ flux: null, class: 'N/A' }); // Update summary
                    previousLatestXrayFluxRef.current = null;
                    setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
                    return;
                }

                setAllXrayData(processedData);
                setLoadingXray(null);
                const latestFluxValue = processedData[processedData.length - 1].short;
                setLatestXrayFlux(latestFluxValue);
                setCurrentXraySummary({ flux: latestFluxValue, class: getXrayClass(latestFluxValue) }); // Update summary

                // --- Notification Logic for X-ray Flux ---
                const prevFlux = previousLatestXrayFluxRef.current;
                
                if (latestFluxValue !== null && prevFlux !== null) {
                    // M5+ Flare notification (5e-6 is M0.5, 5e-5 is M5)
                    if (latestFluxValue >= 5e-6 && prevFlux < 5e-6 && canSendNotification('flare-M5', 15 * 60 * 1000)) { // 15 min cooldown
                        sendNotification('Solar Flare Alert: M-Class!', `X-ray flux has reached M-class (>=M0.5)! Current flux: ${latestFluxValue.toExponential(2)}`);
                    } else if (latestFluxValue < 5e-6) {
                        clearNotificationCooldown('flare-M5');
                    }

                    // X1+ Flare notification
                    if (latestFluxValue >= 1e-4 && prevFlux < 1e-4 && canSendNotification('flare-X1', 30 * 60 * 1000)) { // 30 min cooldown
                        sendNotification('Solar Flare Alert: X-Class!', `X-ray flux has reached X-class (>=X1)! Current flux: ${latestFluxValue.toExponential(2)}`);
                    } else if (latestFluxValue < 1e-4) {
                        clearNotificationCooldown('flare-X1');
                    }
                }
                previousLatestXrayFluxRef.current = latestFluxValue;
                setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp

            }).catch(e => {
                console.error('Error fetching X-ray flux:', e);
                setLoadingXray(`Error: ${e.message}`);
                setLatestXrayFlux(null);
                setCurrentXraySummary({ flux: null, class: 'N/A' }); // Update summary
                previousLatestXrayFluxRef.current = null;
                setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
            });
    }, [setLatestXrayFlux]);

    const fetchProtonFlux = useCallback(() => {
        setLoadingProton('Loading proton flux data...');
        fetch(`${NOAA_PROTON_FLUX_URL}?_=${new Date().getTime()}`).then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(rawData => {
                // Filter for ">=10 MeV" and parse data
                const processedData = rawData
                    .filter((d: any) => d.energy === ">=10 MeV" && d.flux !== null && !isNaN(d.flux))
                    .map((d: any) => ({
                        time: new Date(d.time_tag).getTime(),
                        flux: parseFloat(d.flux)
                    }))
                    .sort((a: any, b: any) => a.time - b.time);

                if (!processedData.length) {
                    setLoadingProton('No valid >=10 MeV proton data.');
                    setAllProtonData([]);
                    setCurrentProtonSummary({ flux: null, class: 'N/A' }); // Update summary
                    previousLatestProtonFluxRef.current = null;
                    setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
                    return;
                }

                setAllProtonData(processedData);
                setLoadingProton(null);
                const latestFluxValue = processedData[processedData.length - 1].flux;
                setCurrentProtonSummary({ flux: latestFluxValue, class: getProtonClass(latestFluxValue) }); // Update summary

                // --- Notification Logic for Proton Flux (S-scale) ---
                const prevFlux = previousLatestProtonFluxRef.current;
                
                // Thresholds for S-levels (particles/(cm^2*s*sr) or pfu)
                const S1_THRESHOLD = 10;
                const S2_THRESHOLD = 100;
                const S3_THRESHOLD = 1000;
                // const S4_THRESHOLD = 10000; // Unused constant, removed for brevity
                // const S5_THRESHOLD = 100000; // Unused constant, removed for brevity

                if (latestFluxValue !== null && prevFlux !== null) {
                    // S1 Notification
                    if (latestFluxValue >= S1_THRESHOLD && prevFlux < S1_THRESHOLD && canSendNotification('proton-S1', 30 * 60 * 1000)) { // 30 min cooldown
                        sendNotification('Proton Event Alert: S1 Class!', `Proton flux (>=10 MeV) has reached S1 class (>=${S1_THRESHOLD} pfu)! Current flux: ${latestFluxValue.toFixed(2)} pfu.`);
                    } else if (latestFluxValue < S1_THRESHOLD) {
                        clearNotificationCooldown('proton-S1');
                    }
                    
                    // S3 Notification (or higher) - Can combine S2-S5 if desired, here for S3+
                    if (latestFluxValue >= S3_THRESHOLD && prevFlux < S3_THRESHOLD && canSendNotification('proton-S3', 60 * 60 * 1000)) { // 1 hour cooldown
                        sendNotification('Major Proton Event Alert: S3+ Class!', `Proton flux (>=10 MeV) has reached S3 class (>=${S3_THRESHOLD} pfu)! Current flux: ${latestFluxValue.toFixed(2)} pfu.`);
                    } else if (latestFluxValue < S3_THRESHOLD) { 
                        clearNotificationCooldown('proton-S3');
                    }
                }
                previousLatestProtonFluxRef.current = latestFluxValue;
                setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp

            }).catch(e => {
                console.error('Error fetching proton flux:', e);
                setLoadingProton(`Error: ${e.message}`);
                setCurrentProtonSummary({ flux: null, class: 'N/A' }); // Update summary
                previousLatestProtonFluxRef.current = null;
                setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
            });
    }, []);

    const fetchFlares = useCallback(async () => {
        setLoadingFlares('Loading solar flares...');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const startDate = yesterday.toISOString().split('T')[0];
        const endDate = new Date().toISOString().split('T')[0];
        
        try {
            const response = await fetch(`${NASA_DONKI_BASE_URL}FLR?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}&_=${new Date().getTime()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || data.length === 0) { 
                setLoadingFlares('No solar flares in the last 24 hours.'); 
                setSolarFlares([]); 
                setLatestRelevantEvent(prev => prev === null ? null : prev); // Don't overwrite if another event is newer
                setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
                return; 
            }
            const processedData = data.map((flare: any) => ({ ...flare, hasCME: flare.linkedEvents?.some((e: any) => e.activityID.includes('CME')) ?? false, }));
            const sortedFlares = processedData.sort((a: any, b: any) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime());
            setSolarFlares(sortedFlares);
            setLoadingFlares(null);

            // Update latestRelevantEvent if this flare is newer than current
            if (sortedFlares.length > 0) {
                const latestFlare = sortedFlares[0];
                const flareTime = new Date(latestFlare.peakTime).getTime();
                const currentEventTime = latestRelevantEvent ? new Date(latestRelevantEvent.split('@')[1]).getTime() : 0; // Crude time extraction
                
                if (flareTime > currentEventTime) {
                     setLatestRelevantEvent(`${latestFlare.classType} Flare at ${formatNZTimestamp(latestFlare.peakTime)}`);
                }
            }
            setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
        } catch (error) { 
            console.error('Error fetching flares:', error); 
            setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`); 
            setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ')); // Update timestamp
        }
    }, [apiKey, latestRelevantEvent]);

    // REMOVED: fetchInterplanetaryShockData function

    // Effect to update overall status when summaries change
    useEffect(() => {
        setOverallActivityStatus(getOverallActivityStatus(currentXraySummary.class || 'N/A', currentProtonSummary.class || 'N/A'));
    }, [currentXraySummary, currentProtonSummary]);


    useEffect(() => {
        const runAllUpdates = () => {
            fetchImage(SUVI_131_URL, setSuvi131);
            fetchImage(SUVI_304_URL, setSuvi304);
            fetchImage(SDO_HMI_BC_1024_URL, setSdoHmiBc1024);
            fetchImage(SDO_HMI_IF_1024_URL, setSdoHmiIf1024);
            fetchImage(SDO_AIA_193_2048_URL, setSdoAia193_2048);
            fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true);
            fetchXrayFlux();
            fetchProtonFlux();
            fetchFlares();
            // REMOVED: fetchInterplanetaryShockData from effect
        };
        runAllUpdates();
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
        // REMOVED: fetchInterplanetaryShockData from cleanup deps
        return () => clearInterval(interval);
    }, [fetchImage, fetchXrayFlux, fetchProtonFlux, fetchFlares]);

    const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - xrayTimeRange;
        
        const midnightAnnotations: any = {};
        const nzOffset = 12 * 3600000; 
        const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
        for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
            const midnight = new Date(d).setUTCHours(12,0,0,0);
            if (midnight > startTime && midnight < now) {
                midnightAnnotations[`midnight-${midnight}`] = { 
                    type: 'line', xMin: midnight, xMax: midnight, 
                    borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5], 
                    label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } } 
                };
            }
        }
        
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { 
                    label: (c: any) => `Flux: ${c.parsed.y.toExponential(2)} (${c.parsed.y >= 1e-4 ? 'X' : c.parsed.y >= 1e-5 ? 'M' : c.parsed.y >= 1e-6 ? 'C' : c.parsed.y >= 1e-7 ? 'B' : 'A'}-class)` 
                }}, 
                annotation: { annotations: midnightAnnotations } 
            },
            scales: { 
                x: { 
                    type: 'time', adapters: { date: { locale: enNZ } }, 
                    time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, 
                    min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, 
                    grid: { color: '#3f3f46' } 
                }, 
                y: { 
                    type: 'logarithmic', min: 1e-9, max: 1e-3, 
                    ticks: { 
                        color: '#71717a', 
                        callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } 
                    }, 
                    grid: { color: '#3f3f46' } 
                } 
            }
        };
    }, [xrayTimeRange]);
    
    const xrayChartData = useMemo(() => {
        if (allXrayData.length === 0) return { datasets: [] };
        return {
            datasets: [{
                label: 'Short Flux (0.1-0.8 nm)', 
                data: allXrayData.map(d => ({x: d.time, y: d.short})),
                pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                segment: { borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2), }
            }],
        };
    }, [allXrayData]);

    const protonChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - protonTimeRange;

        const midnightAnnotations: any = {};
        const nzOffset = 12 * 3600000; 
        const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
        for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
            const midnight = new Date(d).setUTCHours(12,0,0,0);
            if (midnight > startTime && midnight < now) {
                midnightAnnotations[`midnight-${midnight}`] = { 
                    type: 'line', xMin: midnight, xMax: midnight, 
                    borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5], 
                    label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } } 
                };
            }
        }
        
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { 
                    label: (c: any) => {
                        const flux = c.parsed.y;
                        let sClass = 'S0';
                        if (flux >= 100000) sClass = 'S5';
                        else if (flux >= 10000) sClass = 'S4';
                        else if (flux >= 1000) sClass = 'S3';
                        else if (flux >= 100) sClass = 'S2';
                        else if (flux >= 10) sClass = 'S1';
                        return `Flux: ${flux.toFixed(2)} pfu (${sClass}-class)`;
                    } 
                }}, 
                annotation: { annotations: midnightAnnotations } 
            },
            scales: { 
                x: { 
                    type: 'time', adapters: { date: { locale: enNZ } }, 
                    time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, 
                    min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, 
                    grid: { color: '#3f3f46' } 
                }, 
                y: { 
                    type: 'logarithmic',
                    min: 1e-4, // e.g., 0.0001 pfu to make very low background flux visible
                    max: 1000000, // 1,000,000 pfu
                    ticks: { 
                        color: '#71717a', 
                        callback: (value: any) => {
                            if (value === 100000) return 'S5';
                            if (value === 10000) return 'S4';
                            if (value === 1000) return 'S3';
                            if (value === 100) return 'S2';
                            if (value === 10) return 'S1';
                            if (value === 1) return 'S0';
                            if (value === 0.1 || value === 0.01 || value === 0.001 || value === 0.0001) return value.toString();
                            return null;
                        }
                    }, 
                    grid: { color: '#3f3f46' } 
                } 
            }
        };
    }, [protonTimeRange]);

    const protonChartData = useMemo(() => {
        if (allProtonData.length === 0) return { datasets: [] };
        return {
            datasets: [{
                label: 'Proton Flux (>=10 MeV)', 
                data: allProtonData.map(d => ({x: d.time, y: d.flux})),
                pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                segment: {
                    borderColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 1),
                    backgroundColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 0.2),
                }
            }],
        };
    }, [allProtonData]);
    
    return (
        <div
            className="w-full h-full bg-neutral-900 text-neutral-300 relative"
            style={{
                backgroundImage: `url('/background-solar.jpg')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundAttachment: 'fixed',
            }}
        >
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
                <div className="container mx-auto">
                    <header className="text-center mb-8">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-5">
                        {/* Dashboard Overview/Summary Section */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 mb-4 flex flex-col sm:flex-row justify-between items-center text-sm">
                            <div className="flex-1 text-center sm:text-left mb-2 sm:mb-0">
                                <h3 className="text-neutral-200 font-semibold mb-1">Current Status: <span className={`font-bold ${overallActivityStatus === 'Quiet' ? 'text-green-400' : overallActivityStatus === 'Moderate' ? 'text-yellow-400' : overallActivityStatus === 'High' ? 'text-orange-400' : 'text-red-500'}`}>{overallActivityStatus}</span></h3>
                                <p>X-ray Flux: <span className="font-mono text-cyan-300">{currentXraySummary.flux !== null ? currentXraySummary.flux.toExponential(2) : 'N/A'}</span> ({currentXraySummary.class || 'N/A'})</p>
                                <p>Proton Flux: <span className="font-mono text-yellow-400">{currentProtonSummary.flux !== null ? currentProtonSummary.flux.toFixed(2) : 'N/A'}</span> pfu ({currentProtonSummary.class || 'N/A'})</p>
                            </div>
                            <div className="flex-1 text-center sm:text-right">
                                <h3 className="text-neutral-200 font-semibold mb-1">Latest Event:</h3>
                                <p className="text-orange-300 italic">{latestRelevantEvent || 'No significant events recently.'}</p>
                            </div>
                        </div>

                        {/* Consolidated Solar Imagers Panel */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[550px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white mb-2">Solar Imagery</h2>
                                {/* Info button for the Solar Imagery section */}
                                <button onClick={() => openModal('solar-imagery')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Imagery types.">?</button>
                            </div>
                            <div className="flex justify-center gap-2 my-2 flex-wrap mb-4">
                                <button
                                    onClick={() => setActiveSunImage('SUVI_131')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_131' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                >
                                    SUVI 131Å
                                </button>
                                <button
                                    onClick={() => setActiveSunImage('SUVI_304')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_304' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                >
                                    SUVI 304Å
                                </button>
                                {/* SDO AIA 193Å (2048px) as the 3rd option, with no resolution in text */}
                                <button
                                    onClick={() => setActiveSunImage('SDO_AIA193_2048')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_AIA193_2048' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                >
                                    SDO AIA 193Å
                                </button>
                                {/* Remaining 1024px options for SDO, with no resolution in text */}
                                <button
                                    onClick={() => setActiveSunImage('SDO_HMIBC_1024')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIBC_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                >
                                    SDO HMI Cont.
                                </button>
                                <button
                                    onClick={() => setActiveSunImage('SDO_HMIIF_1024')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIIF_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                >
                                    SDO HMI Int.
                                </button>
                            </div>

                            {/* Conditional Rendering of the selected image */}
                            <div className="flex-grow flex justify-center items-center relative min-h-0">
                                {activeSunImage === 'SUVI_131' && (
                                    <div
                                        onClick={() => suvi131.url !== '/placeholder.png' && suvi131.url !== '/error.png' && setViewerMedia({ url: suvi131.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['suvi-131']}
                                    >
                                        <img src={suvi131.url} alt="SUVI 131Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {suvi131.loading && <LoadingSpinner message={suvi131.loading} />}
                                    </div>
                                )}
                                {activeSunImage === 'SUVI_304' && (
                                    <div
                                        onClick={() => suvi304.url !== '/placeholder.png' && suvi304.url !== '/error.png' && setViewerMedia({ url: suvi304.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['suvi-304']}
                                    >
                                        <img src={suvi304.url} alt="SUVI 304Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {suvi304.loading && <LoadingSpinner message={suvi304.loading} />}
                                    </div>
                                )}
                                {/* SDO 1024px & 2048px renders, with simplified alt text */}
                                {activeSunImage === 'SDO_AIA193_2048' && ( // This is now the 3rd option
                                    <div
                                        onClick={() => sdoAia193_2048.url !== '/placeholder.png' && sdoAia193_2048.url !== '/error.png' && setViewerMedia({ url: sdoAia193_2048.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['sdo-aia193-2048']}
                                    >
                                        <img src={sdoAia193_2048.url} alt="SDO AIA 193Å (Coronal Holes)" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {sdoAia193_2048.loading && <LoadingSpinner message={sdoAia193_2048.loading} />}
                                    </div>
                                )}
                                {activeSunImage === 'SDO_HMIBC_1024' && (
                                    <div
                                        onClick={() => sdoHmiBc1024.url !== '/placeholder.png' && sdoHmiBc1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiBc1024.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['sdo-hmibc-1024']}
                                    >
                                        <img src={sdoHmiBc1024.url} alt="SDO HMI Continuum" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {sdoHmiBc1024.loading && <LoadingSpinner message={sdoHmiBc1024.loading} />}
                                    </div>
                                )}
                                {activeSunImage === 'SDO_HMIIF_1024' && (
                                    <div
                                        onClick={() => sdoHmiIf1024.url !== '/placeholder.png' && sdoHmiIf1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiIf1024.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['sdo-hmiif-1024']}
                                    >
                                        <img src={sdoHmiIf1024.url} alt="SDO HMI Intensitygram" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {sdoHmiIf1024.loading && <LoadingSpinner message={sdoHmiIf1024.loading} />}
                                    </div>
                                )}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">
                                Last updated: {lastImagesUpdate || 'N/A'}
                            </div>
                        </div>

                        {/* GOES X-ray Flux Graph */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white mb-2">GOES X-ray Flux</h2>
                                <button onClick={() => openModal('xray-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about X-ray Flux.">?</button>
                            </div>
                            <TimeRangeButtons onSelect={setXrayTimeRange} selected={xrayTimeRange} />
                            <div className="flex-grow relative mt-2" title={tooltipContent['xray-flux']}>
                                {xrayChartData.datasets[0]?.data.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <LoadingSpinner message={loadingXray} />}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">
                                Last updated: {lastXrayUpdate || 'N/A'}
                            </div>
                        </div>

                        {/* Solar Flares (now full width) */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (24 Hrs)</h2>
                                <button onClick={() => openModal('solar-flares')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Flares.">?</button>
                            </div>
                            <ul className="space-y-2 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                                {loadingFlares ? <LoadingSpinner message={loadingFlares} />
                                : solarFlares.length > 0 ? solarFlares.map((flare) => {
                                    const { background, text } = getColorForFlareClass(flare.classType);
                                    const cmeHighlight = flare.hasCME ? 'border-sky-400 shadow-lg shadow-sky-500/10' : 'border-transparent';
                                    return ( <li key={flare.flareID} onClick={() => setSelectedFlare(flare)} className={`bg-neutral-800 p-2 rounded text-sm cursor-pointer transition-all hover:bg-neutral-700 border-2 ${cmeHighlight}`}> <div className="flex justify-between items-center"> <span> <strong className={`px-2 py-0.5 rounded ${text}`} style={{ backgroundColor: background }}>{flare.classType}</strong> <span className="ml-2">at {formatNZTimestamp(flare.peakTime)}</span> </span> {flare.hasCME && <span className="text-xs font-bold text-sky-400 animate-pulse">CME Event</span>} </div> </li> )}) 
                                : <li className="text-center text-neutral-400 italic">No recent flares found.</li>}
                            </ul>
                            <div className="text-right text-xs text-neutral-500 mt-2">
                                Last updated: {lastFlaresUpdate || 'N/A'}
                            </div>
                        </div>

                        {/* CCOR1 Video Panel (Now with its own info button) */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white text-center mb-4">CCOR1 Coronagraph Video</h2>
                                {/* Info button for CCOR1 video */}
                                <button onClick={() => openModal('ccor1-video')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about CCOR1 Coronagraph Video.">?</button>
                            </div>
                            <div
                                onClick={() => ccor1Video.url && setViewerMedia({ url: ccor1Video.url, type: 'video' })}
                                className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                title={tooltipContent['ccor1-video']}
                            >
                                {ccor1Video.loading && <LoadingSpinner message={ccor1Video.loading} />}
                                {ccor1Video.url && !ccor1Video.loading ? (
                                    <video controls muted loop className="max-w-full max-h-full object-contain rounded-lg">
                                        <source src={ccor1Video.url} type="video/mp4" />
                                        Your browser does not support the video tag.
                                    </video>
                                ) : (
                                    !ccor1Video.loading && <p className="text-neutral-400 italic">Video not available.</p>
                                )}
                            </div>
                        </div>

                        {/* GOES Proton Flux Graph */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white mb-2">GOES Proton Flux ({'>'}=10 MeV)</h2>
                                <button onClick={() => openModal('proton-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Proton Flux.">?</button>
                            </div>
                            <TimeRangeButtons onSelect={setProtonTimeRange} selected={protonTimeRange} />
                            <div className="flex-grow relative mt-2" title={tooltipContent['proton-flux']}>
                                {protonChartData.datasets[0]?.data.length > 0 ? <Line data={protonChartData} options={protonChartOptions} /> : <LoadingSpinner message={loadingProton} />}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">
                                Last updated: {lastProtonUpdate || 'N/A'}
                            </div>
                        </div>

                        {/* REMOVED: Interplanetary Shock Events Card */}

                    </main>
                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides real-time information on solar X-ray flux, proton flux, solar flares, and related space weather phenomena. Data is sourced directly from official NASA and NOAA APIs.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> Solar activity can be highly unpredictable. While this dashboard provides the latest available data, interpretations are for informational purposes only.</p>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a></p><p className="mt-2">Visualization and Development by TNR Protography</p></div>
                    </footer>
                 </div>
            </div>
            
            <InfoModal
                isOpen={!!selectedFlare}
                onClose={() => setSelectedFlare(null)}
                title={`Flare Details: ${selectedFlare?.flareID || ''}`}
                content={ selectedFlare && ( 
                    <div className="space-y-2"> 
                        <p><strong>Class:</strong> {selectedFlare.classType}</p> 
                        <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p> 
                        <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p> 
                        <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p> 
                        <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p> 
                        <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p> 
                        <p><strong>CME Associated:</strong> {selectedFlare.hasCME ? 'Yes' : 'No'}</p> 
                        <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p> 
                        {/* Button to view CME in Visualization */}
                        {selectedFlare.hasCME && (
                            <button
                                onClick={() => {
                                    // Find the linked CME activity ID
                                    const cmeId = selectedFlare.linkedEvents?.find((e: any) => e.activityType === 'CME')?.activityID;
                                    if (cmeId) {
                                        onViewCMEInVisualization(cmeId); // Changed prop name
                                        setSelectedFlare(null); // Close the flare details modal
                                    } else {
                                        alert("CME ID not found for this flare.");
                                    }
                                }}
                                className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-500 transition-colors"
                            >
                                View in CME Visualization {/* Changed button text */}
                            </button>
                        )}
                    </div> 
                )}
            />
            {modalState && (
                <InfoModal
                    isOpen={modalState.isOpen}
                    onClose={closeModal}
                    title={modalState.title}
                    content={modalState.content}
                />
            )}
        </div>
    );
};

export default SolarActivityDashboard;
// --- END OF FILE src/components/SolarActivityDashboard.tsx ---