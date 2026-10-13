'use strict';

const nodeFs = require('fs');
const childProcess = require('child_process');
const crypto = require('crypto');
const path = require('path');
const {
  fs, log, selectors, util,
} = require('vortex-api');

let winapi;
try {
  winapi = require('winapi-bindings');
} catch (err) {
  winapi = undefined;
}

const GAME_ID = 'deadspace';
const GAME_NAME = 'Dead Space (2008)';
const STEAM_APP_ID = '17470';
const GAME_EXE = 'Dead Space.exe';
const ORIGINAL_REQUIRED_FILE = path.join(
  'loading_screen',
  'ch01_flt_loading_screen_global.toc',
);
const TEXMOD_DIRECTORY = 'TexMod Packages';
const LAA_MARKER_FILE = 'DeadSpaceLAA.vortex.json';
const LAA_MARKER_ID = 'rama2120.dead-space-2008-laa';
const LAA_MANAGED_FILE = 'Dead Space.exe.deadspace-laa.vortex-managed.json';
const LAA_BACKUP_SUFFIX = '.deadspace-laa.bak';
const LAA_MANIFEST_SUFFIX = '.deadspace-laa.manifest';
const LAA_TOOL_PATH = path.join(__dirname, 'tools', 'DeadSpaceLAA.Automated.exe');
const LAA_TOOL_SHA256 = '2de3915881aab05773fea02ab0aed9e786e1ace842ed59461b8e4be9e2b8c45e';
const LAA_TOOL_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_ORIGINAL_EXE_SIZE = 64 * 1024 * 1024;
const WRITE_TEST_PREFIX = '.vortex-dead-space-write-test-';
const WRITE_TEST_CONTENT = 'Dead Space (2008) Vortex write test.\n';
const ACCESS_POLL_INTERVAL_MS = 500;
const ACCESS_POLL_TIMEOUT_MS = 30 * 1000;
const WINDOWS_SID_PATTERN = /^S-\d-(?:\d+-)+\d+$/i;

// Vortex can invoke setup more than once while activating a game. Share an
// in-flight permission check and remember verified roots for this Vortex
// session so Windows never receives a burst of identical access requests.
const pendingWritableChecks = new Map();
const verifiedWritableRoots = new Set();

const REGISTRY_LOCATIONS = [
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Electronic Arts\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Electronic Arts\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Origin Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Origin Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Electronic Arts\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\EA Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Origin Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9789E33B-317A-44B2-AF9A-FF8708AD93E0}'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9789E33B-317A-44B2-AF9A-FF8708AD93E0}'],
];

const REGISTRY_VALUE_NAMES = [
  'Install Dir',
  'InstallDir',
  'Install Path',
  'InstallPath',
  'InstallLocation',
  'DisplayIcon',
  'Path',
  'GamePath',
];

const COMMON_INSTALL_PATHS = [
  'Dead Space',
  'EA Games/Dead Space',
  'Games/Dead Space',
  'Games/EA Games/Dead Space',
  'Origin Games/Dead Space',
  'Games/Origin Games/Dead Space',
  'Electronic Arts/Dead Space',
  'Games/Electronic Arts/Dead Space',
  'Program Files/EA Games/Dead Space',
  'Program Files (x86)/EA Games/Dead Space',
  'Program Files/Origin Games/Dead Space',
  'Program Files (x86)/Origin Games/Dead Space',
  'Program Files/Electronic Arts/Dead Space',
  'Program Files (x86)/Electronic Arts/Dead Space',
  'SteamLibrary/steamapps/common/Dead Space',
  'Steam/steamapps/common/Dead Space',
  'Games/Steam/steamapps/common/Dead Space',
  'Program Files/Steam/steamapps/common/Dead Space',
  'Program Files (x86)/Steam/steamapps/common/Dead Space',
];

const ROOT_MOD_EXTENSIONS = new Set([
  '.addon', '.asi', '.cfg', '.conf', '.dll', '.fx', '.fxh', '.ini',
  '.json', '.preset', '.toml', '.yaml', '.yml',
]);

const PRESERVED_ROOT_FOLDERS = new Set([
  'reshade-shaders',
  'reshade-presets',
  'scripts',
  'textures',
]);

const SYSTEM_ROOT_FOLDERS = new Set([
  '$recycle.bin',
  'boot',
  'documents and settings',
  'msocache',
  'perflogs',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'system volume information',
  'users',
  'windows',
]);

