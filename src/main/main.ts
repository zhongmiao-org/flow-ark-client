// The controlled browser process has no workbench, vault, host or privileged IPC.
if (process.argv.includes('--flowark-browser')) void import('./browser-shell');
else void import('./workbench');
