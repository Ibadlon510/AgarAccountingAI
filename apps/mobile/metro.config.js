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

module.exports = config;
