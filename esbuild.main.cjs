const esbuild = require('esbuild');
const path = require('path');

// Build configuration for Electron main process
// This bundles ESM-only packages (like @github/copilot-sdk) into CJS-compatible output
esbuild.build({
  entryPoints: [
    'src/main/index.ts',      // Main process entry
    'src/main/preload.ts',    // Preload script (separate bundle)
  ],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outdir: 'dist/main',
  format: 'cjs',
  sourcemap: true,
  
  // Only mark truly external packages (native/electron modules)
  external: [
    'electron',
    'electron-store',  // Native bindings
  ],
  
  // Resolve TypeScript files
  resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
  
  // Log output
  logLevel: 'info',
  
  // Banner to handle ESM default exports
  banner: {
    js: '// Bundled by esbuild for Electron main process',
  },
  
}).then(() => {
  console.log('✅ Main process bundled successfully');
}).catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
