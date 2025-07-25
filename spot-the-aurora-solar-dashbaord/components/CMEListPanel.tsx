import React from 'react';
import { ProcessedCME } from '../types';
import CloseIcon from './icons/CloseIcon';

interface CMEListPanelProps {
  cmes: ProcessedCME[];
  onSelectCME: (cme: ProcessedCME | null) => void; // Allow null to deselect or show all
  selectedCMEId: string | null;
  selectedCMEForInfo: ProcessedCME | null;
  isLoading: boolean;
  fetchError: string | null;
  onClose?: () => void;
}

const CMEListPanel: React.FC<CMEListPanelProps> = ({ cmes, onSelectCME, selectedCMEId, selectedCMEForInfo, isLoading, fetchError, onClose }) => {
  return (
    <div className="panel lg:bg-neutral-950/80 backdrop-blur-md lg:border lg:border-neutral-800/90 lg:rounded-lg p-4 lg:shadow-xl flex flex-col w-full h-full">
      {selectedCMEForInfo && (
        <div className="mb-4 p-3 bg-neutral-900/70 rounded-md border border-neutral-700/60 relative">
          <div className="flex justify-between items-center mb-2 border-b border-neutral-700/50 pb-1">
            <h2 className={`text-lg font-semibold text-neutral-200`}>Selected CME</h2>
            <button onClick={() => onSelectCME(null)} className="p-1 text-neutral-400 hover:text-white" title="Deselect CME">
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-1 text-xs text-neutral-400 max-h-48 overflow-y-auto styled-scrollbar pr-1">
            <p><strong>ID:</strong> <a href={selectedCMEForInfo.link} target="_blank" rel="noopener noreferrer" className={`text-neutral-400 hover:underline`}>{selectedCMEForInfo.id}</a></p>
            <p><strong>Start Time:</strong> {selectedCMEForInfo.startTime.toLocaleString()}</p>
            <p><strong>Speed:</strong> {selectedCMEForInfo.speed} km/s</p>
            <p><strong>Direction (Lon/Lat):</strong> {selectedCMEForInfo.longitude.toFixed(1)}° / {selectedCMEForInfo.latitude.toFixed(1)}°</p>
            <p><strong>Source:</strong> {selectedCMEForInfo.sourceLocation}</p>
            <p><strong>Instruments:</strong> {selectedCMEForInfo.instruments}</p>
            <p><strong>Earth Directed:</strong> <span className={selectedCMEForInfo.isEarthDirected ? 'text-green-400 font-bold' : 'text-orange-400'}>{selectedCMEForInfo.isEarthDirected ? 'Yes' : 'No'}</span></p>
            <p><strong>Predicted Arrival:</strong> {selectedCMEForInfo.predictedArrivalTime ? selectedCMEForInfo.predictedArrivalTime.toLocaleString() : 'N/A'}</p>
            <p><strong>Note:</strong> <span className="italic break-words">{selectedCMEForInfo.note}</span></p>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center border-b border-neutral-700/80 pb-2 mb-3">
        <h2 className={`text-xl font-bold text-neutral-200`}>Available CMEs</h2>
        {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 text-neutral-400 hover:text-white">
                <CloseIcon className="w-6 h-6"/>
            </button>
        )}
      </div>
      
      <button
        onClick={() => onSelectCME(null)} // Clicking "Show All" deselects any specific CME
        className={`w-full mb-3 text-sm px-3 py-2 rounded-md border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:ring-neutral-400 ${
          !selectedCMEId
            ? `bg-neutral-100 text-neutral-900 border-neutral-100 font-semibold`
            : `bg-transparent border-neutral-600 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-500`
        }`}
      >
        Show All (Live Simulation)
      </button>

      <div className="flex-grow overflow-y-auto styled-scrollbar pr-2">
        {isLoading && !fetchError && <p className={`italic text-neutral-400`}>Loading CMEs...</p>}
        {fetchError && <p className="text-red-400">Error: {fetchError}</p>}
        {!isLoading && !fetchError && cmes.length === 0 && (
          <p className={`italic text-neutral-400`}>No modelable CMEs found for this period.</p>
        )}
        {!isLoading && !fetchError && cmes.map(cme => (
          <div
            key={cme.id}
            onClick={() => onSelectCME(cme)}
            className={`p-2.5 mb-2 rounded-md border cursor-pointer transition-all duration-200 ease-in-out text-xs
              ${selectedCMEId === cme.id 
                ? `bg-neutral-200 text-neutral-900 border-neutral-200 shadow-lg transform scale-[1.02]` 
                : `bg-neutral-800/50 border-neutral-700/70 hover:bg-neutral-700/60 hover:border-neutral-600 text-neutral-300`}`}
          >
            <p className="font-semibold text-inherit">ID: <span className="font-normal">{cme.startTime.toISOString().slice(0,10)} Event ({cme.id.slice(-4)})</span></p>
            <p className="text-inherit">Time: <span className="font-normal">{cme.startTime.toLocaleTimeString()}</span></p>
            <p className="text-inherit">Speed: <span className="font-normal">{cme.speed} km/s</span></p>
            {cme.isEarthDirected && <p className="font-bold text-green-300 mt-1">Potentially Earth-Directed</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CMEListPanel;