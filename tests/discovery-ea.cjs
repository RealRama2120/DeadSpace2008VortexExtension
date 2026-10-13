'use strict';

const nodeFs = require('fs');
const Module = require('module');
const path = require('path');

const realVortexApi = {
  fs: {
    statAsync: input => nodeFs.promises.stat(input),
    readdirAsync: input => nodeFs.promises.readdir(input),
  },
  log: () => undefined,
  util: {
    GameStoreHelper: {
      findByAppId: async () => { throw new Error('store lookup disabled'); },
    },
    opn: async () => undefined,
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vortex-api') {
    return realVortexApi;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const extensionPath = process.env.EXTENSION_UNDER_TEST
  ? path.resolve(process.env.EXTENSION_UNDER_TEST)
  : path.resolve(
    __dirname,
    '..',
    'index.js',
  );
const extension = require(extensionPath);
Module._load = originalLoad;

async function run() {
  const expected = 'C:\\Program Files\\EA Games\\Dead Space';
  const valid = await extension.__test.isOriginalGamePath(expected);
  if (!valid) {
    throw new Error('The installed EA App copy failed validation.');
  }

  const discovered = await extension.__test.findAcrossDrives();
  if (path.normalize(discovered).toLowerCase()
      !== path.normalize(expected).toLowerCase()) {
    throw new Error(`Expected ${expected}, discovered ${discovered}`);
  }

  process.stdout.write(`Real EA App install discovered: ${discovered}\n`);
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
