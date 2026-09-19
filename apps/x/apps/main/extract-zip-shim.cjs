// Workaround: extract-zip 2.x (yauzl pipeline) silently stalls under Node 26
// on the ~110MB Electron zip. Replace it with PowerShell Expand-Archive.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'extract-zip') {
    return async function extractZip(zipPath, opts) {
      const fs = require('fs');
      const { execFileSync } = require('child_process');
      fs.mkdirSync(opts.dir, { recursive: true });
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${opts.dir.replace(/'/g, "''")}' -Force`,
      ], { stdio: 'inherit' });
    };
  }
  return origLoad.apply(this, arguments);
};
