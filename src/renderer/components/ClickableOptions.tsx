/**
 * ClickableOptions - Styled option buttons for ideation chat
 * 
 * Matches web version UX with typed options (affirmative, exploratory, clarifying, directive)
 */

import './ClickableOptions.css';

export type OptionType = 'affirmative' | 'exploratory' | 'clarifying' | 'directive' | 'default';

export interface ClickableOption {
  text: string;
  type: OptionType | string;
}

export interface OptionGroup {
  label: string;
  options: ClickableOption[];
}

interface ClickableOptionsProps {
  options: OptionGroup[];
  onOptionClick: (text: string, type: string) => void;
  disabled?: boolean;
}

const typeIcons: Record<string, string> = {
  affirmative: '✓',
  exploratory: '🔍',
  clarifying: '💭',
  directive: '🎯',
  default: '💡',
};

const typeColors: Record<string, { bg: string; border: string; text: string }> = {
  affirmative: { bg: 'rgba(34, 197, 94, 0.1)', border: '#22c55e', text: '#22c55e' },
  exploratory: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6', text: '#3b82f6' },
  clarifying: { bg: 'rgba(168, 85, 247, 0.1)', border: '#a855f7', text: '#a855f7' },
  directive: { bg: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b', text: '#f59e0b' },
  default: { bg: 'rgba(107, 114, 128, 0.1)', border: '#6b7280', text: '#6b7280' },
};

export default function ClickableOptions({ options, onOptionClick, disabled = false }: ClickableOptionsProps) {
  if (!options || options.length === 0) return null;

  return (
    <div className="clickable-options">
      {options.map((group, groupIdx) => (
        <div key={`group-${groupIdx}-${group.label}`} className="option-group">
          <div className="group-label">{group.label}</div>
          <div className="options-row">
            {group.options.map((option, optIdx) => {
              const type = option.type || 'default';
              const icon = typeIcons[type] || typeIcons.default;
              const colors = typeColors[type] || typeColors.default;
              
              return (
                <button
                  key={`opt-${groupIdx}-${optIdx}-${option.text}`}
                  className="option-btn"
                  onClick={() => onOptionClick(option.text, type)}
                  disabled={disabled}
                  style={{
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    color: colors.text,
                  }}
                >
                  <span className="option-icon">{icon}</span>
                  <span className="option-text">{option.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
