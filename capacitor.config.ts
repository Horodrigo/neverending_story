import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.neverending.jogadores',
  appName: 'Neverending Jogadores',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
}

export default config
