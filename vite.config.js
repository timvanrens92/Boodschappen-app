import { defineConfig } from 'vite';

// GitHub Pages zet een projectsite onder /<repo-naam>/.
// Met een eigen domein: zet de repository-variabele APP_BASE op "/".
export default defineConfig({
  base: process.env.VITE_BASE || '/boodschappen-app/',
  build: { target: 'es2020' },
});
