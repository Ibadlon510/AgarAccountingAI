import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AssistantPageContextValue = {
  route: string;
  selectedLineIds: number[];
  visibleLineIds: number[];
  statementLineSearch?: string;
};

const emptyContext: AssistantPageContextValue = {
  route: "/",
  selectedLineIds: [],
  visibleLineIds: [],
};

const AssistantPageContext = createContext<{
  pageContext: AssistantPageContextValue;
  setPageContext: (next: AssistantPageContextValue) => void;
}>({
  pageContext: emptyContext,
  setPageContext: () => undefined,
});

export function AssistantPageContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<AssistantPageContextValue>(emptyContext);
  const value = useMemo(() => ({ pageContext, setPageContext }), [pageContext]);
  return <AssistantPageContext.Provider value={value}>{children}</AssistantPageContext.Provider>;
}

export function useAssistantPageContext() {
  return useContext(AssistantPageContext).pageContext;
}

export function usePublishAssistantPageContext(next: AssistantPageContextValue) {
  const { setPageContext } = useContext(AssistantPageContext);
  const serialized = JSON.stringify(next);
  useEffect(() => {
    setPageContext(JSON.parse(serialized) as AssistantPageContextValue);
    return () => {
      setPageContext(emptyContext);
    };
  }, [serialized, setPageContext]);
}
