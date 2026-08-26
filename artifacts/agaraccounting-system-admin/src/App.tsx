import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignIn, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Toaster } from '@/components/ui/toaster';
import {
  Route,
  Switch,
  Router as WouterRouter,
  useLocation,
} from 'wouter';
import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/Dashboard';
import Rates from '@/pages/Rates';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return <div className="grid min-h-screen place-items-center bg-background font-mono text-sm text-muted-foreground">Checking secure session…</div>;
  }
  if (!isSignedIn) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5">
        <section className="w-full max-w-md border border-border bg-card p-8 shadow-sm">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Private system console</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Authorized access only</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in with an account that has been granted the separate system-rate administrator entitlement.</p>
          <a href={`${basePath}/sign-in`} className="mt-7 inline-flex h-10 items-center justify-center bg-primary px-5 text-sm font-semibold text-primary-foreground">Sign in</a>
        </section>
      </main>
    );
  }
  return <Router />;
}

function SignInPage() {
  return <div className="grid min-h-screen place-items-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} /></div>;
}

function NotFound() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/rates" component={Rates} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      routerPush={(to) => setLocation(to.startsWith(basePath) ? to.slice(basePath.length) || '/' : to)}
      routerReplace={(to) => setLocation(to.startsWith(basePath) ? to.slice(basePath.length) || '/' : to, { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route component={AuthGate} />
        </Switch>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootApp() {
  return <WouterRouter base={basePath}><App /></WouterRouter>;
}

export default RootApp;
