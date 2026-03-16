import React from 'react';
import { Mic, MicOff, Activity } from 'lucide-react';

interface StezioVoiceAssistantProps {
  isActive: boolean;
  onToggle: () => void;
  isConnected?: boolean;
}

export const StezioVoiceAssistant: React.FC<StezioVoiceAssistantProps> = ({ 
  isActive, 
  onToggle, 
  isConnected = true 
}) => {
  return (
    <div className="absolute top-4 right-4 z-50 flex items-center gap-3 bg-black/60 backdrop-blur-md rounded-full px-4 py-2 border border-white/10 shadow-lg transition-all duration-300">
      <div className="flex flex-col items-end">
        <span className="text-white text-xs font-semibold tracking-wider uppercase">
          Co-Pilot {isActive ? 'Active' : 'Off'}
        </span>
        {isActive && isConnected && (
          <span className="text-emerald-400 text-[10px] animate-pulse">
            Listening...
          </span>
        )}
      </div>

      <button
        onClick={onToggle}
        className={`relative p-3 rounded-full transition-all duration-300 ${
          isActive 
            ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' 
            : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white'
        }`}
      >
        {/* Glowing aura when active */}
        {isActive && (
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-pulse" />
        )}
        
        {isActive ? (
          <Activity size={20} className="relative z-10" />
        ) : (
          <MicOff size={20} className="relative z-10" />
        )}
      </button>
    </div>
  );
};