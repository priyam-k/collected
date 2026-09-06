import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@collected/shared';
import { api } from './api';

export const qk = {
  health: ['health'] as const,
};

export function useHealth() {
  return useQuery({ queryKey: qk.health, queryFn: () => api<HealthResponse>('/health'), refetchInterval: 30_000 });
}
