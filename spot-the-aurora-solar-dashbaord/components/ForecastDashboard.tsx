import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import CloseIcon from './icons/CloseIcon';
import CaretIcon from './icons/CaretIcon';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import annotationPlugin from 'chartjs-plugin-annotation'; // Import the annotation plugin

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void; // NEW PROP
  setSubstormActivityStatus: (status: { text: string; color: string } | null) => void; // NEW PROP
}
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string; }

interface CelestialTimeData {
    moon?: { rise: number | null, set: number | null, illumination?: number };
    sun?: { rise: number | null, set: number | null };
}

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute

const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, maxExpected: 1000 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, maxExpected: 70 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200, maxExpected: 250 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, maxExpected: 60 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50, maxNegativeExpected: -60 }
};

const GAUGE_COLORS = {
    gray: { solid: 'rgb(128, 128, 128)', semi: 'rgba(128, 128, 128, 0.5)', trans: 'rgba(128, 128, 128, 0)' },
    yellow: { solid: 'rgb(255, 215, 0)', semi: 'rgba(255, 215, 0, 0.5)', trans: 'rgba(255, 215, 0, 0)' },
    orange: { solid: 'rgb(255, 165, 0)', semi: 'rgba(255, 165, 0, 0.5)', trans: 'rgba(255, 165, 0, 0)' },
    red: { solid: 'rgb(255, 69, 0)', semi: 'rgba(255, 69, 0, 0.5)', trans: 'rgba(255, 69, 0, 0)' },
    purple: { solid: 'rgb(128, 0, 128)', semi: 'rgba(128, 0, 128, 0.5)', trans: 'rgba(128, 0, 128, 0)' },
    pink: { solid: 'rgb(255, 20, 147)', semi: 'rgba(255, 20, 147, 0.5)', trans: 'rgba(255, 20, 147, 0)' }
};

const GAUGE_EMOJIS = { gray: '😐', yellow: '🙂', orange: '😊', red: '😀', purple: '😍', pink: '🤩', error: '❓' };

const getPositiveScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value >= thresholds.purple) return 'purple';
    if (value >= thresholds.red) return 'red';
    if (value >= thresholds.orange) return 'orange';
    if (value >= thresholds.yellow) return 'yellow';
    return 'gray';
};

const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
    if (score >= 80) return 'pink';
    if (score >= 50) return 'red';
    if (score >= 40) return 'orange';
    if (score >= 25) return 'yellow';
    if (score >= 10) return 'gray';
    return 'gray';
};

const getBzScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value <= thresholds.purple) return 'purple';
    if (value <= thresholds.red) return 'red';
    if (value <= thresholds.orange) return 'orange';
    if (value <= thresholds.yellow) return 'yellow';
    return 'gray';
};

const createGradient = (ctx: CanvasRenderingContext2D, chartArea: any, colorKey: keyof typeof GAUGE_COLORS) => {
    if (!chartArea) return;
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, GAUGE_COLORS[colorKey].semi);
    gradient.addColorStop(1, GAUGE_COLORS[colorKey].trans);
    return gradient;
};

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
};

const TimeRangeButtons: React.FC<{ onSelect: (duration: number, label: string) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '3 Hr', hours: 3 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
    return (
        <div className="flex justify-center gap-2 my-2 flex-wrap">
            {timeRanges.map(({ label, hours }) => (
                <button key={hours} onClick={() => onSelect(hours * 3600000, label)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
                    {label}
                </button>
            ))}
        </div>
    );
};

const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
    if (isDaylight) {
        return {
            overall: "The sun is currently up. It is not possible to photograph the aurora during daylight hours.",
            phone: { android: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["Enjoy the sunshine!"], cons: ["Aurora is not visible."] }, apple: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["Enjoy the sunshine!"], cons: ["Aurora is not visible."] } },
            dslr: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["A great time for landscape photos."], cons: ["Aurora is not visible."] }
        };
    }
    let baseSettings: any;
    if (score === null || score < 10) { 
        baseSettings = { 
            overall: "Very low activity expected. It's highly unlikely to capture the aurora with any camera. These settings are for extreme attempts.", 
            phone: { 
                android: { 
                    iso: "3200-6400 (Max)", 
                    shutter: "20-30s", 
                    aperture: "Lowest f-number", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Might pick up an extremely faint, indiscernible glow."], 
                    cons: ["Very high noise, significant star trails, motion blur, unlikely to see anything substantial. Results may just be faint light pollution."], 
                }, 
                apple: { 
                    iso: "Auto (max Night Mode)", 
                    shutter: "Longest Night Mode auto-exposure (10-30s)", 
                    aperture: "N/A (fixed)", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Simple to try with Night Mode."], 
                    cons: ["Limited control, very high noise, very unlikely to yield any recognizable aurora."], 
                }, 
            }, 
            dslr: { 
                iso: "6400-12800", 
                shutter: "20-30s", 
                aperture: "f/2.8-f/4 (widest)", 
                focus: "Manual to Infinity", 
                wb: "3500K-4500K", 
                pros: ["Maximizes light gathering for extremely faint conditions."], 
                cons: ["Extremely high ISO noise will be very apparent.", "Long exposure causes star trails."], 
            }, 
        };
    } else if (score < 20) {
         baseSettings = { 
            overall: "Minimal activity expected. A DSLR/Mirrorless camera might capture a faint glow, but phones will likely struggle.", 
            phone: { 
                android: { 
                    iso: "3200-6400 (Max)", 
                    shutter: "15-30s", 
                    aperture: "Lowest f-number", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Might detect very faint light not visible to the eye."], 
                    cons: ["High noise, long exposures lead to star trails. Aurora may be indiscernible."], 
                }, 
                apple: { 
                    iso: "Auto (max Night Mode)", 
                    shutter: "Longest Night Mode auto-exposure (10-30s)", 
                    aperture: "N/A (fixed)", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Simple to attempt using Night Mode."], 
                    cons: ["Limited control, very high noise, very unlikely to yield any recognizable aurora."], 
                }, 
            }, 
            dslr: { 
                iso: "3200-6400", 
                shutter: "15-25s", 
                aperture: "f/2.8-f/4 (widest)", 
                focus: "Manual to Infinity", 
                wb: "3500K-4500K", 
                pros: ["Better light gathering than phones, higher chance for a faint detection."], 
                cons: ["High ISO can introduce significant noise.", "Long exposure causes star trails."], 
            }, 
        };
    } else if (score >= 80) {
        baseSettings = { 
            overall: "High probability of a bright, active aurora! Aim for shorter exposures to capture detail and movement.", 
            phone: { 
                android: { 
                    iso: "400-800", 
                    shutter: "1-5s", 
                    aperture: "Lowest f-number", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Captures dynamic movement with less blur.", "Lower noise.", "Vibrant colors."], 
                    cons: ["May still struggle with extreme brightness or very fast movement."], 
                }, 
                apple: { 
                    iso: "Auto or 500-1500 (in third-party app)", 
                    shutter: "1-3s (or what auto-selects)", 
                    aperture: "N/A (fixed)", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Quick results, good for dynamic displays.", "Built-in processing handles noise well."], 
                    cons: ["Less manual control than Android Pro mode for precise settings."], 
                }, 
            }, 
            dslr: { 
                iso: "800-1600", 
                shutter: "1-5s", 
                aperture: "f/2.8 (or your widest)", 
                focus: "Manual to Infinity", 
                wb: "3500K-4500K", 
                pros: ["Stunning detail, vibrant colors.", "Can capture movement without blur.", "Minimal noise."], 
                cons: ["May need quick adjustments for fluctuating brightness."], 
            }, 
        };
    } else {
        baseSettings = { 
            overall: "Moderate activity expected. Good chance for visible aurora. Balance light capture with motion.", 
            phone: { 
                android: { 
                    iso: "800-1600", 
                    shutter: "5-10s", 
                    aperture: "Lowest f-number", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Better detail and color than faint conditions.", "Less motion blur than very long exposures."], 
                    cons: ["Still limited dynamic range compared to DSLR."], 
                }, 
                apple: { 
                    iso: "Auto (let it choose), or 1000-2000 (in manual app)", 
                    shutter: "3-7s (or what auto selects)", 
                    aperture: "N/A (fixed)", 
                    focus: "Infinity", 
                    wb: "Auto or 3500K-4000K", 
                    pros: ["Good balance, easier to get usable shots.", "Built-in processing helps with noise."], 
                    cons: ["Less control over very fast-moving aurora."], 
                }, 
            }, 
            dslr: { 
                iso: "1600-3200", 
                shutter: "5-15s", 
                aperture: "f/2.8-f/4 (widest)", 
                focus: "Manual to Infinity", 
                wb: "3500K-4500K", 
                pros: ["Excellent detail, good color, less noise than faint settings.", "Good for capturing movement."], 
                cons: ["Can still get light pollution if exposure is too long."], 
            }, 
        };
    }
    return baseSettings;
};


