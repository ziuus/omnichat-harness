import { describe, expect, it } from 'bun:test';
import { providerStatusPresentation, serverStatusPresentation } from '../ui/status.js';

describe('status presentation', () => {
  it('maps provider states to readable labels and icons', () => {
    expect(providerStatusPresentation('healthy')).toMatchObject({ label: 'healthy', icon: '●' });
    expect(providerStatusPresentation('degraded')).toMatchObject({ label: 'degraded', icon: '▲' });
    expect(providerStatusPresentation('rate-limited')).toMatchObject({ label: 'rate-limited', icon: '◷' });
    expect(providerStatusPresentation('unavailable')).toMatchObject({ label: 'unavailable', icon: '×' });
    expect(providerStatusPresentation('unknown')).toMatchObject({ label: 'unknown', icon: '?' });
  });

  it('maps server states to readable labels', () => {
    expect(serverStatusPresentation('healthy').label).toBe('healthy');
    expect(serverStatusPresentation('degraded').label).toBe('degraded');
    expect(serverStatusPresentation('unavailable').label).toBe('unavailable');
  });
});
