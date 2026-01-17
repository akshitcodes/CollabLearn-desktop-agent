import { useEffect, useRef, useMemo } from 'react';

interface TerminalOutputProps {
  /** Raw output text - will be accumulated and processed */
  output: string;
  /** Whether the process is still running */
  isRunning?: boolean;
  /** Additional CSS class */
  className?: string;
}

// ANSI color code mappings to CSS
const ANSI_COLORS: Record<number, string> = {
  // Standard colors
  30: '#1e1e1e',    // black
  31: '#f14c4c',    // red
  32: '#23d18b',    // green
  33: '#f5f543',    // yellow
  34: '#3b8eea',    // blue
  35: '#d670d6',    // magenta
  36: '#29b8db',    // cyan
  37: '#cccccc',    // white
  
  // Bright colors
  90: '#666666',    // bright black
  91: '#f14c4c',    // bright red
  92: '#23d18b',    // bright green
  93: '#f5f543',    // bright yellow
  94: '#3b8eea',    // bright blue
  95: '#d670d6',    // bright magenta
  96: '#29b8db',    // bright cyan
  97: '#ffffff',    // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#1e1e1e',
  41: '#f14c4c',
  42: '#23d18b',
  43: '#f5f543',
  44: '#3b8eea',
  45: '#d670d6',
  46: '#29b8db',
  47: '#cccccc',
  100: '#666666',
  101: '#f14c4c',
  102: '#23d18b',
  103: '#f5f543',
  104: '#3b8eea',
  105: '#d670d6',
  106: '#29b8db',
  107: '#ffffff',
};

interface TextSpan {
  text: string;
  style: React.CSSProperties;
}

/**
 * Parse ANSI escape codes and convert to styled spans
 */
function parseAnsiToSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  // Match ANSI escape sequences: ESC[...m
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  
  let currentStyle: React.CSSProperties = {};
  let lastIndex = 0;
  let match;
  
  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        spans.push({ text: textContent, style: { ...currentStyle } });
      }
    }
    
    // Parse the escape sequence codes
    const codes = match[1].split(';').map(Number).filter(n => !isNaN(n));
    
    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentStyle = {};
      } else if (code === 1) {
        currentStyle.fontWeight = 'bold';
      } else if (code === 2) {
        currentStyle.opacity = 0.7;
      } else if (code === 3) {
        currentStyle.fontStyle = 'italic';
      } else if (code === 4) {
        currentStyle.textDecoration = 'underline';
      } else if (code === 9) {
        currentStyle.textDecoration = 'line-through';
      } else if (code >= 30 && code <= 37) {
        currentStyle.color = ANSI_COLORS[code];
      } else if (code >= 90 && code <= 97) {
        currentStyle.color = ANSI_COLORS[code];
      } else if (code >= 40 && code <= 47) {
        currentStyle.backgroundColor = ANSI_BG_COLORS[code];
      } else if (code >= 100 && code <= 107) {
        currentStyle.backgroundColor = ANSI_BG_COLORS[code];
      } else if (code === 38 || code === 48) {
        // 256 color or RGB mode - skip for now
      }
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), style: { ...currentStyle } });
  }
  
  return spans;
}

/**
 * Clean up terminal output - remove control characters but preserve structure
 */
function cleanTerminalOutput(text: string): string {
  return text
    // Remove cursor movement/position codes (but keep color codes)
    .replace(/\x1b\[\d*[ABCDEFGJKST]/g, '')
    .replace(/\x1b\[\d*;\d*[Hf]/g, '')
    .replace(/\x1b\[\??\d*[hl]/g, '')
    // Remove other non-printable control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '')
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Terminal Output Component
 * Renders terminal output with proper ANSI color support and formatting
 */
export function TerminalOutput({ output, isRunning = false, className = '' }: TerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  
  // Process output
  const processedOutput = useMemo(() => {
    const cleaned = cleanTerminalOutput(output);
    return parseAnsiToSpans(cleaned);
  }, [output]);
  
  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (containerRef.current && shouldAutoScroll.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [processedOutput]);
  
  // Track if user has scrolled up
  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      // If scrolled near bottom, enable auto-scroll
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };
  
  return (
    <div 
      ref={containerRef} 
      className={`terminal-output ${className}`}
      onScroll={handleScroll}
    >
      <pre className="terminal-content">
        {processedOutput.map((span, idx) => (
          <span key={idx} style={span.style}>{span.text}</span>
        ))}
        {isRunning && <span className="terminal-cursor">▌</span>}
      </pre>
    </div>
  );
}

export default TerminalOutput;
