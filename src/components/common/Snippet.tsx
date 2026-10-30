import { CopyButton } from './CopyButton';
import styles from './Snippet.module.scss';

interface SnippetProps {
  code: string;
  label?: string;
  className?: string;
}

/** A copy-paste block with the copy button attached to it. */
export function Snippet({ code, label, className = '' }: SnippetProps) {
  return (
    <div className={`${styles.snippet} ${className}`.trim()}>
      <div className={styles.head}>
        {label ? <span className={styles.label}>{label}</span> : <span />}
        <CopyButton value={code} />
      </div>
      <pre className={styles.code}>{code}</pre>
    </div>
  );
}
