import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './CopyButton.module.scss';

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
  disabled?: boolean;
}

/** Small button that copies a value and confirms it for a moment. */
export function CopyButton({
  value,
  label,
  copiedLabel,
  size = 'sm',
  variant = 'secondary',
  className = '',
  disabled = false,
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onClick = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`.trim()}
      onClick={() => void onClick()}
      disabled={disabled || !value}
      aria-live="polite"
    >
      {copied ? (copiedLabel ?? t('connect.copied')) : (label ?? t('connect.copy'))}
    </button>
  );
}
