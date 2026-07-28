export interface ProxyJobController {
  cancelled: boolean;
  kind: 'proxy' | 'scene-cuts';
}

export const activeProxyGenerations = new Map<string, ProxyJobController>();
