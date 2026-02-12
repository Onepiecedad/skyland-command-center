import { Loader2 } from 'lucide-react';

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
}

/**
 * Loading Component
 * Displays a loading spinner with optional text
 * Used in Suspense boundaries and async loading states
 */
export function Loading({ size = 'md', text = 'Loading...', fullScreen = false }: LoadingProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  const content = (
    <div className="flex flex-col items-center justify-center space-y-4">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-blue-600`} />
      {text && <p className="text-gray-600 text-sm">{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
        {content}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8">
      {content}
    </div>
  );
}

/**
 * Page Loading Component
 * Full-page loading state for route transitions
 */
export function PageLoading() {
  return <Loading size="lg" text="Loading page..." fullScreen />;
}

/**
 * Skeleton Loading Component
 * Displays placeholder content while data loads
 */
export function SkeletonLoading({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-gray-200 rounded-lg h-20" />
      ))}
    </div>
  );
}

export default Loading;
