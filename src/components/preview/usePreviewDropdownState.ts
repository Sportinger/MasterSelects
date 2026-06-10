import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

export interface PreviewDropdownState {
  dropdownRef: RefObject<HTMLDivElement | null>;
  dropdownStyle: CSSProperties;
  qualityDropdownRef: RefObject<HTMLDivElement | null>;
  qualityOpen: boolean;
  selectorOpen: boolean;
  setQualityOpen: (open: boolean) => void;
  setSelectorOpen: (open: boolean) => void;
}

export function usePreviewDropdownState(): PreviewDropdownState {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const [qualityOpen, setQualityOpen] = useState(false);
  const qualityDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectorOpen && !qualityOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (selectorOpen && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setSelectorOpen(false);
      }
      if (qualityOpen && qualityDropdownRef.current && !qualityDropdownRef.current.contains(target)) {
        setQualityOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectorOpen, qualityOpen]);

  useEffect(() => {
    if (selectorOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const style: CSSProperties = {};

      if (rect.left < 8) {
        style.left = '0';
        style.right = 'auto';
      }
      if (rect.right > window.innerWidth - 8) {
        style.right = '0';
        style.left = 'auto';
      }
      if (rect.bottom > window.innerHeight - 8) {
        style.bottom = '100%';
        style.top = 'auto';
        style.marginTop = '0';
        style.marginBottom = '4px';
      }

      setDropdownStyle(style);
    } else {
      setDropdownStyle({});
    }
  }, [selectorOpen]);

  return {
    dropdownRef,
    dropdownStyle,
    qualityDropdownRef,
    qualityOpen,
    selectorOpen,
    setQualityOpen,
    setSelectorOpen,
  };
}
