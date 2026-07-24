import type { MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';
import { CheckIcon, CrossIcon, WarningIcon } from './icons';
import { styles } from './styles';
import { formatVramDetail } from './viewMapping';

type WelcomeStepProps = {
  setupStatus: MatAnyoneSetupStatus;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  gpuName: string | null;
  vramMb: number | null;
  onClose: () => void;
  onInstall: () => void;
};

export function WelcomeStep({
  setupStatus,
  cudaAvailable,
  cudaVersion,
  gpuName,
  vramMb,
  onClose,
  onInstall,
}: WelcomeStepProps) {
  const installDisabled = setupStatus === 'not-available' || !cudaAvailable;
  return (
    <>
      <div style={styles.body}>
        <p style={styles.description}>
          Extract people from video with precise alpha mattes for clean compositing.
          Works with SAM2 masks to automatically generate production-quality alpha channels.
        </p>

        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            Requirements
          </div>
          <ul style={styles.requirementsList}>
            <li style={styles.requirementItem}>
              <span style={styles.requirementIcon}>
                {cudaAvailable ? <CheckIcon /> : <CrossIcon />}
              </span>
              <div>
                <div>NVIDIA GPU with CUDA</div>
                {gpuName && (
                  <div style={styles.requirementDetail}>
                    {gpuName}{formatVramDetail(vramMb)}
                    {cudaVersion && ` \u00b7 CUDA ${cudaVersion}`}
                  </div>
                )}
                {!gpuName && !cudaAvailable && (
                  <div style={styles.requirementDetail}>Not detected</div>
                )}
              </div>
            </li>
            <li style={styles.requirementItem}>
              <span style={styles.requirementIcon}>
                <CheckIcon />
              </span>
              <div>
                <div>~4 GB disk space</div>
                <div style={styles.requirementDetail}>Python environment + PyTorch</div>
              </div>
            </li>
            <li style={styles.requirementItem}>
              <span style={styles.requirementIcon}>
                <CheckIcon />
              </span>
              <div>
                <div>~150 MB for model weights</div>
                <div style={styles.requirementDetail}>Downloaded from HuggingFace</div>
              </div>
            </li>
          </ul>
        </div>

        {!cudaAvailable && (
          <div style={styles.warningBox}>
            <span style={styles.warningIconWrap}><WarningIcon /></span>
            <span>MatAnyone2 is GPU-only in MasterSelects. Installation and processing require an accessible NVIDIA CUDA GPU; CPU fallback is disabled.</span>
          </div>
        )}

        <div style={styles.warningBox}>
          <span style={styles.warningIconWrap}><WarningIcon /></span>
          <span>
            MatAnyone2 is distributed under the NTU S-Lab License 1.0. Non-commercial use must follow its terms; commercial use requires separate permission from the authors.
          </span>
        </div>

        {setupStatus === 'not-available' && (
          <div style={styles.warningBox}>
            <span style={styles.warningIconWrap}><WarningIcon /></span>
            <span>Native helper is not connected. Please start the native helper first (see Tools menu).</span>
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={styles.btnSecondary}
          onClick={onClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        >
          Cancel
        </button>
        <button
          style={{
            ...styles.btnPrimary,
            opacity: installDisabled ? 0.5 : 1,
            cursor: installDisabled ? 'not-allowed' : 'pointer',
            padding: '10px 28px',
            fontSize: 14,
          }}
          disabled={installDisabled}
          onClick={onInstall}
          onMouseEnter={(e) => {
            if (!installDisabled) {
              e.currentTarget.style.background = 'rgba(99, 102, 241, 1)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)';
          }}
        >
          {cudaAvailable ? 'Install' : 'GPU Required'}
        </button>
      </div>
    </>
  );
}
