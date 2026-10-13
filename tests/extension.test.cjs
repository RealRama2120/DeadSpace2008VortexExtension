'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

let virtualEntries = new Map();
let registryValues = new Map();
let storeResult;
let storeError = new Error('not found');
const logs = [];
let rawWriteCalls = 0;
let rawUnlinkCalls = 0;
let deniedProbeRoot;
let rawProbeWriteError;
let shellExecuteCalls = 0;
let shellExecuteOptions;
let shellExecuteError;
let accessDialogCalls = 0;
let accessDialogAction = 'Grant access';

function key(input) {
  const normalized = path.win32.normalize(input).toLowerCase();
  return /^[a-z]:\\$/.test(normalized)
    ? normalized
    : normalized.replace(/[\\/]+$/, '');
}

function addDirectory(input, children = []) {
  virtualEntries.set(key(input), { type: 'directory', children });
}

function addFile(input, size = 1) {
  virtualEntries.set(key(input), { type: 'file', size });
}

function addOriginalGame(gamePath, marker = 'movies') {
  addDirectory(gamePath);
  addFile(path.win32.join(gamePath, 'Dead Space.exe'), 11 * 1024 * 1024);
  addDirectory(path.win32.join(gamePath, 'audiostreams'));
  addDirectory(path.win32.join(gamePath, 'loading_screen'));
  addFile(path.win32.join(
    gamePath,
    'loading_screen',
    'ch01_flt_loading_screen_global.toc',
  ));
  addDirectory(path.win32.join(gamePath, marker));
}

function resetVirtualState() {
  virtualEntries = new Map();
  registryValues = new Map();
  storeResult = undefined;
  storeError = new Error('not found');
  logs.length = 0;
  rawWriteCalls = 0;
  rawUnlinkCalls = 0;
  deniedProbeRoot = undefined;
  rawProbeWriteError = undefined;
  shellExecuteCalls = 0;
  shellExecuteOptions = undefined;
  shellExecuteError = undefined;
  accessDialogCalls = 0;
  accessDialogAction = 'Grant access';
}

const fakeFs = {
  async statAsync(input) {
    const entry = virtualEntries.get(key(input));
    if (!entry) {
      const error = new Error(`ENOENT: ${input}`);
      error.code = 'ENOENT';
      throw error;
    }
    return {
      size: entry.size || 0,
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'directory',
    };
  },
  async readdirAsync(input) {
    const entry = virtualEntries.get(key(input));
    if (!entry || entry.type !== 'directory') {
      const error = new Error(`ENOENT: ${input}`);
      error.code = 'ENOENT';
      throw error;
    }
    return entry.children || [];
  },
};

const fakeNodeFs = {
  promises: {
    async writeFile(input, data, options) {
      rawWriteCalls += 1;
      const normalizedInput = key(input);
      const deniedRoot = deniedProbeRoot && key(deniedProbeRoot);
      if (rawProbeWriteError && deniedRoot
          && normalizedInput.startsWith(`${deniedRoot}\\`)) {
        throw rawProbeWriteError;
      }
      if (options && options.flag === 'wx'
          && virtualEntries.has(normalizedInput)) {
        const error = new Error(`EEXIST: ${input}`);
        error.code = 'EEXIST';
        throw error;
      }
      addFile(input, Buffer.byteLength(data));
    },
    async unlink(input) {
      rawUnlinkCalls += 1;
      if (!virtualEntries.has(key(input))) {
        const error = new Error(`ENOENT: ${input}`);
        error.code = 'ENOENT';
        throw error;
      }
      virtualEntries.delete(key(input));
    },
  },
};

const fakeVortexApi = {
  fs: fakeFs,
  log: (...args) => logs.push(args),
  selectors: {
    profileById: (state, profileId) => state.persistent.profiles[profileId],
    discoveryByGame: (state, gameId) => state.settings.gameMode.discovered[gameId],
  },
  util: {
    GameStoreHelper: {
      async findByAppId(ids) {
        assert.deepStrictEqual(ids, ['17470']);
        if (storeError) {
          throw storeError;
        }
        return storeResult;
      },
    },
    opn: async () => undefined,
  },
};

