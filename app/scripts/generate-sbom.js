const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const appDirectory = path.resolve(__dirname, '..');
const outputDirectory = path.join(appDirectory, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(appDirectory, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(appDirectory, 'package-lock.json'), 'utf8'));

const components = Object.entries(lockfile.packages || {})
  .filter(([packagePath, details]) => packagePath.startsWith('node_modules/') && details.version)
  .map(([packagePath, details]) => ({
    type: 'library',
    name: packagePath.slice('node_modules/'.length),
    version: details.version,
    purl: `pkg:npm/${encodeURIComponent(packagePath.slice('node_modules/'.length))}@${encodeURIComponent(details.version)}`
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: packageJson.name,
      version: packageJson.version
    }
  },
  components
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'sbom.cdx.json'), `${JSON.stringify(document, null, 2)}\n`);
