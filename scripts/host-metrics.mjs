import * as os from 'node:os';
import { readFile } from 'node:fs/promises';

// Whole-host samples. CPU needs two observations; no model turn is involved.
export function createHostSampler(system = os, read = path => readFile(path, "utf8")) {
  let previous;
  return async () => {
    const cpus = system.cpus();
    const current = cpus.map(cpu => ({idle:cpu.times.idle,total:Object.values(cpu.times).reduce((a,b)=>a+b,0)}));
    let cpu_percent = null;
    if (previous?.length === current.length && current.length) {
      const total = current.reduce((sum,c,i)=>sum+c.total-previous[i].total,0);
      const idle = current.reduce((sum,c,i)=>sum+c.idle-previous[i].idle,0);
      if (total > 0 && idle >= 0 && idle <= total) cpu_percent = Math.round((1-idle/total)*1000)/10;
    }
    previous = current;
    const memory_total_bytes = system.totalmem();
    let available = system.freemem();
    if (system.platform() === 'linux') {
      try {
        const match = (await read('/proc/meminfo')).match(/^MemAvailable:\s+(\d+) kB$/m);
        if (match) available = Number(match[1])*1024;
      } catch { /* Fall back to the OS free-memory reading. */ }
    }
    return {cpu_percent,cpu_count:cpus.length,memory_total_bytes,memory_available_bytes:Math.min(memory_total_bytes,Math.max(0,available)),platform:system.platform()};
  };
}