const fakeWinapi = {
  RegGetValue(hive, registryPath, valueName) {
    const lookup = `${hive}|${registryPath}|${valueName}`.toLowerCase();
    if (!registryValues.has(lookup)) {
      throw new Error('registry value missing');
    }
    return { value: registryValues.get(lookup) };
  },
  GetUserSID() {
    return 'S-1-5-21-111111111-222222222-333333333-1001';
  },
  ShellExecuteEx(options) {
    shellExecuteCalls += 1;
    shellExecuteOptions = options;
    if (shellExecuteError) {
      throw shellExecuteError;
    }
    // Simulate icacls completing before the extension's first polling probe.
    rawProbeWriteError = undefined;
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'fs') {
    return fakeNodeFs;
  }
  if (request === 'vortex-api') {
    return fakeVortexApi;
  }
  if (request === 'winapi-bindings') {
    return fakeWinapi;
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

async function testRegistration() {
  const games = [];
  const installers = [];
  const notifications = [];
  const onceCallbacks = [];
  const asyncHandlers = new Map();
  const context = {
    api: {
      sendNotification: notification => notifications.push(notification),
      onAsync: (eventName, handler) => asyncHandlers.set(eventName, handler),
    },
    registerGame: game => games.push(game),
    registerInstaller: (...args) => installers.push(args),
    once: callback => onceCallbacks.push(callback),
  };

  assert.strictEqual(extension.default(context), true);
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].id, 'deadspace');
  assert.strictEqual(games[0].name, 'Dead Space (2008)');
  assert.deepStrictEqual(games[0].requiredFiles, [
    'Dead Space.exe',
    path.win32.join('loading_screen', 'ch01_flt_loading_screen_global.toc'),
  ]);
  assert.strictEqual(games[0].queryModPath(), '.');
  assert.strictEqual(games[0].details.steamAppId, 17470);
  assert.strictEqual(games[0].details.nexusPageId, 'deadspace');
  assert.strictEqual(installers.length, 2);
  assert.deepStrictEqual(installers.map(entry => entry[0]), [
    'deadspace-2008-texmod',
    'deadspace-2008-root-mod',
  ]);
  assert.strictEqual(onceCallbacks.length, 1);
  onceCallbacks[0]();
  assert.strictEqual(typeof asyncHandlers.get('will-deploy'), 'function');
}

async function testSteamDiscovery() {
  resetVirtualState();
  const gamePath = 'D:\\SteamLibrary\\steamapps\\common\\Dead Space';
  addOriginalGame(gamePath, 'audiostreams');
  storeError = undefined;
  storeResult = { gamePath };

  const result = await extension.__test.findGame({ sendNotification: () => undefined });
  assert.strictEqual(result, gamePath);
  assert(logs.some(entry => entry[1].includes('Steam')));
}

async function testRegistryDiscovery() {
  resetVirtualState();
  const gamePath = 'F:\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'loading_screen');
  const lookup = [
    'HKEY_LOCAL_MACHINE',
    'SOFTWARE\\WOW6432Node\\Electronic Arts\\Dead Space',
    'Install Dir',
  ].join('|').toLowerCase();
  registryValues.set(lookup, `"${gamePath}\\"`);

  const result = await extension.__test.findViaRegistry();
  assert.strictEqual(result, gamePath);
}

async function testAllDriveDiscoveryAndRemakeRejection() {
  resetVirtualState();

  addDirectory('C:\\');
  const remakePath = 'C:\\Program Files\\EA Games\\Dead Space';
  addDirectory(remakePath);
  addFile(path.win32.join(remakePath, 'Dead Space.exe'), 403 * 1024 * 1024);
  addFile(path.win32.join(remakePath, 'GL.ini'));
  addDirectory(path.win32.join(remakePath, 'movies'));
  addDirectory(path.win32.join(remakePath, 'Data', 'Win32'));

  addDirectory('E:\\', ['My Custom Game Library']);
  const originalPath = 'E:\\My Custom Game Library\\Dead Space';
  addOriginalGame(originalPath, 'movies');

  assert.strictEqual(await extension.__test.isOriginalGamePath(remakePath), false);
  assert.strictEqual(await extension.__test.findAcrossDrives(), originalPath);
}

async function testCurrentEaAppLayoutWithoutGlIni() {
  resetVirtualState();
  addDirectory('C:\\');
  const gamePath = 'C:\\Program Files\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');

  assert.strictEqual(
    virtualEntries.has(key(path.win32.join(gamePath, 'GL.ini'))),
    false,
  );
  assert.strictEqual(await extension.__test.isOriginalGamePath(gamePath), true);
  assert.strictEqual(await extension.__test.findAcrossDrives(), gamePath);
}

async function testFailureNotification() {
  resetVirtualState();
  addDirectory('C:\\');
  const notifications = [];

  await assert.rejects(
    extension.__test.findGame({
      sendNotification: notification => notifications.push(notification),
    }),
    /was not found/,
  );
  assert.strictEqual(notifications.length, 1);
  assert.strictEqual(notifications[0].id, 'deadspace-2008-discovery-failed');
}

