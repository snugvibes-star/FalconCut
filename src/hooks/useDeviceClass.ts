import { useMediaQuery } from './useMediaQuery';

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/** Shared breakpoint definition used by JS-driven responsive behaviour.
 *  phone   < 640px  — full-screen panel drawers, condensed timeline
 *  tablet  640–1023 — overlay panels, normal timeline
 *  desktop >= 1024  — docked, resizable panels
 */
export function useDeviceClass(): DeviceClass {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const phone = useMediaQuery('(max-width: 639px)');
  if (desktop) return 'desktop';
  if (phone) return 'phone';
  return 'tablet';
}
