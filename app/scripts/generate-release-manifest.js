const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const appDirectory = path.resolve(__dirname, '..');
const outputDirectory = path.join(appDirectory, 'dist');

if (!fs.existsSync(outputDirectory)) {
  throw new Error('Build output is missing. Run the Windows build before generating a release manifest.');
}

const artifacts = fs.readdirSync(outputDirectory)
  .filter((fileName) => /\.(exe|blockmap)$/i.test(fileName))
  .map((fileName) => {
    const filePath = path.join(outputDirectory, fileName);
    const bytes = fs.readFileSync(filePath);
    return {
      file: fileName,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
  })
  .sort((left, right) => left.file.localeCompare(right.file));

const manifest = {
  generatedAt: new Date().toISOString(),
  artifacts
};

fs.writeFileSync(path.join(outputDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
