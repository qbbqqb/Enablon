'use client'

interface ProgressBarProps {
  progress: number // 0-100
  label: string
  className?: string
}

export default function ProgressBar({ progress, label, className = '' }: ProgressBarProps) {
  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between items-center mb-3">
        <span className="text-base font-semibold text-blue-900">{label}</span>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-blue-700">{progress.toFixed(0)}%</span>
        </div>
      </div>
      <div className="w-full bg-blue-100 rounded-full h-3 overflow-hidden">
        <div 
          className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out relative"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse"></div>
        </div>
      </div>
    </div>
  )
}