async function testInstallers() {
  const texTest = await extension.__test.testTexModContent(
    ['Optional HD/HD_Suit.tpf', 'Optional HD/readme.txt'],
    'deadspace',
  );
  assert.strictEqual(texTest.supported, true);

  const notifications = [];
  const texInstall = await extension.__test.installTexModContent(
    { sendNotification: notification => notifications.push(notification) },
    ['Optional HD/HD_Suit.tpf', 'Optional HD/readme.txt'],
  );
  assert.deepStrictEqual(texInstall.instructions, [{
    type: 'copy',
    source: 'Optional HD/HD_Suit.tpf',
    destination: path.win32.join('TexMod Packages', 'HD_Suit.tpf'),
  }]);
  assert.strictEqual(notifications[0].type, 'warning');

  const rootTest = await extension.__test.testRootModContent(
    ['DeadSpaceFix/DeadSpaceFixes.ini', 'DeadSpaceFix/xinput1_3.dll'],
    'deadspace',
  );
  assert.strictEqual(rootTest.supported, true);

  const rootInstall = await extension.__test.installRootModContent([
    'DeadSpaceFix/DeadSpaceFixes.ini',
    'DeadSpaceFix/xinput1_3.dll',
    'DeadSpaceFix/README.txt',
  ]);
  assert.deepStrictEqual(rootInstall.instructions.map(item => item.destination), [
    'DeadSpaceFixes.ini',
    'xinput1_3.dll',
    'README.txt',
  ]);

  const reshadeInstall = await extension.__test.installRootModContent([
    'reshade-shaders/Shaders/Example.fx',
    'reshade-shaders/Textures/Example.png',
  ]);
  assert.deepStrictEqual(reshadeInstall.instructions.map(item => item.destination), [
    path.win32.join('reshade-shaders', 'Shaders', 'Example.fx'),
    path.win32.join('reshade-shaders', 'Textures', 'Example.png'),
  ]);
}

async function testSetupVerifiesWriteAccessOnce() {
  resetVirtualState();
  const gamePath = 'G:\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');
  const notifications = [];
  const api = {
    sendNotification: notification => notifications.push(notification),
  };

  await Promise.all([
    extension.__test.setup(api, { path: gamePath }),
    extension.__test.setup(api, { path: gamePath }),
  ]);

  assert.strictEqual(rawWriteCalls, 1);
  assert.strictEqual(rawUnlinkCalls, 1);
  assert.strictEqual(accessDialogCalls, 0);
  assert.strictEqual(shellExecuteCalls, 0);
  assert.strictEqual(
    [...virtualEntries.keys()].some(entry =>
      entry.includes('.vortex-dead-space-write-test-')),
    false,
  );

  await extension.__test.setup(api, { path: gamePath });
  assert.strictEqual(rawWriteCalls, 1);
  assert.strictEqual(shellExecuteCalls, 0);
  assert(notifications.some(notification =>
    notification.id === 'deadspace-2008-modding-help'));
}

async function testSetupRequestsPermissionOnce() {
  resetVirtualState();
  const gamePath = 'H:\\Program Files\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');
  const notifications = [];
  const api = {
    sendNotification: notification => notifications.push(notification),
    showDialog: async (type, title, content, buttons) => {
      accessDialogCalls += 1;
      assert.strictEqual(type, 'question');
      assert.strictEqual(title, 'One-time Dead Space folder access');
      assert(content.text.includes(gamePath));
      assert.deepStrictEqual(buttons.map(button => button.label), [
        'Cancel',
        'Grant access',
      ]);
      return { action: accessDialogAction };
    },
  };
  deniedProbeRoot = gamePath;
  rawProbeWriteError = Object.assign(new Error('access denied'), {
    code: 'EACCES',
  });

  await extension.__test.setup(api, { path: gamePath });

  assert.strictEqual(rawWriteCalls, 2);
  assert.strictEqual(accessDialogCalls, 1);
  assert.strictEqual(shellExecuteCalls, 1);
  assert.strictEqual(shellExecuteOptions.verb, 'runas');
  assert.strictEqual(path.win32.basename(shellExecuteOptions.file), 'icacls.exe');
  assert.strictEqual(shellExecuteOptions.show, 'hide');
  assert(shellExecuteOptions.parameters.includes(`"${gamePath}"`));
  assert(shellExecuteOptions.parameters.includes(
    '*S-1-5-21-111111111-222222222-333333333-1001:(OI)(CI)M',
  ));
  assert.strictEqual(
    [...virtualEntries.keys()].some(entry =>
      entry.includes('.vortex-dead-space-write-test-')),
    false,
  );
  assert(notifications.some(notification =>
    notification.id === 'deadspace-2008-modding-help'));
}

