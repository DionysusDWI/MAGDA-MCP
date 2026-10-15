import { loadBaseline } from '../../src/contract.js';
import { startStdio } from '../../src/proxy/stdio.js';
// This test-only executable supplies a mock process inspector. The production CLI has no bypass.
const dataDir = process.argv[2]!;
const upstreamVersion = process.argv[3]!;
const baseline = await loadBaseline();
startStdio({ baseline, dataDir, upstreamVersion, inspectProcess: async pid => ({ pid, executable: 'C:\\MAGDA\\MAGDA.exe', version: '0.20.2', startedAt: '2026-01-01T00:00:00Z' }) });
