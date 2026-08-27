import { createContext, useContext } from 'react';
import type { Client, OrganizationContext } from '@workspace/api-client-react';

export type ClientWorkspace = {
  activeClient: Client | undefined;
  clients: Client[];
  setActiveClientId: (id: number) => void;
};

export const ClientContext = createContext<ClientWorkspace | null>(null);

export function useClientWorkspace() {
  const context = useContext(ClientContext);
  if (!context) throw new Error('Client workspace is not available');
  return context;
}

export const OrgContext = createContext<OrganizationContext | undefined>(undefined);

export function useOrgContext() {
  return useContext(OrgContext);
}
