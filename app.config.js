// Extends app.json.
// - EXPO_BASE_URL lets CI set the GitHub Pages sub-path (e.g. "/splitnote").
// - IOS_BUILD_NUMBER lets CI stamp each native build (SideStore uses it to detect updates).
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.IOS_BUILD_NUMBER ? { buildNumber: process.env.IOS_BUILD_NUMBER } : {}),
  },
  web: { bundler: 'metro', output: 'single', favicon: undefined },
  experiments: {
    ...(config.experiments ?? {}),
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
