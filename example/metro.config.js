// Resolve `react-native-mehery-chat` to the library source one folder up, with a single
// copy of react / react-native (this app's), so edits in ../src hot-reload here.
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]').replace(/\./g, '\\.');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    disableHierarchicalLookup: true,
    blockList: [new RegExp(`^${escape(path.join(root, 'node_modules'))}[/\\\\].*`)],
    resolveRequest: (context, name, platform) => {
      if (name === pkg.name || name.startsWith(`${pkg.name}/`)) {
        const sub = name === pkg.name ? 'index' : name.slice(pkg.name.length + 1);
        return context.resolveRequest(context, path.join(root, 'src', sub), platform);
      }
      return context.resolveRequest(context, name, platform);
    },
  },
});
