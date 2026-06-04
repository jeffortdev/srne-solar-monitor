import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.srnesolarmomitor.app',
  appName: 'J Solar',
  webDir: 'www',
  plugins: {
    BarcodeScanner: {
      googleBarcodeScannerModuleInstallState: 'prompt'
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_solar',
      iconColor: '#F4A124',
      sound: 'default'
    }
  }
};

export default config;