const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus }) => { // ADDED setCurrentAuroraScore, setSubstormActivityStatus
    const [isLoading, setIsLoading] = useState(true);
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({ power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, });
    
    const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
    const [isDaylight, setIsDaylight] = useState(false);
    const [allPlasmaData, setAllPlasmaData] = useState<any[]>([]);
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    const [goes18Data, setGoes18Data] = useState<any[]>([]);
    const [goes19Data, setGoes19Data] = useState<any[]>([]);
    const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
    const [substormBlurb, setSubstormBlurb] = useState<{ text: string; color: string }>({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
    
    const [solarWindChartData, setSolarWindChartData] = useState<any>({ datasets: [] });
    const [magneticFieldChartData, setMagneticFieldChartData] = useState<any>({ datasets: [] });
    
    const [solarWindTimeRange, setSolarWindTimeRange] = useState<number>(6 * 3600000);
    const [solarWindTimeLabel, setSolarWindTimeLabel] = useState<string>('6 Hr');
    const [magneticFieldTimeRange, setMagneticFieldTimeRange] = useState<number>(6 * 3600000);
    const [magneticFieldTimeLabel, setMagneticFieldTimeLabel] = useState<string>('6 Hr');
    const [magnetometerTimeRange, setMagnetometerTimeRange] = useState<number>(3 * 3600000);
    const [magnetometerTimeLabel, setMagnetometerTimeLabel] = useState<string>('3 Hr');
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null); // Changed content to string
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');

    const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
    const [isTipsOpen, setIsTipsOpen] = useState(false);
    const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
    const [auroraScoreChartTimeRange, setAuroraScoreChartTimeRange] = useState<number>(6 * 3600000);
    const [auroraScoreChartTimeLabel, setAuroraScoreChartTimeLabel] = useState<string>('6 Hr');

    const tooltipContent = {
        'forecast': `This is a proprietary TNR Protography forecast that combines live solar wind data with local conditions like lunar phase and astronomical darkness. It is highly accurate for the next 2 hours. Remember, patience is key and always look south! <br><br><strong>What the Percentage Means:</strong><ul><li><strong>< 10% 😞:</strong> Little to no auroral activity.</li><li><strong>10-25% 😐:</strong> Minimal activity; cameras may detect a faint glow.</li></li><li><strong>25-40% 😊:</strong> Clear activity on camera; a faint naked-eye glow is possible.</li><li><strong>40-50% 🙂:</strong> Faint naked-eye aurora likely, maybe with color.</li><li><strong>50-80% 😀:</strong> Good chance of naked-eye color and structure.</li><li><strong>80%+ 🤩:</strong> High probability of a significant substorm.</li></ul>`,
        'power': `<strong>What it is:</strong> The total energy being deposited by the solar wind into an entire hemisphere (North or South), measured in Gigawatts (GW).<br><br><strong>Effect on Aurora:</strong> Think of this as the aurora's overall brightness level. Higher power means more energy is available for a brighter and more widespread display.`,
        'speed': `<strong>What it is:</strong> The speed of the charged particles flowing from the Sun, measured in kilometers per second (km/s).<br><br><strong>Effect on Aurora:</strong> Faster particles hit Earth's magnetic field with more energy, leading to more dynamic and vibrant auroras with faster-moving structures.`,
        'density': `<strong>What it is:</strong> The number of particles within a cubic centimeter of the solar wind, measured in protons per cm³. Higher density means more particles are available to collide with our atmosphere, resulting in more widespread and "thick" looking auroral displays.`,
        'bt': `<strong>What it is:</strong> The total strength of the Interplanetary Magnetic Field (IMF), measured in nanoteslas (nT).<br><br><strong>Effect on Aurora:</strong> A high Bt value indicates a strong magnetic field. While not a guarantee on its own, a strong field can carry more energy and lead to powerful events if the Bz is also favorable.`,
        'bz': `<strong>What it is:</strong> The North-South direction of the Interplanetary Magnetic Field (IMF), measured in nanoteslas (nT). This is the most critical component.<br><br><strong>Effect on Aurora:</strong> Think of Bz as the "gatekeeper." When Bz is strongly <strong>negative (south)</strong>, it opens a gateway for solar wind energy to pour in. A positive Bz closes this gate. <strong>The more negative, the better!</strong>`,
        'epam': `<strong>What it is:</strong> The Electron, Proton, and Alpha Monitor (EPAM) on the ACE spacecraft measures energetic particles from the sun.<br><br><strong>Effect on Aurora:</strong> This is not a direct aurora indicator. However, a sharp, sudden, and simultaneous rise across all energy levels can be a key indicator of an approaching CME shock front, which often precedes major auroral storms.`,
        'moon': `<strong>What it is:</strong> The percentage of the moon that is illuminated by the Sun.<br><br><strong>Effect on Aurora:</strong> A bright moon (high illumination) acts like natural light pollution, washing out fainter auroral displays. A low illumination (New Moon) provides the darkest skies, making it much easier to see the aurora.`,
        'solar-wind-graph': `This chart shows two key components of the solar wind. The colors change based on the intensity of the readings.<br><br><ul class="list-disc list-inside space-y-2"><li><strong style="color:rgb(128, 128, 128)">Gray:</strong> Quiet conditions.</li><li><strong style="color:rgb(255,215,0)">Yellow:</strong> Elevated conditions.</li><li><strong style="color:rgb(255,165,0)">Orange:</strong> Moderate conditions.</li><li><strong style="color:rgb(255,69,0)">Red:</strong> Strong conditions.</li><li><strong style="color:rgb(128,0,128)">Purple:</strong> Severe conditions.</li></ul>`,
        'imf-graph': `This chart shows the total strength (Bt) and North-South direction (Bz) of the Interplanetary Magnetic Field. A strong and negative Bz is crucial for auroras.<br><br>The colors change based on intensity:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong style="color:rgb(128, 128, 128)">Gray:</strong> Quiet conditions.</li><li><strong style="color:rgb(255,215,0)">Yellow:</strong> Moderately favorable conditions.</li><li><strong style="color:rgb(255,165,0)">Orange:</strong> Favorable conditions.</li><li><strong style="color:rgb(255,69,0)">Red:</strong> Very favorable/strong conditions.</li><li><strong style="color:rgb(128,0,128)">Purple:</strong> Extremely favorable/severe conditions.</li></ul>`,
        'goes-mag': `<div><p>This graph shows the <strong>Hp component</strong> of the magnetic field, measured by GOES satellites in geosynchronous orbit. It's one of the best indicators for an imminent substorm.</p><br><p><strong>How to read it:</strong></p><ul class="list-disc list-inside space-y-2 mt-2"><li><strong class="text-yellow-400">Growth Phase:</strong> When energy is building up, the magnetic field stretches out like a rubber band. This causes a slow, steady <strong>drop</strong> in the Hp value over 1-2 hours.</li><li><strong class="text-green-400">Substorm Eruption:</strong> When the field snaps back, it causes a sharp, sudden <strong>jump</strong> in the Hp value (called a "dipolarization"). This is the aurora flaring up brightly!</li></li></ul><br><p>By watching for the drop, you can anticipate the jump.</p></div>`,
    };
    
    const openModal = useCallback((id: string) => { 
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'forecast') title = 'About The Forecast Score';
            else if (id === 'solar-wind-graph') title = 'About The Solar Wind Graph';
            else if (id === 'imf-graph') title = 'About The IMF Graph';
            else if (id === 'goes-mag') title = 'GOES Magnetometer (Hp)';
            else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim(); // Generic title for other gauges
            
            setModalState({ isOpen: true, title: title, content: contentData }); 
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);
    const formatNZTimestamp = (timestamp: number) => { try { const d = new Date(timestamp); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } };
    const getAuroraEmoji = (s: number | null) => { if (s === null) return GAUGE_EMOJIS.error; if (s < 10) return '😞'; if (s < 25) return '😐'; if (s < 40) return '😊'; if (s < 50) return '🙂'; if (s < 80) return '😀'; return '🤩'; };
    
    const getGaugeStyle = useCallback((v: number | null, type: keyof typeof GAUGE_THRESHOLDS) => {
        if (v == null || isNaN(v)) return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.error, percentage: 0 };
        let key: keyof typeof GAUGE_COLORS = 'gray'; let percentage = 0;
        if (type === 'bz') { key = getBzScaleColorKey(v, GAUGE_THRESHOLDS.bz); percentage = v < 0 ? Math.min(100, Math.abs(v / GAUGE_THRESHOLDS.bz.maxNegativeExpected) * 100) : 0; }
        else { const thresholds = GAUGE_THRESHOLDS[type as 'speed' | 'density' | 'bt' | 'power']; key = getPositiveScaleColorKey(v, thresholds); percentage = Math.min(100, (v / thresholds.maxExpected) * 100); }
        return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
    }, []);

    const analyzeMagnetometerData = (data: any[]) => {
        if (data.length < 30) {
            setSubstormBlurb({ text: 'Awaiting more magnetic field data...', color: 'text-neutral-500' });
            setSubstormActivityStatus({ text: 'Awaiting more magnetic field data...', color: 'text-neutral-500' }); // NEW: Pass to App
            return;
        }
        // Get the latest point from the end of the sorted array
        const latestPoint = data[data.length - 1];
        // Find points approximately 10 minutes and 1 hour ago
        const tenMinAgoPoint = data.find((p:any) => p.time >= latestPoint.time - 10 * 60 * 1000);
        const oneHourAgoPoint = data.find((p:any) => p.time >= latestPoint.time - 60 * 60 * 1000);

        if (!latestPoint || !tenMinAgoPoint || !oneHourAgoPoint || isNaN(latestPoint.hp) || isNaN(tenMinAgoPoint.hp) || isNaN(oneHourAgoPoint.hp)) {
            setSubstormBlurb({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
            setSubstormActivityStatus({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' }); // NEW: Pass to App
            return;
        }

        const jump = latestPoint.hp - tenMinAgoPoint.hp;
        const drop = latestPoint.hp - oneHourAgoPoint.hp;

        console.log('Magnetometer Analysis:', {latestHp: latestPoint.hp, tenMinAgoHp: tenMinAgoPoint.hp, oneHourAgoHp: oneHourAgoPoint.hp, jump, drop});


        if (jump > 20) { // Sharp positive jump indicates dipolarization
            const eruptionTime = new Date(latestPoint.time).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
            const status = { text: `Substorm signature detected at ${eruptionTime}! A sharp field increase suggests a recent or ongoing eruption. Look south!`, color: 'text-green-400 font-bold animate-pulse' };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status); // NEW: Pass to App
        } else if (drop < -15) { // Significant drop over 1 hour indicates stretching
            const status = { text: 'The magnetic field is stretching, storing energy. Conditions are favorable for a potential substorm.', color: 'text-yellow-400' };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status); // NEW: Pass to App
        } else { // Stable
            const status = { text: 'The magnetic field appears stable. No immediate signs of substorm development.', color: 'text-neutral-400' };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status); // NEW: Pass to App
        }
    };

    // Helper to generate annotations based on GOES-18 data for highlighting
    const getMagnetometerAnnotations = useCallback((data: any[]) => {
        const annotations: any = {};
        if (data.length < 60) return annotations; // Need at least an hour of data to analyze trends

        const getSegmentAnalysis = (startIndex: number, endIndex: number) => {
            if (startIndex >= endIndex || endIndex >= data.length) return null;
            const startPoint = data[startIndex];
            const endPoint = data[endIndex];
            if (!startPoint || !endPoint || isNaN(startPoint.hp) || isNaN(endPoint.hp)) return null;

            const hpChange = endPoint.hp - startPoint.hp;
            const durationMinutes = (endPoint.time - startPoint.time) / (60 * 1000);

            if (durationMinutes < 10) return null; // Only consider segments of reasonable duration

            if (hpChange > 20) { // Sharp positive jump indicates substorm
                return { type: 'substorm', xMin: startPoint.time, xMax: endPoint.time }; // Remove label here
            } else if (hpChange < -15 && durationMinutes > 30) { // Steady drop over significant period indicates stretching
                return { type: 'stretching', xMin: startPoint.time, xMax: endPoint.time }; // Remove label here
            }
            return null;
        };

        // Simplified segment analysis for annotations
        // We look for significant changes over rolling windows
        const windowSizeMinutes = 10; // Check for jumps over 10 minutes
        const trendWindowMinutes = 60; // Check for drops over 60 minutes

        for (let i = 0; i < data.length; i++) {
            const currentPoint = data[i];

            // Check for substorm (sharp jump) in a 10-minute window
            const tenMinAgoIndex = data.findIndex(p => p.time >= currentPoint.time - windowSizeMinutes * 60 * 1000);
            if (tenMinAgoIndex !== -1 && tenMinAgoIndex < i) {
                const jumpAnalysis = getSegmentAnalysis(tenMinAgoIndex, i);
                if (jumpAnalysis && jumpAnalysis.type === 'substorm') {
                    // Extend the highlight slightly after the event, or make it appear immediately
                    const highlightEnd = currentPoint.time + 5 * 60 * 1000; // Extend 5 mins past the jump detection
                    annotations[`substorm-${currentPoint.time}`] = {
                        type: 'box',
                        xMin: jumpAnalysis.xMin,
                        xMax: highlightEnd,
                        backgroundColor: 'rgba(34, 197, 94, 0.2)', // Green for substorm
                        borderColor: 'transparent',
                        borderWidth: 0,
                        drawTime: 'beforeDatasetsDraw',
                        label: { // Label now hidden
                            content: 'SUBSTORM!',
                            display: false, // Set to false to hide label on graph
                            position: 'center',
                        }
                    };
                }
            }

            // Check for stretching (steady drop) in a 60-minute window
            const oneHourAgoIndex = data.findIndex(p => p.time >= currentPoint.time - trendWindowMinutes * 60 * 1000);
            if (oneHourAgoIndex !== -1 && oneHourAgoIndex < i) {
                const stretchAnalysis = getSegmentAnalysis(oneHourAgoIndex, i);
                if (stretchAnalysis && stretchAnalysis.type === 'stretching') {
                     // Ensure stretching doesn't overlap with a recent substorm marker
                    const recentSubstormOverlap = Object.values(annotations).some((ann: any) =>
                        ann.type === 'box' && ann.label?.content === 'SUBSTORM!' && // Check by label content for safety
                        Math.max(stretchAnalysis.xMin, ann.xMin) < Math.min(stretchAnalysis.xMax, ann.xMax) // Check for overlap
                    );

                    if (!recentSubstormOverlap) {
                        annotations[`stretching-${currentPoint.time}`] = {
                            type: 'box',
                            xMin: stretchAnalysis.xMin,
                            xMax: stretchAnalysis.xMax,
                            backgroundColor: 'rgba(255, 215, 0, 0.1)', // Yellow for stretching, lighter
                            borderColor: 'transparent',
                            borderWidth: 0,
                            drawTime: 'beforeDatasetsDraw',
                            label: { // Label now hidden
                                content: 'STRETCHING',
                                display: false, // Set to false to hide label on graph
                                position: 'center',
                            }
                        };
                    }
                }
            }
        }
        return annotations;
    }, []);
    
    const fetchAllData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);
        const results = await Promise.allSettled([
            fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        ]);
        const [forecastResult, plasmaResult, magResult, goes18Result, goes19Result] = results;

        if (forecastResult.status === 'fulfilled' && forecastResult.value) {
            const { currentForecast, historicalData } = forecastResult.value;
            setCelestialTimes({ moon: currentForecast?.moon, sun: currentForecast?.sun });
            const currentScore = currentForecast?.spotTheAuroraForecast ?? null;
            setAuroraScore(currentScore);
            setCurrentAuroraScore(currentScore); // NEW: Pass to App
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
            setAuroraBlurb(getAuroraBlurb(currentScore ?? 0));
            const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
            setGaugeData(prev => ({...prev, power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt ?? null, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz ?? null, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null) }));
            if (Array.isArray(historicalData)) { setAuroraScoreHistory(historicalData.filter((d: any) => typeof d.timestamp === 'number' && typeof d.baseScore === 'number' && typeof d.finalScore === 'number').sort((a, b) => a.timestamp - b.timestamp)); } else { setAuroraScoreHistory([]); }
        } else {
            console.error("Forecast data failed to load:", forecastResult.reason);
            setAuroraBlurb("Could not load forecast data.");
            setAuroraScoreHistory([]);
            setCurrentAuroraScore(null); // NEW: Clear score on error
        }

        if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
            const plasmaData = plasmaResult.value; const plasmaHeaders = plasmaData[0]; const speedIdx = plasmaHeaders.indexOf('speed'); const densityIdx = plasmaHeaders.indexOf('density'); const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
            const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r?.[speedIdx]) > -9999); const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null; const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null; const rawPlasmaTime = latestPlasmaRow?.[plasmaTimeIdx]; const plasmaTimestamp = rawPlasmaTime ? new Date(rawPlasmaTime.replace(' ', 'T') + 'Z').getTime() : Date.now();
            setGaugeData(prev => ({...prev, speed: {...prev.speed, value: speedVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}`}, density: {...prev.density, value: densityVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}`}}));
            setAllPlasmaData(plasmaData.slice(1).map((r:any[]) => { const rawTime = r[plasmaTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null, density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null }}));
        } else { console.error("Plasma data failed to load:", plasmaResult.reason); setAllPlasmaData([]); }

        if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
            const magData = magResult.value; const magHeaders = magData[0]; const magBtIdx = magHeaders.indexOf('bt'); const magBzIdx = magHeaders.indexOf('bz_gsm'); const magTimeIdx = magHeaders.indexOf('time_tag');
            setAllMagneticData(magData.slice(1).map((r: any[]) => { const rawTime = r[magTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, bt: parseFloat(r[magBtIdx]) > -9999 ? parseFloat(r[magBtIdx]) : null, bz: parseFloat(r[magBzIdx]) > -9999 ? parseFloat(r[magBzIdx]) : null }; }));
        } else { console.error("Magnetic data failed to load:", magResult.reason); setAllMagneticData([]); }

        let anyGoesDataFound = false; // Flag to track if any valid GOES data was found

        // --- GOES Data Processing (Primary - GOES-18) ---
        if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
            console.log('GOES-18 Raw Data (last 5):', goes18Result.value.slice(-5));
            const processedData18 = goes18Result.value
                .filter((d: any) => d.Hp != null && typeof d.Hp === 'number' && !isNaN(d.Hp)) // Corrected: access d.Hp (capital H), filter for number & not NaN
                .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })) // Map d.Hp (capital H)
                .sort((a, b) => a.time - b.time);
            setGoes18Data(processedData18);
            analyzeMagnetometerData(processedData18); // Analyze based on primary satellite
            console.log('GOES-18 Processed Data (first 5):', processedData18.slice(0, 5));
            console.log('GOES-18 Processed Data Count:', processedData18.length);
            if (processedData18.length > 0) {
                anyGoesDataFound = true;
            } else {
                console.warn('GOES-18: No valid Hp data points after filtering.');
            }
        } else {
            console.error('GOES-18 Fetch Failed:', goes18Result.reason || 'Unknown error');
            setGoes18Data([]);
        }

        // --- GOES Data Processing (Secondary - GOES-19) ---
        if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
            console.log('GOES-19 Raw Data (last 5):', goes19Result.value.slice(-5));
            const processedData19 = goes19Result.value
                .filter((d: any) => d.Hp != null && typeof d.Hp === 'number' && !isNaN(d.Hp)) // Corrected: access d.Hp (capital H), filter for number & not NaN
                .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })) // Map d.Hp (capital H)
                .sort((a, b) => a.time - b.time);
            setGoes19Data(processedData19);
            console.log('GOES-19 Processed Data (first 5):', processedData19.slice(0, 5));
            console.log('GOES-19 Processed Data Count:', processedData19.length);
            if (processedData19.length > 0) {
                anyGoesDataFound = true;
            } else {
                console.warn('GOES-19: No valid Hp data points after filtering.');
            }
        } else {
            console.error('GOES-19 Fetch Failed:', goes19Result.reason || 'Unknown error');
        }
        
        // Update loadingMagnetometer status based on overall GOES data availability
        if (!anyGoesDataFound) {
             setLoadingMagnetometer('No valid GOES Magnetometer data available from either satellite for this period.');
        } else {
            setLoadingMagnetometer(null); // Clear loading message if any data was found
        }
        
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (isInitialLoad) setIsLoading(false);
    }, [getGaugeStyle, setCurrentAuroraScore, setSubstormActivityStatus]); // ADDED dependencies

    useEffect(() => { fetchAllData(true); const interval = setInterval(() => fetchAllData(false), REFRESH_INTERVAL_MS); return () => clearInterval(interval); }, [fetchAllData]);
    useEffect(() => { const now = Date.now(); const sunrise = celestialTimes.sun?.rise; const sunset = celestialTimes.sun?.set; if (sunrise && sunset) { if (sunrise < sunset) setIsDaylight(now > sunrise && now < sunset); else setIsDaylight(now > sunrise || now < sunset); } else setIsDaylight(false); }, [celestialTimes, lastUpdated]);

    const getAuroraBlurb = (score: number) => { if (score < 10) return 'Little to no auroral activity.'; if (score < 25) return 'Minimal auroral activity likely.'; if (score < 40) return 'Clear auroral activity visible in cameras.'; if (score < 50) return 'Faint naked-eye aurora likely, maybe with color.'; if (score < 80) return 'Good chance of naked-eye color and structure.'; return 'High probability of a significant substorm.'; };
    const getMoonData = (illumination: number | null, riseTime: number | null, setTime: number | null) => { const moonIllumination = Math.max(0, (illumination ?? 0) ); let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒'; const riseStr = riseTime ? new Date(riseTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A'; const setStr = setTime ? new Date(setTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A'; const caretSvgPath = `M19.5 8.25l-7.5 7.5-7.5-7.5`; const CaretUpSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle" style="transform: rotate(180deg);"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`; const CaretDownSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`; const displayValue = `<span class="text-xl">${moonIllumination.toFixed(0)}%</span><br/><span class='text-xs'>${CaretUpSvg} ${riseStr}   ${CaretDownSvg} ${setStr}</span>`; return { value: displayValue, unit: '', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(Date.now())}`, color: '#A9A9A9' }; };
    
    useEffect(() => { const lineTension = (range: number) => range >= (12 * 3600000) ? 0.1 : 0.3; if (allPlasmaData.length > 0) { setSolarWindChartData({ datasets: [ { label: 'Speed', data: allPlasmaData.map(p => ({ x: p.time, y: p.speed })), yAxisID: 'y', order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(solarWindTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)), } }, { label: 'Density', data: allPlasmaData.map(p => ({ x: p.time, y: p.density })), yAxisID: 'y1', order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(solarWindTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)), } } ] }); } if (allMagneticData.length > 0) { setMagneticFieldChartData({ datasets: [ { label: 'Bt', data: allMagneticData.map(p => ({ x: p.time, y: p.bt })), order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(magneticFieldTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)), } }, { label: 'Bz', data: allMagneticData.map(p => ({ x: p.time, y: p.bz })), order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(magneticFieldTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)), } } ] }); } }, [allPlasmaData, allMagneticData, solarWindTimeRange, magneticFieldTimeRange]);

    const createChartOptions = useCallback((rangeMs: number, isDualAxis: boolean, yLabel: string, showLegend: boolean = false, extraAnnotations?: any): ChartOptions<'line'> => { // Changed extraPlugins to extraAnnotations
        const now = Date.now(); const startTime = now - rangeMs; const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' }, plugins: { legend: { display: showLegend, labels: {color: '#a1a1aa'} }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } } } };
        if (isDualAxis) options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' } }, y1: { type: 'linear', position: 'right', ticks: { color: '#a3a3a3' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Density (p/cm³)', color: '#a3a3a3' } } };
        else options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: yLabel, color: '#a3a3a3' } } };

        // Add annotations to plugins if provided
        if (extraAnnotations) { // Use extraAnnotations
            options.plugins = {
                ...options.plugins,
                annotation: { annotations: extraAnnotations }
            };
        }

        return options;
    }, []);
    
    const solarWindOptions = useMemo(() => createChartOptions(solarWindTimeRange, true, '', false), [solarWindTimeRange, createChartOptions]);
    const magneticFieldOptions = useMemo(() => createChartOptions(magneticFieldTimeRange, false, 'Magnetic Field (nT)', false), [magneticFieldTimeRange, createChartOptions]);
    
    // Pass annotations to magnetometer options
    const magnetometerAnnotations = useMemo(() => getMagnetometerAnnotations(goes18Data), [goes18Data, getMagnetometerAnnotations]);
    const magnetometerOptions = useMemo(() => createChartOptions(magnetometerTimeRange, false, 'Hp (nT)', true, magnetometerAnnotations), [magnetometerTimeRange, createChartOptions, magnetometerAnnotations]);

    const magnetometerChartData = useMemo(() => ({ datasets: [ { label: 'GOES-18 (Primary)', data: goes18Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(56, 189, 248)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false }, { label: 'GOES-19 (Secondary)', data: goes19Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(255, 69, 0)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false } ] }), [goes18Data, goes19Data]);
    
    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);
    const auroraScoreChartOptions = useMemo((): ChartOptions<'line'> => { const now = Date.now(); const startTime = now - auroraScoreChartTimeRange; const annotations: any = {}; const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase(); const addAnnotation = (key: string, timestamp: number | null | undefined, text: string, emoji: string, color: string, position: 'start' | 'end') => { if (timestamp && timestamp > startTime && timestamp < now) { annotations[key] = { type: 'line', xMin: timestamp, xMax: timestamp, borderColor: color.replace(/, 1\)/, ', 0.7)'), borderWidth: 1.5, borderDash: [6, 6], label: { content: `${emoji} ${text}: ${formatTime(timestamp)}`, display: true, position, color, font: { size: 10, weight: 'bold' }, backgroundColor: 'rgba(10, 10, 10, 0.7)', padding: 3, borderRadius: 3 }, enter(ctx, event) { ctx.element.label.options.display = true; ctx.chart.draw(); }, leave(ctx, event) { ctx.element.label.options.display = true; ctx.chart.draw(); } }; } }; addAnnotation('sunrise', celestialTimes.sun?.rise, 'Sunrise', '☀️', '#fcd34d', 'start'); addAnnotation('sunset', celestialTimes.sun?.set, 'Sunset', '☀️', '#fcd34d', 'end'); addAnnotation('moonrise', celestialTimes.moon?.rise, 'Moonrise', '🌕', '#d1d5db', 'start'); addAnnotation('moonset', celestialTimes.moon?.set, 'Moonset', '🌕', '#d1d5db', 'end'); return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' }, plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { callbacks: { title: (context) => context.length > 0 ? `Time: ${new Date(context[0].parsed.x).toLocaleTimeString('en-NZ')}` : '', label: (context) => { let label = context.dataset.label || ''; if (label) label += ': '; if (context.parsed.y !== null) label += `${context.parsed.y.toFixed(1)}%`; if (context.dataset.label === 'Spot The Aurora Forecast') label += ' (Final Score)'; else if (context.dataset.label === 'Base Score') label += ' (Raw Calculation)'; return label; } } }, annotation: { annotations, drawTime: 'afterDatasetsDraw' } }, scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } }, y: { type: 'linear', min: 0, max: 100, ticks: { color: '#71717a', callback: (value: any) => `${value}%` }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Aurora Score (%)', color: '#a3a3a3' } } } }; }, [auroraScoreChartTimeRange, celestialTimes]);
    const auroraScoreChartData = useMemo(() => { if (auroraScoreHistory.length === 0) return { datasets: [] }; const getForecastGradient = (ctx: ScriptableContext<'line'>) => { const chart = ctx.chart; const { ctx: chartCtx, chartArea } = chart; if (!chartArea) return undefined; const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top); const score0 = ctx.p0?.parsed?.y ?? 0; const score1 = ctx.p1?.parsed?.y ?? 0; const colorKey0 = getForecastScoreColorKey(score0); const colorKey1 = getForecastScoreColorKey(score1); gradient.addColorStop(0, GAUGE_COLORS[colorKey0].semi); gradient.addColorStop(1, GAUGE_COLORS[colorKey1].semi); return gradient; }; return { datasets: [ { label: 'Spot The Aurora Forecast', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })), borderColor: 'transparent', backgroundColor: getForecastGradient, fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 0, spanGaps: true, order: 1, }, { label: 'Base Score', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.baseScore })), borderColor: 'rgba(255, 255, 255, 1)', backgroundColor: 'transparent', fill: false, tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [5, 5], spanGaps: true, order: 2, } ], }; }, [auroraScoreHistory]);

    if (isLoading) { return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>; }

    const faqContent = `<div class="space-y-4"><div><h4 class="font-bold text-neutral-200">Why don't you use the Kp-index?</h4><p>The Kp-index is a fantastic tool for measuring global geomagnetic activity, but it's not real-time. It is an average calculated every 3 hours, so it often describes what *has already happened*. For a live forecast, we need data that's updated every minute. Relying on the Kp-index would be like reading yesterday's weather report to decide if you need an umbrella right now.</p></div><div><h4 class="font-bold text-neutral-200">What data SHOULD I look at then?</h4><p>The most critical live data points for aurora nowcasting are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>IMF Bz:</strong> The "gatekeeper". A strong negative (southward) value opens the door for the aurora.</li><li><strong>Solar Wind Speed:</strong> The "power". Faster speeds lead to more energetic and dynamic displays.</li><li><strong>Solar Wind Density:</strong> The "thickness". Higher density can result in a brighter, more widespread aurora.</li></ul></div><div><h4 class="font-bold text-neutral-200">The forecast is high but I can't see anything. Why?</h4><p>This can happen for several reasons! The most common are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Light Pollution:</strong> You must be far away from town and urban area lights.</li><li><strong>The Moon:</strong> A bright moon can wash out all but the most intense auroras.</li><li><strong>Eye Adaptation:</strong> It takes at least 15-20 minutes in total darkness for your eyes to become sensitive enough to see faint glows.</li><li><strong>Patience:</strong> Auroral activity happens in waves (substorms). A quiet period can be followed by an intense outburst.</li></ul></div><div><h4 class="font-bold text-neutral-200">Where does your data from?</h4><p>All our live solar wind and magnetic field data comes directly from NASA and NOAA, sourced from satellites positioned 1.5 million km from Earth, like the DSCOVR and ACE spacecraft. This dashboard fetches new data every minute. The "Spot The Aurora Forecast" score is then calculated using a proprietary algorithm that combines this live data with local factors for the West Coast of NZ.</p></div></div>`;

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 p-5 overflow-y-auto relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="container mx-auto relative z-10">
                <header className="text-center mb-8">
                    <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                    <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                </header>
                <main className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                        <div>
                            <div className="flex items-center mb-4"><h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                            <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${auroraScore !== null ? getGaugeStyle(auroraScore, 'power').percentage : 0}%`, backgroundColor: auroraScore !== null ? getGaugeStyle(auroraScore, 'power').color : GAUGE_COLORS.gray.solid }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{isDaylight ? "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!" : auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsTipsOpen(!isTipsOpen)}><h2 className="text-xl font-bold text-neutral-100">Tips for West Coast Spotting</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isTipsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isTipsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}><ul className="space-y-3 text-neutral-300 text-sm list-disc list-inside pl-2"><li><strong>Look South:</strong> The aurora will always appear in the southern sky from New Zealand. Find a location with an unobstructed view to the south, away from mountains or hills.</li><li><strong>Escape Light Pollution:</strong> Get as far away from town and urban area lights as possible. The darker the sky, the more sensitive your eyes become. West Coast beaches are often perfect for this.</li><li><strong>Check the Cloud Cover:</strong> Use the live cloud map on this dashboard. A clear sky is non-negotiable. West Coast weather changes fast, so check the map before and during your session.</li><li><strong>Let Your Eyes Adapt:</strong> Turn off all lights, including your phone screen (use red light mode if possible), for at least 15-20 minutes. Your night vision is crucial for spotting faint glows.</li><li><strong>The Camera Sees More:</strong> Your phone or DSLR camera is much more sensitive to light than your eyes. Take a long exposure shot (5-15 seconds) even if you can't see anything. You might be surprised!</li><li><strong>New Moon is Best:</strong> Check the moon illumination gauge. A bright moon acts like a giant street light, washing out the aurora. The lower the percentage, the better your chances.</li><li><strong>Be Patient & Persistent:</strong> Auroral activity ebbs and flows. A quiet period can be followed by a sudden, bright substorm. Don't give up after just a few minutes.</li></ul></div>
                        </div>
                        <div className="card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsCameraSettingsOpen(!isCameraSettingsOpen)}><h2 className="text-xl font-bold text-neutral-100">Suggested Camera Settings</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isCameraSettingsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isCameraSettingsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                <p className="text-neutral-400 text-center mb-6">{cameraSettings.overall}</p>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Phone Settings */}
                                    <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                        <h3 className="text-lg font-semibold text-neutral-200 mb-3">📱 Phone Camera</h3>
                                        <p className="text-neutral-400 text-sm mb-4">
                                            **General Phone Tips:** Use a tripod! Manual focus to infinity (look for a "mountain" or "star" icon in Pro/Night mode). Turn off flash.
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Android */}
                                            <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                                <h4 className="font-semibold text-neutral-300 mb-2">Android (Pro Mode)</h4>
                                                <ul className="text-xs space-y-1.5 text-neutral-400">
                                                    <li>**ISO:** {cameraSettings.phone.android.iso}</li>
                                                    <li>**Shutter Speed:** {cameraSettings.phone.android.shutter}</li>
                                                    <li>**Aperture:** {cameraSettings.phone.android.aperture}</li>
                                                    <li>**Focus:** {cameraSettings.phone.android.focus}</li>
                                                    <li>**White Balance:** {cameraSettings.phone.android.wb}</li>
                                                </ul>
                                                <div className="mt-2 text-xs">
                                                    <p className="text-green-400">**Pros:** {cameraSettings.phone.android.pros.join(' ')}</p>
                                                    <p className="text-red-400">**Cons:** {cameraSettings.phone.android.cons.join(' ')}</p>
                                                </div>
                                            </div>
                                            {/* Apple */}
                                            <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                                <h4 className="font-semibold text-neutral-300 mb-2">Apple (Night Mode / Third-Party Apps)</h4>
                                                <ul className="text-xs space-y-1.5 text-neutral-400">
                                                    <li>**ISO:** {cameraSettings.phone.apple.iso}</li>
                                                    <li>**Shutter Speed:** {cameraSettings.phone.apple.shutter}</li>
                                                    <li>**Aperture:** {cameraSettings.phone.apple.aperture}</li>
                                                    <li>**Focus:** {cameraSettings.phone.apple.focus}</li>
                                                    <li>**White Balance:** {cameraSettings.phone.apple.wb}</li>
                                                </ul>
                                                <div className="mt-2 text-xs">
                                                    <p className="text-green-400">**Pros:** {cameraSettings.phone.apple.pros.join(' ')}</p>
                                                    <p className="text-red-400">**Cons:** {cameraSettings.phone.apple.cons.join(' ')}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {/* DSLR/Mirrorless Settings */}
                                    <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                        <h3 className="text-lg font-semibold text-neutral-200 mb-3">📷 DSLR / Mirrorless</h3>
                                        <p className="text-neutral-400 text-sm mb-4">
                                            **General DSLR Tips:** Use a sturdy tripod. Manual focus to infinity (use live view and magnify a distant star). Shoot in RAW for best quality.
                                        </p>
                                        <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                            <h4 className="font-semibold text-neutral-300 mb-2">Recommended Settings</h4>
                                            <ul className="text-xs space-y-1.5 text-neutral-400">
                                                <li>**ISO:** {cameraSettings.dslr.iso}</li>
                                                <li>**Shutter Speed:** {cameraSettings.dslr.shutter}</li>
                                                <li>**Aperture:** {cameraSettings.dslr.aperture} (as wide as your lens allows)</li>
                                                <li>**Focus:** {cameraSettings.dslr.focus}</li>
                                                <li>**White Balance:** {cameraSettings.dslr.wb}</li>
                                            </ul>
                                            <div className="mt-2 text-xs">
                                                <p className="text-green-400">**Pros:** {cameraSettings.dslr.pros.join(' ')}</p>
                                                <p className="text-red-400">**Cons:** {cameraSettings.dslr.cons.join(' ')}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-neutral-500 text-xs italic mt-6 text-center">
                                    **Disclaimer:** These are starting points. Aurora activity, light pollution, moon phase, and your specific camera/lens will influence optimal settings. Experimentation is key!
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <AuroraSightings isDaylight={isDaylight} />

                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast Trend (Last {auroraScoreChartTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setAuroraScoreChartTimeRange(duration); setAuroraScoreChartTimeLabel(label); }} selected={auroraScoreChartTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {auroraScoreHistory.length > 0 ? ( <Line data={auroraScoreChartData} options={auroraScoreChartOptions} /> ) : ( <p className="text-center pt-10 text-neutral-400 italic">No historical forecast data available.</p> )}
                        </div>
                    </div>

                    <div className="col-span-12 grid grid-cols-6 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={() => openModal(key)} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <div className="font-bold my-2" dangerouslySetInnerHTML={{ __html: data.value }}></div>
                                <div className="text-3xl my-2">{data.emoji}</div>
                                <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                            </div>
                        ))}
                    </div>

                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center">Live Solar Wind</h2><button onClick={() => openModal('solar-wind-graph')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                        <TimeRangeButtons onSelect={(duration, label) => { setSolarWindTimeRange(duration); setSolarWindTimeLabel(label); }} selected={solarWindTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {allPlasmaData.length > 0 ? <Line data={solarWindChartData} options={solarWindOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Solar wind data unavailable.</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field</h2><button onClick={() => openModal('imf-graph')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                        <TimeRangeButtons onSelect={(duration, label) => { setMagneticFieldTimeRange(duration); setMagneticFieldTimeLabel(label); }} selected={magneticFieldTimeRange} />
                         <div className="flex-grow relative mt-2">
                            {allMagneticData.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">IMF data unavailable.</p>}
                        </div>
                    </div>

                    <div className="col-span-12 card bg-neutral-950/80 p-4">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 h-[450px] flex flex-col">
                                <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center">GOES Magnetometer (Substorm Watch)</h2><button onClick={() => openModal('goes-mag')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <TimeRangeButtons onSelect={(duration, label) => { setMagnetometerTimeRange(duration); setMagnetometerTimeLabel(label); }} selected={magnetometerTimeRange} />
                                <div className="flex-grow relative mt-2">
                                    {loadingMagnetometer ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMagnetometer}</p> : <Line data={magnetometerChartData} options={magnetometerOptions} plugins={[annotationPlugin]} />}
                                </div>
                            </div>
                            <div className="lg:col-span-1 flex flex-col justify-center items-center bg-neutral-900/50 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold text-neutral-200 mb-2">Magnetic Field Analysis</h3>
                                <p className={`text-center text-lg ${substormBlurb.color}`}>{substormBlurb.text}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&metricWind=km/h&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Queenstown Live Camera</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Live View from Queenstown" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://queenstown.roundshot.com/#/"></iframe></div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-center text-white">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                         <div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div>
                    </div>
                </main>
                <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                    <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a highly localized, 2-hour aurora forecast specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                    <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                    <div className="mt-6">
                        <button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors">
                            <GuideIcon className="w-5 h-5" />
                            <span>Frequently Asked Questions</span>
                        </button>
                    </div>
                    <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a> | Live Camera by <a href="https://queenstown.roundshot.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Roundshot</a></p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                </footer>
             </div>
            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;