module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo is not hoisted — it lives inside expo's own node_modules.
  // Resolve expo's directory first, then resolve the preset from there.
  const expoDir = require
    .resolve('expo/package.json', { paths: [__dirname] })
    .replace('/package.json', '');
  return {
    presets: [
      [
        require.resolve('babel-preset-expo', { paths: [expoDir] }),
        { jsxImportSource: 'nativewind' },
      ],
    ],
    plugins: [
      require.resolve('react-native-reanimated/plugin', { paths: [__dirname] }),
    ],
  };
};