function pathFromRelative(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter(candidate => {
    if (!candidate) {
      return false;
    }

    const key = path.normalize(candidate).toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function unwrapRegistryValue(rawValue) {
  if (rawValue && typeof rawValue === 'object' && rawValue.value !== undefined) {
    return rawValue.value;
  }
  return rawValue;
}

function expandEnvironmentVariables(input) {
  const env = Object.keys(process.env).reduce((result, key) => {
    result[key.toLowerCase()] = process.env[key];
    return result;
  }, {});

  return input.replace(/%([^%]+)%/g, (match, variableName) =>
    env[variableName.toLowerCase()] || match);
}

function normalizeInstallPath(rawValue) {
  const unwrapped = unwrapRegistryValue(rawValue);
  if (typeof unwrapped !== 'string') {
    return undefined;
  }

  let candidate = expandEnvironmentVariables(unwrapped.replace(/\0/g, '').trim());
  if (candidate.startsWith('"')) {
    const closingQuote = candidate.indexOf('"', 1);
    candidate = closingQuote > 1 ? candidate.slice(1, closingQuote) : candidate.slice(1);
  } else {
    const executableIndex = candidate.toLowerCase().indexOf('.exe');
    if (executableIndex !== -1) {
      candidate = candidate.slice(0, executableIndex + 4);
    }
  }

  candidate = candidate.trim().replace(/[\\/]+$/, '');
  if (path.basename(candidate).toLowerCase() === GAME_EXE.toLowerCase()) {
    candidate = path.dirname(candidate);
  }

  return candidate || undefined;
}

async function statPath(candidate) {
  try {
    return await fs.statAsync(candidate);
  } catch (err) {
    return undefined;
  }
}

async function isFile(candidate) {
  const stats = await statPath(candidate);
  return stats !== undefined && stats.isFile();
}

async function isDirectory(candidate) {
  const stats = await statPath(candidate);
  return stats !== undefined && stats.isDirectory();
}

/**
 * The remake also uses "Dead Space.exe", so the executable name alone is not
 * sufficient. The original is small and has several legacy streamed-audio,
 * loading-screen, movie, and chapter-data directories. The remake's Data/Win32
 * layout is an explicit rejection marker. GL.ini is intentionally not required:
 * the current EA App build does not ship that Steam-specific file.
 */
async function isOriginalGamePath(rawCandidate) {
  const candidate = normalizeInstallPath(rawCandidate);
  if (!candidate) {
    return false;
  }

  const executableStats = await statPath(path.join(candidate, GAME_EXE));
  if (!executableStats || !executableStats.isFile()
      || executableStats.size > MAX_ORIGINAL_EXE_SIZE) {
    return false;
  }

  if (await isDirectory(path.join(candidate, 'Data', 'Win32'))) {
    return false;
  }

  const originalDataMarkers = await Promise.all([
    isDirectory(path.join(candidate, 'audiostreams')),
    isDirectory(path.join(candidate, 'loading_screen')),
    isDirectory(path.join(candidate, 'movies')),
    isDirectory(path.join(candidate, 'ch01_flt')),
    isDirectory(path.join(candidate, 'Core')),
  ]);

  return originalDataMarkers.filter(Boolean).length >= 2;
}

async function firstValidCandidate(candidates) {
  for (const rawCandidate of uniquePaths(candidates)) {
    const candidate = normalizeInstallPath(rawCandidate);
    if (await isOriginalGamePath(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findViaGameStores() {
  try {
    const discovered = await util.GameStoreHelper.findByAppId([STEAM_APP_ID]);
    return firstValidCandidate([
      discovered && discovered.gamePath,
      discovered && discovered.path,
    ]);
  } catch (err) {
    log('debug', `${GAME_NAME}: Steam discovery did not return a valid install`, {
      error: err && err.message,
    });
    return undefined;
  }
}

function readRegistryCandidates() {
  if (!winapi || typeof winapi.RegGetValue !== 'function') {
    return [];
  }

  const candidates = [];
  REGISTRY_LOCATIONS.forEach(([hive, key]) => {
    REGISTRY_VALUE_NAMES.forEach(valueName => {
      try {
        const value = winapi.RegGetValue(hive, key, valueName);
        const candidate = normalizeInstallPath(value);
        if (candidate) {
          candidates.push(candidate);
        }
      } catch (err) {
        // Missing registry values are expected; continue to the next one.
      }
    });
  });

  return uniquePaths(candidates);
}

async function findViaRegistry() {
  return firstValidCandidate(readRegistryCandidates());
}

async function listMountedDriveRoots() {
  if (process.platform !== 'win32') {
    return [];
  }

  const roots = [];
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (await isDirectory(root)) {
      roots.push(root);
    }
  }

  return roots;
}

async function rootFolderCandidates(driveRoot) {
  let entries;
  try {
    entries = await fs.readdirAsync(driveRoot);
  } catch (err) {
    return [];
  }

  const searchableEntries = entries
    .filter(entry => typeof entry === 'string'
      && !SYSTEM_ROOT_FOLDERS.has(entry.toLowerCase()))
    .slice(0, 128);

  const candidates = [];
  searchableEntries.forEach(entry => {
    const base = path.join(driveRoot, entry);
    candidates.push(
      path.join(base, 'Dead Space'),
      path.join(base, 'EA Games', 'Dead Space'),
      path.join(base, 'Origin Games', 'Dead Space'),
      path.join(base, 'Electronic Arts', 'Dead Space'),
      path.join(base, 'Games', 'Dead Space'),
      path.join(base, 'steamapps', 'common', 'Dead Space'),
      path.join(base, 'SteamLibrary', 'steamapps', 'common', 'Dead Space'),
    );
  });

  return candidates;
}

async function findAcrossDrives() {
  const driveRoots = await listMountedDriveRoots();
  for (const driveRoot of driveRoots) {
    const commonCandidates = COMMON_INSTALL_PATHS
      .map(relativePath => pathFromRelative(driveRoot, relativePath));
    const boundedCandidates = await rootFolderCandidates(driveRoot);
    const result = await firstValidCandidate(commonCandidates.concat(boundedCandidates));
    if (result) {
      return result;
    }
  }

  return undefined;
}

async function findGame(api) {
  const methods = [
    ['Steam', findViaGameStores],
    ['EA/Origin registry', findViaRegistry],
    ['all mounted drives', findAcrossDrives],
  ];

  for (const [methodName, method] of methods) {
    const result = await method();
    if (result) {
      log('info', `${GAME_NAME}: found through ${methodName}`, { path: result });
      return result;
    }
  }

  if (api && typeof api.sendNotification === 'function') {
    api.sendNotification({
      id: 'deadspace-2008-discovery-failed',
      type: 'warning',
      message: 'Dead Space (2008) was not found automatically. In Games, set the folder manually to the directory containing Dead Space.exe and the original loading_screen, audiostreams, and movies folders. The 2023 remake is not supported by this extension.',
      allowSuppress: true,
    });
  }

  throw new Error('Dead Space (2008) was not found on Steam, in EA/Origin registry data, or in common game-library paths on mounted drives.');
}

function isDirectoryEntry(fileName) {
  return fileName.endsWith('/') || fileName.endsWith('\\');
}

function archiveSegments(fileName) {
  return fileName.replace(/\\/g, '/').split('/').filter(Boolean);
}

function findLaaMarker(files) {
  return files.find(file => !isDirectoryEntry(file)
    && path.basename(file).toLowerCase() === LAA_MARKER_FILE.toLowerCase());
}

function testLaaModContent(files, gameId) {
  const supported = gameId === GAME_ID && findLaaMarker(files) !== undefined;
  return Promise.resolve({ supported, requiredFiles: [] });
}

function installLaaModContent(files) {
  const marker = findLaaMarker(files);
  if (!marker) {
    return Promise.reject(new Error(`The archive is missing ${LAA_MARKER_FILE}.`));
  }

  const instructions = [{
    type: 'copy',
    source: marker,
    destination: LAA_MARKER_FILE,
  }];

  files
    .filter(file => !isDirectoryEntry(file) && file !== marker)
    .forEach(file => {
      instructions.push({
        type: 'copy',
        source: file,
        destination: path.join('DeadSpaceLAA', path.basename(file)),
      });
    });

  return Promise.resolve({ instructions });
}

function testTexModContent(files, gameId) {
  const supported = gameId === GAME_ID
    && files.some(file => !isDirectoryEntry(file)
      && path.extname(file).toLowerCase() === '.tpf');
  return Promise.resolve({ supported, requiredFiles: [] });
}

function installTexModContent(api, files) {
  const instructions = files
    .filter(file => !isDirectoryEntry(file)
      && path.extname(file).toLowerCase() === '.tpf')
    .map(file => ({
      type: 'copy',
      source: file,
      destination: path.join(TEXMOD_DIRECTORY, path.basename(file)),
    }));

  if (api && typeof api.sendNotification === 'function') {
    api.sendNotification({
      id: 'deadspace-2008-texmod-runtime-required',
      type: 'warning',
      message: `TexMod packages are deployed to "${TEXMOD_DIRECTORY}". Vortex can manage these files, but it cannot perform TexMod's runtime texture injection. Launch the game through TexMod and select the required .tpf package there.`,
      allowSuppress: true,
    });
  }

  return Promise.resolve({ instructions });
}

function testRootModContent(files, gameId) {
  if (gameId !== GAME_ID || files.some(file =>
    path.extname(file).toLowerCase() === '.tpf')) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  const supported = files.some(file => {
    if (isDirectoryEntry(file)) {
      return false;
    }

    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return ROOT_MOD_EXTENSIONS.has(path.extname(file).toLowerCase())
      || normalized.includes('reshade-shaders/');
  });

  return Promise.resolve({ supported, requiredFiles: [] });
}

function wrapperToStrip(files) {
  const payload = files.filter(file => !isDirectoryEntry(file));
  if (payload.length === 0) {
    return undefined;
  }

  const segments = payload.map(archiveSegments);
  if (segments.some(parts => parts.length < 2)) {
    return undefined;
  }

  const first = segments[0][0];
  const common = segments.every(parts => parts[0].toLowerCase() === first.toLowerCase());
  if (!common || PRESERVED_ROOT_FOLDERS.has(first.toLowerCase())) {
    return undefined;
  }

  return first;
}

function installRootModContent(files) {
  const wrapper = wrapperToStrip(files);
  const instructions = files
    .filter(file => !isDirectoryEntry(file))
    .map(file => {
      const segments = archiveSegments(file);
      const destinationSegments = wrapper ? segments.slice(1) : segments;
      return {
        type: 'copy',
        source: file,
        destination: path.join(...destinationSegments),
      };
    });

  return Promise.resolve({ instructions });
}

function rawFileExists(filePath) {
  return nodeFs.promises.access(filePath, nodeFs.constants.F_OK)
    .then(() => true)
    .catch(error => {
      if (error && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function sha256File(filePath) {
  const data = await nodeFs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function validSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function parseLaaManifest(text) {
  const values = {};
  text.split(/\r?\n/).filter(Boolean).forEach(line => {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error('The LAA backup manifest contains an invalid line.');
    }
    const key = line.slice(0, separator);
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`The LAA backup manifest repeats ${key}.`);
    }
    values[key] = line.slice(separator + 1);
  });

  if (values.ManifestVersion !== '1'
      || values.ExecutableName !== GAME_EXE
      || !validSha256(values.OriginalSha256)
      || !validSha256(values.PatchedSha256)) {
    throw new Error('The LAA backup manifest failed validation.');
  }
  return values;
}

async function inspectLaaBackupPair(gamePath) {
  const executablePath = path.join(gamePath, GAME_EXE);
  const backupPath = executablePath + LAA_BACKUP_SUFFIX;
  const manifestPath = executablePath + LAA_MANIFEST_SUFFIX;
  const [backupExists, manifestExists] = await Promise.all([
    rawFileExists(backupPath),
    rawFileExists(manifestPath),
  ]);

  if (backupExists !== manifestExists) {
    throw new Error('The LAA backup set is incomplete. Automatic patching stopped.');
  }
  if (!backupExists) {
    return { state: 'none' };
  }

  const manifest = parseLaaManifest(
    await nodeFs.promises.readFile(manifestPath, 'utf8'),
  );
  const [backupHash, currentHash] = await Promise.all([
    sha256File(backupPath),
    sha256File(executablePath),
  ]);
  if (backupHash !== manifest.OriginalSha256) {
    throw new Error('The LAA backup failed SHA-256 verification.');
  }

  let state = 'changed';
  if (currentHash === manifest.OriginalSha256) {
    state = 'original';
  } else if (currentHash === manifest.PatchedSha256) {
    state = 'patched';
  }

  return {
    state,
    originalSha256: manifest.OriginalSha256,
    patchedSha256: manifest.PatchedSha256,
  };
}

async function verifyLaaTool() {
  if (!await rawFileExists(LAA_TOOL_PATH)) {
    throw new Error('The Dead Space extension is missing its automatic LAA helper. Reinstall extension 0.2.5 or newer.');
  }
  const toolHash = await sha256File(LAA_TOOL_PATH);
  if (toolHash !== LAA_TOOL_SHA256) {
    throw new Error('The automatic LAA helper failed its integrity check. Reinstall the Dead Space extension.');
  }
}

async function runLaaTool(action, gamePath) {
  await verifyLaaTool();
  const executablePath = path.join(gamePath, GAME_EXE);
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      LAA_TOOL_PATH,
      [`--${action}`, '--path', executablePath],
      {
        cwd: gamePath,
        windowsHide: true,
        timeout: LAA_TOOL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim();
          reject(new Error(`Automatic LAA ${action} failed: ${detail}`));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function laaOwnershipPath(gamePath) {
  return path.join(gamePath, LAA_MANAGED_FILE);
}

async function readLaaOwnership(gamePath) {
  const ownershipPath = laaOwnershipPath(gamePath);
  try {
    const value = JSON.parse(await nodeFs.promises.readFile(ownershipPath, 'utf8'));
    if (!value || value.schema !== 1 || value.id !== LAA_MARKER_ID
        || !validSha256(value.originalSha256)
        || !validSha256(value.patchedSha256)) {
      throw new Error('The Vortex LAA ownership record is invalid.');
    }
    return value;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function writeLaaOwnership(gamePath, pair) {
  const ownershipPath = laaOwnershipPath(gamePath);
  const existing = await readLaaOwnership(gamePath);
  if (existing) {
    if (existing.originalSha256 !== pair.originalSha256
        || existing.patchedSha256 !== pair.patchedSha256) {
      throw new Error('The existing Vortex LAA ownership record is for a different executable.');
    }
    return;
  }

  const value = {
    schema: 1,
    id: LAA_MARKER_ID,
    extensionVersion: '0.2.5',
    executable: GAME_EXE,
    originalSha256: pair.originalSha256,
    patchedSha256: pair.patchedSha256,
  };
  await nodeFs.promises.writeFile(
    ownershipPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx' },
  );
}

async function readLaaMarker(gamePath) {
  const markerPath = path.join(gamePath, LAA_MARKER_FILE);
  try {
    const marker = JSON.parse(await nodeFs.promises.readFile(markerPath, 'utf8'));
    if (!marker || marker.schema !== 1 || marker.id !== LAA_MARKER_ID
        || marker.enableLargeAddressAware !== true) {
      throw new Error(`${LAA_MARKER_FILE} is not a valid Dead Space LAA marker.`);
    }
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function sendLaaNotification(api, type, id, message) {
  if (api && typeof api.sendNotification === 'function') {
    api.sendNotification({
      id,
      type,
      title: 'Dead Space 4 GB / LAA Patch',
      message,
      allowSuppress: type !== 'error',
    });
  }
}

async function applyManagedLaa(api, gamePath) {
  const ownership = await readLaaOwnership(gamePath);
  const before = await inspectLaaBackupPair(gamePath);
  if (ownership && before.state === 'patched'
      && before.originalSha256 === ownership.originalSha256
      && before.patchedSha256 === ownership.patchedSha256) {
    return false;
  }
  if (before.state === 'changed') {
    throw new Error('Dead Space.exe differs from both the saved original and patched LAA hashes. Automatic patching stopped.');
  }

  await runLaaTool('apply', gamePath);
  const after = await inspectLaaBackupPair(gamePath);
  if (after.state !== 'patched') {
    sendLaaNotification(
      api,
      'warning',
      'deadspace-2008-laa-external',
      'Dead Space.exe was already LAA-enabled outside Vortex. It was left unchanged, and Vortex will not claim or undo that external change.',
    );
    return false;
  }

  const shouldOwn = ownership !== undefined
    || before.state === 'none'
    || before.state === 'original';
  if (!shouldOwn) {
    sendLaaNotification(
      api,
      'warning',
      'deadspace-2008-laa-external-backup',
      'LAA was already enabled using a compatible backup outside Vortex. Vortex will leave that existing patch and backup ownership unchanged.',
    );
    return false;
  }

  try {
    await writeLaaOwnership(gamePath, after);
  } catch (error) {
    await runLaaTool('restore', gamePath).catch(() => undefined);
    throw error;
  }

  sendLaaNotification(
    api,
    'success',
    'deadspace-2008-laa-applied',
    'Large Address Aware was automatically enabled and verified in Dead Space.exe. Normal EA, Steam, shortcut, and executable launches now use it.',
  );
  return true;
}

async function restoreManagedLaa(api, gamePath) {
  const ownership = await readLaaOwnership(gamePath);
  if (!ownership) {
    return false;
  }

  await runLaaTool('restore', gamePath);
  const after = await inspectLaaBackupPair(gamePath);
  if (after.state !== 'original'
      || after.originalSha256 !== ownership.originalSha256
      || after.patchedSha256 !== ownership.patchedSha256) {
    throw new Error('The automatic LAA restore did not reproduce the Vortex-managed original executable.');
  }

  await nodeFs.promises.unlink(laaOwnershipPath(gamePath));
  sendLaaNotification(
    api,
    'success',
    'deadspace-2008-laa-restored',
    'The Vortex-managed LAA change was removed and the original Dead Space.exe was verified.',
  );
  return true;
}

async function syncManagedLaa(api, gamePath, forceRestore) {
  if (forceRestore) {
    return restoreManagedLaa(api, gamePath);
  }
  const enabled = await readLaaMarker(gamePath);
  return enabled
    ? applyManagedLaa(api, gamePath)
    : restoreManagedLaa(api, gamePath);
}

function isAccessDenied(error) {
  return error && (error.code === 'EACCES' || error.code === 'EPERM');
}

function uniqueWriteTestName(label = '') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${WRITE_TEST_PREFIX}${label}${process.pid}-${Date.now()}-${random}.tmp`;
}

async function removeRawProbe(probePath) {
  try {
    await nodeFs.promises.unlink(probePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function cleanRawProbe(probePath) {
  try {
    await removeRawProbe(probePath);
  } catch (error) {
    log('warn', `${GAME_NAME}: could not remove a write-access test file`, {
      path: probePath,
      error: error && error.message,
    });
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function probeGameRootWriteAccess(gamePath) {
  const probePath = path.join(gamePath, uniqueWriteTestName());
  try {
    await nodeFs.promises.writeFile(probePath, WRITE_TEST_CONTENT, { flag: 'wx' });
    await removeRawProbe(probePath);
  } catch (error) {
    await cleanRawProbe(probePath);
    throw error;
  }
}

function validatePermissionTarget(gamePath) {
  const target = path.resolve(gamePath);
  if (target.includes('"') || target === path.parse(target).root) {
    throw new Error('Refusing to change access on an unsafe game-folder path.');
  }
  return target;
}

function currentWindowsUserSid() {
  if (!winapi || typeof winapi.GetUserSID !== 'function') {
    throw new Error('Vortex did not provide the Windows user identity helper.');
  }

  const sid = String(winapi.GetUserSID());
  if (!WINDOWS_SID_PATTERN.test(sid)) {
    throw new Error('Vortex returned an invalid Windows user identity.');
  }
  return sid;
}

async function confirmGameFolderAccess(api, gamePath) {
  if (!api || typeof api.showDialog !== 'function') {
    throw new Error('Vortex could not display the one-time folder-access request.');
  }

  const result = await api.showDialog(
    'question',
    'One-time Dead Space folder access',
    {
      text: `Windows currently allows Vortex to read "${gamePath}", but not to add or remove mods there.\n\n`
        + 'Grant Modify access to your current Windows account for this Dead Space folder only? '
        + 'Windows will show one administrator approval prompt. The rest of Program Files is not changed.',
    },
    [
      { label: 'Cancel' },
      { label: 'Grant access', default: true },
    ],
  );

  if (!result || result.action !== 'Grant access') {
    const error = new Error('The one-time Dead Space folder-access request was cancelled.');
    error.code = 'USER_CANCELED';
    throw error;
  }
}

function launchOneTimePermissionGrant(gamePath) {
  if (process.platform !== 'win32') {
    throw new Error('The one-time folder-access repair is available only on Windows.');
  }
  if (!winapi || typeof winapi.ShellExecuteEx !== 'function') {
    throw new Error('Vortex did not provide the Windows elevation helper.');
  }

  const target = validatePermissionTarget(gamePath);
  const sid = currentWindowsUserSid();
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const icaclsPath = path.join(windowsRoot, 'System32', 'icacls.exe');

  // Launch Windows' built-in ACL tool directly. This intentionally avoids
  // Vortex 2.5.0's temporary elevated JavaScript helpers, which the supplied
  // log shows failing to resolve both fs-extra and permissions.
  winapi.ShellExecuteEx({
    verb: 'runas',
    file: icaclsPath,
    parameters: `"${target}" /grant *${sid}:(OI)(CI)M /Q`,
    directory: path.dirname(icaclsPath),
    show: 'hide',
  });
}

async function waitForGameRootWriteAccess(gamePath) {
  const deadline = Date.now() + ACCESS_POLL_TIMEOUT_MS;
  let lastError;

  do {
    try {
      await probeGameRootWriteAccess(gamePath);
      return;
    } catch (error) {
      lastError = error;
      if (!isAccessDenied(error)) {
        throw error;
      }
    }

    await delay(ACCESS_POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  const timeoutError = new Error(
    'Windows did not grant write access to the Dead Space folder within 30 seconds.',
  );
  timeoutError.code = lastError && lastError.code;
  throw timeoutError;
}

async function verifyGameRootWriteAccess(api, gamePath) {
  try {
    await probeGameRootWriteAccess(gamePath);
    return;
  } catch (error) {
    if (!isAccessDenied(error)) {
      throw error;
    }
  }

  await confirmGameFolderAccess(api, gamePath);
  launchOneTimePermissionGrant(gamePath);
  await waitForGameRootWriteAccess(gamePath);
}

function ensureGameRootWritable(api, gamePath) {
  const normalizedPath = path.normalize(gamePath).toLowerCase();
  if (verifiedWritableRoots.has(normalizedPath)) {
    return Promise.resolve();
  }

  if (pendingWritableChecks.has(normalizedPath)) {
    return pendingWritableChecks.get(normalizedPath);
  }

  const check = verifyGameRootWriteAccess(api, gamePath)
    .then(() => {
      verifiedWritableRoots.add(normalizedPath);
      log('info', `${GAME_NAME}: verified write access to the game root`, {
        path: gamePath,
      });
    })
    .catch(error => {
      const message = `Vortex could not obtain write access to "${gamePath}". `
        + 'The Dead Space extension stopped deployment before Vortex could begin '
        + 'its repeating permission prompts. Retry Manage or Deploy when you are '
        + 'ready to approve the one-time Windows access request.';

      if (api && typeof api.sendNotification === 'function') {
        api.sendNotification({
          id: 'deadspace-2008-write-access-failed',
          type: 'error',
          title: 'Dead Space mod folder is not writable',
          message,
          allowSuppress: false,
          actions: [{
            title: 'Open game folder',
            action: () => util.opn(gamePath).catch(() => undefined),
          }],
        });
      }

      const setupError = new Error(message);
      setupError.cause = error;
      throw setupError;
    })
    .finally(() => {
      pendingWritableChecks.delete(normalizedPath);
    });

  pendingWritableChecks.set(normalizedPath, check);
  return check;
}

async function setup(api, discovery) {
  if (!discovery || !await isOriginalGamePath(discovery.path)) {
    throw new Error('The selected folder is not a valid Dead Space (2008) installation. Select the folder containing Dead Space.exe and the original loading_screen, audiostreams, and movies folders.');
  }

  await ensureGameRootWritable(api, discovery.path);

  api.sendNotification({
    id: 'deadspace-2008-modding-help',
    type: 'info',
    message: `Game-folder access was verified. Vortex deploys DLL, INI, ASI, and ReShade files beside ${GAME_EXE}. TexMod .tpf files are kept in "${TEXMOD_DIRECTORY}" and still require TexMod to inject them when the game starts.`,
    allowSuppress: true,
    actions: [{
      title: 'Open game folder',
      action: () => util.opn(discovery.path).catch(() => undefined),
    }],
  });
}

function stateFromApi(api) {
  if (api && typeof api.getState === 'function') {
    return api.getState();
  }
  if (api && api.store && typeof api.store.getState === 'function') {
    return api.store.getState();
  }
  return undefined;
}

function profileById(state, profileId) {
  if (selectors && typeof selectors.profileById === 'function') {
    return selectors.profileById(state, profileId);
  }
  return state && state.persistent && state.persistent.profiles
    ? state.persistent.profiles[profileId]
    : undefined;
}

function discoveryByGame(state, gameId) {
  if (selectors && typeof selectors.discoveryByGame === 'function') {
    return selectors.discoveryByGame(state, gameId);
  }
  return state && state.settings && state.settings.gameMode
    && state.settings.gameMode.discovered
    ? state.settings.gameMode.discovered[gameId]
    : undefined;
}

async function preflightDeployment(api, profileId) {
  const state = stateFromApi(api);
  const profile = profileById(state, profileId);
  if (!profile || profile.gameId !== GAME_ID) {
    return;
  }

  const discovery = discoveryByGame(state, GAME_ID);
  if (!discovery || !discovery.path
      || !await isOriginalGamePath(discovery.path)) {
    throw new Error('Dead Space (2008) deployment stopped because the discovered game folder is missing or invalid.');
  }

  // will-deploy is asynchronous and Vortex awaits it before entering its own
  // destination checks. Finishing the access grant here prevents the Vortex
  // 2.5.0 permission loop from starting at all, including for already-managed
  // games whose setup callback ran under an older extension version.
  await ensureGameRootWritable(api, discovery.path);
}

async function syncLaaForProfile(api, profileId, forceRestore = false) {
  const state = stateFromApi(api);
  const profile = profileById(state, profileId);
  if (!profile || profile.gameId !== GAME_ID) {
    return;
  }

  const discovery = discoveryByGame(state, GAME_ID);
  if (!discovery || !discovery.path
      || !await isOriginalGamePath(discovery.path)) {
    throw new Error('Dead Space LAA synchronization stopped because the discovered game folder is missing or invalid.');
  }

  await ensureGameRootWritable(api, discovery.path);
  try {
    await syncManagedLaa(api, discovery.path, forceRestore);
  } catch (error) {
    sendLaaNotification(
      api,
      'error',
      'deadspace-2008-laa-sync-failed',
      error && error.message
        ? error.message
        : 'Automatic LAA synchronization failed. Dead Space.exe was not reported as successfully changed.',
    );
    throw error;
  }
}

function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: GAME_NAME,
    mergeMods: true,
    logo: 'gameart.png',
    executable: () => GAME_EXE,
    requiredFiles: [GAME_EXE, ORIGINAL_REQUIRED_FILE],
    queryPath: () => findGame(context.api),
    queryModPath: () => '.',
    setup: discovery => setup(context.api, discovery),
    supportedTools: [],
    details: {
      steamAppId: Number(STEAM_APP_ID),
      nexusPageId: GAME_ID,
      hashFiles: [GAME_EXE, ORIGINAL_REQUIRED_FILE],
    },
  });

  context.registerInstaller(
    'deadspace-2008-laa',
    5,
    testLaaModContent,
    installLaaModContent,
  );

  context.registerInstaller(
    'deadspace-2008-texmod',
    15,
    testTexModContent,
    files => installTexModContent(context.api, files),
  );

  context.registerInstaller(
    'deadspace-2008-root-mod',
    25,
    testRootModContent,
    installRootModContent,
  );

  context.once(() => {
    context.api.onAsync(
      'will-deploy',
      profileId => preflightDeployment(context.api, profileId),
    );
    context.api.onAsync(
      'did-deploy',
      profileId => syncLaaForProfile(context.api, profileId, false),
    );
    context.api.onAsync(
      'did-purge',
      profileId => syncLaaForProfile(context.api, profileId, true),
    );
  });

  return true;
}

module.exports = {
  default: main,
  __test: {
    GAME_ID,
    GAME_EXE,
    TEXMOD_DIRECTORY,
    LAA_MARKER_FILE,
    LAA_MANAGED_FILE,
    findGame,
    findViaRegistry,
    findAcrossDrives,
    isOriginalGamePath,
    normalizeInstallPath,
    testTexModContent,
    installTexModContent,
    testLaaModContent,
    installLaaModContent,
    testRootModContent,
    installRootModContent,
    probeGameRootWriteAccess,
    launchOneTimePermissionGrant,
    verifyGameRootWriteAccess,
    ensureGameRootWritable,
    preflightDeployment,
    inspectLaaBackupPair,
    readLaaMarker,
    applyManagedLaa,
    restoreManagedLaa,
    syncManagedLaa,
    syncLaaForProfile,
    setup,
  },
};