async function testSetupStopsBeforeDeploymentWhenPermissionIsCancelled() {
  resetVirtualState();
  const gamePath = 'I:\\Program Files\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');
  const notifications = [];
  const api = {
    sendNotification: notification => notifications.push(notification),
    showDialog: async () => {
      accessDialogCalls += 1;
      return { action: accessDialogAction };
    },
  };
  deniedProbeRoot = gamePath;
  rawProbeWriteError = Object.assign(new Error('access denied'), {
    code: 'EPERM',
  });
  accessDialogAction = 'Cancel';

  await assert.rejects(
    extension.__test.setup(api, { path: gamePath }),
    /stopped deployment before Vortex could begin/,
  );
  assert.strictEqual(accessDialogCalls, 1);
  assert.strictEqual(shellExecuteCalls, 0);
  assert.strictEqual(
    notifications.filter(notification =>
      notification.id === 'deadspace-2008-write-access-failed').length,
    1,
  );

  accessDialogAction = 'Grant access';
  await extension.__test.setup(api, { path: gamePath });
  assert.strictEqual(accessDialogCalls, 2);
  assert.strictEqual(shellExecuteCalls, 1);
  assert.strictEqual(
    [...virtualEntries.keys()].some(entry =>
      entry.includes('.vortex-dead-space-write-test-')),
    false,
  );
}

async function testPermissionLaunchFailureDoesNotLoop() {
  resetVirtualState();
  const gamePath = 'J:\\Program Files\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');
  const notifications = [];
  const api = {
    sendNotification: notification => notifications.push(notification),
    showDialog: async () => {
      accessDialogCalls += 1;
      return { action: 'Grant access' };
    },
  };
  deniedProbeRoot = gamePath;
  rawProbeWriteError = Object.assign(new Error('access denied'), {
    code: 'EACCES',
  });
  shellExecuteError = Object.assign(new Error('The operation was canceled'), {
    code: 'ECANCELED',
  });

  await assert.rejects(
    extension.__test.setup(api, { path: gamePath }),
    /stopped deployment before Vortex could begin/,
  );
  assert.strictEqual(accessDialogCalls, 1);
  assert.strictEqual(shellExecuteCalls, 1);
  assert.strictEqual(
    notifications.filter(notification =>
      notification.id === 'deadspace-2008-write-access-failed').length,
    1,
  );
}

async function testWillDeployPreflightRunsBeforeDeadSpaceDeployment() {
  resetVirtualState();
  const gamePath = 'K:\\Program Files\\EA Games\\Dead Space';
  addOriginalGame(gamePath, 'movies');
  deniedProbeRoot = gamePath;
  rawProbeWriteError = Object.assign(new Error('access denied'), {
    code: 'EACCES',
  });

  const state = {
    persistent: {
      profiles: {
        deadProfile: { id: 'deadProfile', gameId: 'deadspace' },
        otherProfile: { id: 'otherProfile', gameId: 'othergame' },
      },
    },
    settings: {
      gameMode: {
        discovered: {
          deadspace: { path: gamePath },
        },
      },
    },
  };
  const api = {
    getState: () => state,
    sendNotification: () => undefined,
    showDialog: async () => {
      accessDialogCalls += 1;
      return { action: 'Grant access' };
    },
  };

  await extension.__test.preflightDeployment(api, 'otherProfile');
  assert.strictEqual(accessDialogCalls, 0);
  assert.strictEqual(shellExecuteCalls, 0);

  await extension.__test.preflightDeployment(api, 'deadProfile');
  assert.strictEqual(accessDialogCalls, 1);
  assert.strictEqual(shellExecuteCalls, 1);
  assert(logs.some(entry => entry[1].includes('verified write access')));
}

async function run() {
  await testRegistration();
  await testSteamDiscovery();
  await testRegistryDiscovery();
  await testAllDriveDiscoveryAndRemakeRejection();
  await testCurrentEaAppLayoutWithoutGlIni();
  await testFailureNotification();
  await testInstallers();
  await testSetupVerifiesWriteAccessOnce();
  await testSetupRequestsPermissionOnce();
  await testSetupStopsBeforeDeploymentWhenPermissionIsCancelled();
  await testPermissionLaunchFailureDoesNotLoop();
  await testWillDeployPreflightRunsBeforeDeadSpaceDeployment();
  process.stdout.write('All extension tests passed.\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
