import type { CapacitorConfig } from '@capacitor/cli'

// Android + iPhone/iPad apps: the same built web app (dist/) in the system WebView,
// Bluetooth printing through @capacitor-community/bluetooth-le.
const config: CapacitorConfig = {
  appId: 'app.kasa.pos',
  appName: 'KontoSef',
  webDir: 'dist',
  backgroundColor: '#0F1B2D',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Duke kërkuar printerin…',
        cancel: 'Anulo',
        availableDevices: 'Pajisjet',
        noDeviceFound: 'Asnjë printer nuk u gjet',
      },
    },
  },
}

export default config
