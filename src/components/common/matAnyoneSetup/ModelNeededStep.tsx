import { styles } from './styles';

type ModelNeededStepProps = {
  onClose: () => void;
  onDownloadModel: () => void;
};

export function ModelNeededStep({ onClose, onDownloadModel }: ModelNeededStepProps) {
  return (
    <>
      <div style={styles.body}>
        <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 16, padding: '16px 0' }}>
          <div style={{ fontSize: 32 }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="4" y="8" width="32" height="24" rx="3" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
              <path d="M16 16l8 4-8 4V16z" fill="rgba(255,255,255,0.5)" />
            </svg>
          </div>
          <p style={{ ...styles.description, textAlign: 'center' }}>
            Environment is set up. Download the model weights to complete installation.
          </p>
          <p style={styles.modelInfo}>~141 MB from HuggingFace</p>
          <p style={{ ...styles.description, textAlign: 'center', fontSize: 11 }}>
            Downloading and using the weights is subject to the NTU S-Lab License 1.0, including its non-commercial-use terms.
          </p>
        </div>
      </div>

      <div style={styles.footer}>
        <button
          style={styles.btnSecondary}
          onClick={onClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        >
          Later
        </button>
        <button
          style={{ ...styles.btnPrimary, padding: '10px 28px' }}
          onClick={onDownloadModel}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)'; }}
        >
          Download Model
        </button>
      </div>
    </>
  );
}
