/** Serializable signal descriptions. Formats identify intermediate values, not file extensions. */
export interface NodePortContract {
  typeLabel: string;
  description: string;
  formats: string[];
  constraints?: string[];
}
