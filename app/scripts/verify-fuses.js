const path = require('path');
const { FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');

const executable = path.join(__dirname, '..', 'dist', 'win-unpacked', 'WhatsApp Privacy Blur.exe');

async function verify() {
  const wire = await getCurrentFuseWire(executable);
  const expected = {
    [FuseV1Options.RunAsNode]: FuseState.DISABLE,
    [FuseV1Options.EnableCookieEncryption]: FuseState.ENABLE,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
    [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE
  };

  for (const [fuse, requiredState] of Object.entries(expected)) {
    if (wire[fuse] !== requiredState) {
      throw new Error(`Fuse ${FuseV1Options[fuse]} is not in the required state.`);
    }
  }
}

verify();
