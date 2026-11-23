// Writes an AltStore/SideStore "source" JSON for the latest .ipa build.
// Add the source in SideStore once (Sources → +) using:
//   https://github.com/<owner>/<repo>/releases/latest/download/source.json
// Each new CI build publishes a new release, so SideStore sees it as an update.
//
// Env (set by .github/workflows/ios-sideload.yml):
//   OWNER, REPO, TAG, BUILD_NUMBER, IPA_PATH, OUT_PATH
const fs = require('fs');
const path = require('path');

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const owner = required('OWNER');
const repo = required('REPO');
const tag = required('TAG');
const buildNumber = required('BUILD_NUMBER');
const ipaPath = required('IPA_PATH');
const outPath = required('OUT_PATH');

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;
const ipaName = path.basename(ipaPath);
const size = fs.statSync(ipaPath).size;

const source = {
  name: 'SplitNote',
  identifier: `io.github.${owner.toLowerCase()}.${repo.toLowerCase()}.source`,
  subtitle: 'Personal builds of SplitNote',
  website: `https://github.com/${owner}/${repo}`,
  apps: [
    {
      name: appJson.name,
      bundleIdentifier: appJson.ios.bundleIdentifier,
      developerName: owner,
      subtitle: 'Log group expenses fast, sync to Splitwise later.',
      localizedDescription:
        'Log group expenses in seconds, then batch-enter them into Splitwise at the weekend. Built from source by GitHub Actions.',
      iconURL: `https://raw.githubusercontent.com/${owner}/${repo}/main/assets/icon.png`,
      tintColor: '1D9E75',
      category: 'utilities',
      versions: [
        {
          version: appJson.version,
          buildVersion: String(buildNumber),
          date: new Date().toISOString(),
          localizedDescription: `CI build ${buildNumber} (${tag})`,
          downloadURL: `https://github.com/${owner}/${repo}/releases/download/${tag}/${ipaName}`,
          size,
          minOSVersion: '15.1',
        },
      ],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
};

fs.writeFileSync(outPath, JSON.stringify(source, null, 2) + '\n');
console.log(`sidestore-source: wrote ${outPath} for ${appJson.version} (${buildNumber}), ${size} bytes`);
