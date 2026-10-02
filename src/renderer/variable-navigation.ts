import { createContext } from 'react';

export type VariableNavigation = {
  flowName: string;
  source: string;
  openFlow: () => void;
  openLibrary: () => void;
  showBrowser: () => void;
};

export const VariableNavigationContext = createContext<VariableNavigation | undefined>(undefined);
