import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.poc.srnesolarmomitor',
  appName: 'SRNE Solar Monitor',
  webDir: 'www',
  plugins: {
    BarcodeScanner: {
      googleBarcodeScannerModuleInstallState: 'prompt'
    }
  }
};

export default config;
