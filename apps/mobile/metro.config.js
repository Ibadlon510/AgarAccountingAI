// Metro needs extra help resolving workspace packages inside a pnpm
// monorepo: pnpm's symlinked node_modules layout isn't something Metro's
// default resolver understands out of the box.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

// Extra roots for packages hoisted to the workspace root. These are only
// fallbacks — the important part is that hierarchical lookup stays ON.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Do NOT set resolver.disableHierarchicalLookup here. That flag suits a
// hoisted npm/yarn layout, but pnpm nests each package's dependencies beside
// it under .pnpm/<pkg>/node_modules and relies on walking up from the
// requiring file to find them. Disabling the walk makes react-native's own
// deps (invariant, etc.) unresolvable even though they are installed.
config.resolver.unstable_enablePackageExports = true;

// React must exist exactly once in the bundle. It otherwise does not, because
// this workspace runs two React majors on purpose: the web apps are on React
// 19, while React Native 0.76 pins React 18.3.1. @workspace/api-client-react
// is shared by both and depends on @tanstack/react-query, so pnpm nests a
// copy of react-query bound to React 19 beside the library. Importing a hook
// from that library then mixes a React 19 react-query into a React 18 tree,
// and every hook call fails with "Invalid hook call ... more than one copy of
// React" (it reads useContext off a null dispatcher).
//
// Forcing these three to resolve from this app keeps one instance of each, no
// matter which file asks. It is scoped to the mobile app deliberately, so the
// shared library and the web apps keep their own React 19 resolution.
const singletons = ['react', 'react-dom', '@tanstack/react-query'];
const singletonRoots = new Map(
  singletons.map((name) => [name, path.resolve(projectRoot, 'node_modules', name)]),
);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, root] of singletonRoots) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      const subpath = moduleName.slice(name.length);
      return context.resolveRequest(context, root + subpath, platform);
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
