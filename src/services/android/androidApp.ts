interface AndroidApp {
  readonly bundledEditor: true;
  openEmailSignInLink: () => Promise<void>;
  setScreenAwake: (lease: string, active: boolean) => Promise<void>;
}

export function getAndroidApp(): AndroidApp | undefined {
  return (window as Window & { __masterselectsAndroid?: AndroidApp }).__masterselectsAndroid;
}
